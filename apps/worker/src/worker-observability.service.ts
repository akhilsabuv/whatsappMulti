import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { QueueEvents } from 'bullmq';
import Redis from 'ioredis';
import { QueueName } from '@whatsapp-platform/common';

@Injectable()
export class WorkerObservabilityService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkerObservabilityService.name);
  private readonly redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  private readonly queueEvents = [
    new QueueEvents(QueueName.SEND, { connection: { url: process.env.REDIS_URL ?? 'redis://localhost:6379' } }),
    new QueueEvents(QueueName.QR, { connection: { url: process.env.REDIS_URL ?? 'redis://localhost:6379' } }),
    new QueueEvents(QueueName.NUMBER_CHECK, { connection: { url: process.env.REDIS_URL ?? 'redis://localhost:6379' } }),
  ];

  onModuleInit() {
    for (const events of this.queueEvents) {
      events.on('failed', ({ jobId, failedReason, prev }) => {
        void this.recordDeadLetter(events.name, String(jobId), failedReason ?? 'Unknown failure', { prev });
      });
    }
  }

  async onModuleDestroy() {
    await Promise.all(this.queueEvents.map((events) => events.close()));
    await this.redis.quit();
  }

  async recordDeadLetter(queueName: string, jobId: string, reason: string, metadata?: Record<string, unknown>) {
    const payload = {
      queueName,
      jobId,
      reason,
      metadata,
      timestamp: new Date().toISOString(),
    };

    this.logger.error(JSON.stringify({ event: 'queue.dead_letter', ...payload }));

    await this.redis
      .multi()
      .lpush('queue:dead-letter', JSON.stringify(payload))
      .ltrim('queue:dead-letter', 0, Number(process.env.DEAD_LETTER_RETAIN_COUNT ?? 500))
      .incr(`metrics:queue:${queueName}:failed_total`)
      .set(`queue:${queueName}:last_failure`, JSON.stringify(payload), 'EX', 86400)
      .exec();

    await this.sendAlert(payload);
  }

  private async sendAlert(payload: Record<string, unknown>) {
    const webhookUrl = process.env.ALERT_WEBHOOK_URL;
    if (!webhookUrl) {
      return;
    }

    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'whatsapp-worker',
          severity: 'error',
          ...payload,
        }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown alert webhook error';
      this.logger.warn(`Unable to send alert webhook: ${message}`);
    }
  }
}

