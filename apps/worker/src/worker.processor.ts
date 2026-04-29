import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QueueName, SessionStatus } from '@whatsapp-platform/common';
import Redis from 'ioredis';
import { rm } from 'fs/promises';
import { WorkerPrismaService } from './worker.prisma.service';
import { WhatsAppGatewayService } from './whatsapp-gateway.service';

@Injectable()
export class WorkerJobService {
  private readonly logger = new Logger(WorkerJobService.name);
  private readonly redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');

  constructor(
    private readonly prisma: WorkerPrismaService,
    private readonly whatsappGateway: WhatsAppGatewayService,
  ) {}

  async handleRequestQr(job: Job<{ sessionId: string }>) {
    const response = await this.whatsappGateway.requestQr(job.data.sessionId);
    await this.prisma.whatsAppSession.update({
      where: { id: job.data.sessionId },
      data: {
        status: response.status,
        qrExpiresAt: response.status === SessionStatus.PENDING_QR ? new Date(Date.now() + 60_000) : null,
        phoneNumber: response.phoneNumber,
        pushName: response.pushName,
      },
    });
    await this.prisma.connectionLog.create({
      data: {
        sessionId: job.data.sessionId,
        eventType: `session.${response.status === SessionStatus.PENDING_QR ? 'qr.updated' : response.status}`,
        payloadJson: { qr: response.qr, status: response.status },
      },
    });
    await this.redis.set(`wa:session:${job.data.sessionId}:status`, response.status, 'EX', 3600);
    if (response.qr) {
      await this.redis.set(`wa:session:${job.data.sessionId}:qr`, response.qr, 'EX', 60);
    } else {
      await this.redis.del(`wa:session:${job.data.sessionId}:qr`);
    }
    await this.redis.set('queue:whatsapp-qr:last', new Date().toISOString(), 'EX', 86400);
    return response;
  }

  async handleSendText(job: Job<{ sessionId: string; userId: string; to: string; text: string }>) {
    await this.ensureConnected(job.data.sessionId);
    try {
      const response = await this.whatsappGateway.sendText(job.data);
      await this.finalizeMessageLog({
        jobId: String(job.id),
        sessionId: job.data.sessionId,
        userId: job.data.userId,
        to: job.data.to,
        messageType: 'text',
        status: 'sent',
        providerMessageId: response.messageId ?? undefined,
      });
      await this.bumpUsage(job.data.sessionId, true);
      await this.redis.set('queue:whatsapp-send:last', new Date().toISOString(), 'EX', 86400);
      return response;
    } catch (error) {
      await this.handleSendFailure(job, 'text', error);
      throw error;
    }
  }

  async handleSendFile(job: Job<{ sessionId: string; userId: string; to: string; fileName: string; mimeType?: string; storagePath: string; caption?: string }>) {
    await this.ensureConnected(job.data.sessionId);
    try {
      const response = await this.whatsappGateway.sendFile(job.data);
      await this.finalizeMessageLog({
        jobId: String(job.id),
        sessionId: job.data.sessionId,
        userId: job.data.userId,
        to: job.data.to,
        messageType: 'file',
        status: 'sent',
        providerMessageId: response.messageId ?? undefined,
      });
      await this.bumpUsage(job.data.sessionId, true);
      await this.redis.set('queue:whatsapp-send:last', new Date().toISOString(), 'EX', 86400);
      return response;
    } catch (error) {
      await this.handleSendFailure(job, 'file', error);
      throw error;
    } finally {
      await this.cleanupUpload(job.data.storagePath);
    }
  }

  async handleCheckAndSend(
    job: Job<{
      sessionId: string;
      userId: string;
      to: string;
      messageType: 'text' | 'file';
      text?: string;
      caption?: string;
      fileName?: string;
      mimeType?: string;
      storagePath?: string;
    }>,
  ) {
    await this.ensureConnected(job.data.sessionId);
    try {
      const numberCheck = await this.whatsappGateway.checkNumber(job.data.sessionId, job.data.to);
      await this.redis.set(`wa:number:${numberCheck.phone}`, JSON.stringify(numberCheck), 'EX', 300);
      await this.redis.set('queue:whatsapp-number-check:last', new Date().toISOString(), 'EX', 86400);

      if (!numberCheck.exists) {
        await this.finalizeMessageLog({
          jobId: String(job.id),
          sessionId: job.data.sessionId,
          userId: job.data.userId,
          to: job.data.to,
          messageType: job.data.messageType,
          status: 'failed',
          errorText: 'WhatsApp number does not exist',
        });
        await this.bumpUsage(job.data.sessionId, false);
        return { ...numberCheck, status: 'failed', reason: 'WhatsApp number does not exist' };
      }

      const response =
        job.data.messageType === 'text'
          ? await this.whatsappGateway.sendText({
              sessionId: job.data.sessionId,
              to: job.data.to,
              text: job.data.text ?? '',
            })
          : await this.whatsappGateway.sendFile({
              sessionId: job.data.sessionId,
              to: job.data.to,
              fileName: job.data.fileName ?? 'file',
              mimeType: job.data.mimeType,
              storagePath: job.data.storagePath,
              caption: job.data.caption,
            });

      await this.finalizeMessageLog({
        jobId: String(job.id),
        sessionId: job.data.sessionId,
        userId: job.data.userId,
        to: job.data.to,
        messageType: job.data.messageType,
        status: 'sent',
        providerMessageId: response.messageId ?? undefined,
      });
      await this.bumpUsage(job.data.sessionId, true);
      await this.redis.set('queue:whatsapp-send:last', new Date().toISOString(), 'EX', 86400);
      return { ...response, numberCheck };
    } catch (error) {
      await this.handleSendFailure(job, job.data.messageType, error);
      throw error;
    } finally {
      if (job.data.messageType === 'file') {
        await this.cleanupUpload(job.data.storagePath);
      }
    }
  }

  async handleCheckNumber(job: Job<{ sessionId: string; phone: string }>) {
    await this.ensureConnected(job.data.sessionId);
    const result = await this.whatsappGateway.checkNumber(job.data.sessionId, job.data.phone);
    await this.redis.set(`wa:number:${result.phone}`, JSON.stringify(result), 'EX', 300);
    await this.redis.set('queue:whatsapp-number-check:last', new Date().toISOString(), 'EX', 86400);
    return result;
  }

  private async ensureConnected(sessionId: string) {
    const session = await this.prisma.whatsAppSession.findUnique({ where: { id: sessionId } });
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (session.status === SessionStatus.CONNECTED) {
      return session;
    }

    const connected = await this.whatsappGateway.ensureConnected(sessionId);
    await this.prisma.whatsAppSession.update({
      where: { id: sessionId },
      data: {
        status: connected.status,
        phoneNumber: connected.phoneNumber,
        pushName: connected.pushName,
        lastSeenAt: new Date(),
      },
    });
    await this.prisma.connectionLog.create({
      data: {
        sessionId,
        eventType: 'session.connected',
        payloadJson: { phoneNumber: connected.phoneNumber, pushName: connected.pushName },
      },
    });
    await this.redis.set(`wa:session:${sessionId}:status`, SessionStatus.CONNECTED, 'EX', 3600);
    return connected;
  }

  private async bumpUsage(sessionId: string, success: boolean) {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    await this.prisma.usageDaily.upsert({
      where: {
        sessionId_date: {
          sessionId,
          date: today,
        },
      },
      update: success ? { sentCount: { increment: 1 } } : { failedCount: { increment: 1 } },
      create: {
        sessionId,
        date: today,
        sentCount: success ? 1 : 0,
        failedCount: success ? 0 : 1,
      },
    });
  }

  private async handleSendFailure(
    job: Job<{ sessionId: string; userId: string; to: string }>,
    messageType: string,
    error: unknown,
  ) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const maxAttempts = typeof job.opts.attempts === 'number' ? job.opts.attempts : 1;
    const isFinalAttempt = job.attemptsMade + 1 >= maxAttempts;

    this.logger.error(message);

    if (!isFinalAttempt) {
      await this.prisma.messageLog.updateMany({
        where: { jobId: String(job.id) },
        data: { errorText: `Retrying: ${message}` },
      });
      return;
    }

    await this.finalizeMessageLog({
      jobId: String(job.id),
      sessionId: job.data.sessionId,
      userId: job.data.userId,
      to: job.data.to,
      messageType,
      status: 'failed',
      errorText: message,
    });
    await this.bumpUsage(job.data.sessionId, false);
  }

  private async finalizeMessageLog(input: {
    jobId: string;
    sessionId: string;
    userId: string;
    to: string;
    messageType: string;
    status: 'sent' | 'failed';
    errorText?: string;
    providerMessageId?: string;
  }) {
    const updated = await this.prisma.messageLog.updateMany({
      where: { jobId: input.jobId },
      data: {
        status: input.status,
        errorText: input.errorText ?? null,
        providerMessageId: input.providerMessageId ?? null,
      },
    });

    if (!updated.count) {
      await this.prisma.messageLog.create({
        data: {
          sessionId: input.sessionId,
          userId: input.userId,
          jobId: input.jobId,
          direction: 'outbound',
          toNumber: input.to,
          messageType: input.messageType,
          status: input.status,
          errorText: input.errorText,
          providerMessageId: input.providerMessageId,
        },
      });
    }
  }

  private async cleanupUpload(storagePath?: string) {
    if (!storagePath) {
      return;
    }

    try {
      await rm(storagePath, { force: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown cleanup error';
      this.logger.warn(`Unable to remove uploaded file ${storagePath}: ${message}`);
    }
  }
}

@Injectable()
@Processor(QueueName.QR)
export class QrWorkerProcessor extends WorkerHost {
  constructor(private readonly jobs: WorkerJobService) {
    super();
  }

  process(job: Job<{ sessionId: string }>) {
    return this.jobs.handleRequestQr(job);
  }
}

@Injectable()
@Processor(QueueName.SEND)
export class SendWorkerProcessor extends WorkerHost {
  constructor(private readonly jobs: WorkerJobService) {
    super();
  }

  process(job: Job<{ sessionId: string; userId: string; to: string; text?: string; fileName?: string; mimeType?: string; storagePath?: string; caption?: string; messageType?: 'text' | 'file' }>) {
    if (job.name === 'sendText') {
      return this.jobs.handleSendText(job as Job<{ sessionId: string; userId: string; to: string; text: string }>);
    }

    if (job.name === 'checkAndSend') {
      return this.jobs.handleCheckAndSend(
        job as Job<{
          sessionId: string;
          userId: string;
          to: string;
          messageType: 'text' | 'file';
          text?: string;
          caption?: string;
          fileName?: string;
          mimeType?: string;
          storagePath?: string;
        }>,
      );
    }

    return this.jobs.handleSendFile(job as Job<{ sessionId: string; userId: string; to: string; fileName: string; mimeType?: string; storagePath: string; caption?: string }>);
  }
}

@Injectable()
@Processor(QueueName.NUMBER_CHECK)
export class NumberCheckWorkerProcessor extends WorkerHost {
  constructor(private readonly jobs: WorkerJobService) {
    super();
  }

  process(job: Job<{ sessionId: string; phone: string }>) {
    return this.jobs.handleCheckNumber(job);
  }
}
