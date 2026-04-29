import makeWASocket, {
  BufferJSON,
  DisconnectReason,
  fetchLatestBaileysVersion,
  initAuthCreds,
  proto,
  type AuthenticationCreds,
  type AuthenticationState,
  type ConnectionState,
  type SignalDataTypeMap,
  type WASocket,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SessionStatus } from '@whatsapp-platform/common';
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'crypto';
import { readFile } from 'fs/promises';
import Redis from 'ioredis';
import pino from 'pino';
import { WorkerPrismaService } from './worker.prisma.service';

type PersistedSignalKeys = Record<string, Record<string, unknown>>;

type SessionRuntime = {
  socket: WASocket | null;
  status: SessionStatus;
  qr: string | null;
  phoneNumber: string | null;
  pushName: string | null;
  connectPromise: Promise<void> | null;
  reconnectTimer: NodeJS.Timeout | null;
  closedByService: boolean;
  generation: number;
};

@Injectable()
export class WhatsAppGatewayService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WhatsAppGatewayService.name);
  private readonly redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  private readonly baileysLogger = pino({
    level: process.env.BAILEYS_LOG_LEVEL ?? 'silent',
  });
  private readonly sessions = new Map<string, SessionRuntime>();
  private resolvedVersion: [number, number, number] | null = null;

  constructor(private readonly prisma: WorkerPrismaService) {}

  async onModuleInit() {
    if (process.env.MOCK_WHATSAPP !== 'false') {
      return;
    }

    const sessionsWithAuth = await this.prisma.whatsAppSession.findMany({
      where: {
        authState: {
          some: {},
        },
      },
      select: { id: true },
    });

    await Promise.all(
      sessionsWithAuth.map(async ({ id }: { id: string }) => {
        try {
          await this.connectSession(id);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown startup connect error';
          this.logger.warn(`Unable to restore session ${id}: ${message}`);
        }
      }),
    );
  }

  async onModuleDestroy() {
    await Promise.all(
      Array.from(this.sessions.values()).map(async (runtime) => {
        runtime.closedByService = true;
        runtime.reconnectTimer && clearTimeout(runtime.reconnectTimer);
        try {
          runtime.socket?.ws.close();
        } catch {
          // ignore
        }
      }),
    );
    await this.redis.quit();
  }

  async requestQr(sessionId: string) {
    if (process.env.MOCK_WHATSAPP === 'false') {
      await this.resetSessionForFreshPairing(sessionId);
      await this.connectSession(sessionId, { forceRefresh: true });
      const snapshot = await this.waitForState(sessionId, [
        SessionStatus.PENDING_QR,
        SessionStatus.CONNECTED,
        SessionStatus.LOGGED_OUT,
        SessionStatus.FAILED,
      ]);

      return {
        sessionId,
        status: snapshot.status,
        qr: snapshot.qr,
        phoneNumber: snapshot.phoneNumber,
        pushName: snapshot.pushName,
      };
    }

    return {
      sessionId,
      status: SessionStatus.PENDING_QR,
      qr: `mock-qr:${sessionId}:${randomUUID()}`,
      phoneNumber: null,
      pushName: null,
    };
  }

  async ensureConnected(sessionId: string) {
    if (process.env.MOCK_WHATSAPP === 'false') {
      await this.connectSession(sessionId);
      const snapshot = await this.waitForState(sessionId, [
        SessionStatus.CONNECTED,
        SessionStatus.PENDING_QR,
        SessionStatus.LOGGED_OUT,
        SessionStatus.FAILED,
      ]);

      if (snapshot.status !== SessionStatus.CONNECTED) {
        throw new Error(
          snapshot.status === SessionStatus.PENDING_QR
            ? 'Session requires QR scan before it can be used'
            : `Session is not connected (${snapshot.status})`,
        );
      }

      return {
        sessionId,
        status: snapshot.status,
        phoneNumber: snapshot.phoneNumber,
        pushName: snapshot.pushName,
      };
    }

    return {
      sessionId,
      status: SessionStatus.CONNECTED,
      phoneNumber: '60123456789',
      pushName: 'Mock Session',
    };
  }

  async sendText(input: { sessionId: string; to: string; text: string }) {
    if (process.env.MOCK_WHATSAPP === 'false') {
      const socket = await this.requireConnectedSocket(input.sessionId);
      const result = await socket.sendMessage(this.toJid(input.to), { text: input.text });
      if (!result) {
        throw new Error('WhatsApp did not return a message receipt');
      }
      return { remoteJid: result.key.remoteJid, messageId: result.key.id };
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
    return { remoteJid: `${input.to}@s.whatsapp.net`, messageId: randomUUID() };
  }

  async sendFile(input: {
    sessionId: string;
    to: string;
    fileName: string;
    mimeType?: string;
    storagePath?: string;
    caption?: string;
  }) {
    if (process.env.MOCK_WHATSAPP === 'false') {
      const socket = await this.requireConnectedSocket(input.sessionId);
      if (!input.storagePath) {
        throw new Error('Missing uploaded file path');
      }

      const data = await readFile(input.storagePath);
      const result = await socket.sendMessage(this.toJid(input.to), {
        document: data,
        fileName: input.fileName,
        mimetype: input.mimeType ?? 'application/octet-stream',
        caption: input.caption,
      });
      if (!result) {
        throw new Error('WhatsApp did not return a message receipt');
      }
      return { remoteJid: result.key.remoteJid, messageId: result.key.id };
    }

    await new Promise((resolve) => setTimeout(resolve, 300));
    return { remoteJid: `${input.to}@s.whatsapp.net`, messageId: randomUUID() };
  }

  async checkNumber(sessionId: string, phone: string) {
    if (process.env.MOCK_WHATSAPP === 'false') {
      const socket = await this.requireConnectedSocket(sessionId);
      const cleaned = phone.replace(/\D/g, '');
      const results = (await socket.onWhatsApp(cleaned)) ?? [];
      const first = results[0];
      return {
        phone: cleaned,
        exists: Boolean(first?.exists),
        jid: first?.jid ?? `${cleaned}@s.whatsapp.net`,
      };
    }

    await new Promise((resolve) => setTimeout(resolve, 120));
    const cleaned = phone.replace(/\D/g, '');
    return {
      phone: cleaned,
      exists: cleaned.length >= 10,
      jid: `${cleaned}@s.whatsapp.net`,
    };
  }

  private async requireConnectedSocket(sessionId: string) {
    await this.ensureConnected(sessionId);
    const runtime = this.getRuntime(sessionId);
    if (!runtime.socket) {
      throw new Error('Socket unavailable for connected session');
    }

    return runtime.socket;
  }

  private async connectSession(sessionId: string, options?: { forceRefresh?: boolean }) {
    const runtime = this.getRuntime(sessionId);
    if (
      runtime.socket &&
      runtime.status === SessionStatus.CONNECTED &&
      !options?.forceRefresh
    ) {
      return runtime;
    }

    if (runtime.connectPromise && !options?.forceRefresh) {
      await runtime.connectPromise;
      return runtime;
    }

    if (runtime.reconnectTimer) {
      clearTimeout(runtime.reconnectTimer);
      runtime.reconnectTimer = null;
    }

    if (runtime.socket && options?.forceRefresh) {
      runtime.closedByService = true;
      try {
        runtime.socket.ws.close();
      } catch {
        // ignore
      }
      runtime.socket = null;
    }

    const generation = runtime.generation + 1;
    runtime.generation = generation;

    runtime.connectPromise = this.createSocket(sessionId, runtime, generation).finally(() => {
      runtime.connectPromise = null;
    });
    await runtime.connectPromise;
    return runtime;
  }

  private async createSocket(sessionId: string, runtime: SessionRuntime, generation: number) {
    const state = await this.loadAuthState(sessionId);
    const version = await this.getBaileysVersion();
    const socket = makeWASocket({
      auth: state,
      ...(version ? { version } : {}),
      printQRInTerminal: false,
      logger: this.baileysLogger,
      markOnlineOnConnect: true,
    });

    runtime.socket = socket;
    runtime.closedByService = false;

    socket.ev.on('creds.update', async () => {
      if (runtime.generation !== generation) {
        return;
      }
      try {
        await this.saveAuthState(sessionId, state.creds, state.keysData);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to persist creds';
        this.logger.error(`Failed to save auth creds for ${sessionId}: ${message}`);
      }
    });

    socket.ev.on('connection.update', async (update: Partial<ConnectionState>) => {
      if (runtime.generation !== generation) {
        return;
      }
      try {
        await this.handleConnectionUpdate(sessionId, runtime, update, state.creds, state.keysData);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown connection update error';
        this.logger.error(`Connection update failed for ${sessionId}: ${message}`);
      }
    });
  }

  private async handleConnectionUpdate(
    sessionId: string,
    runtime: SessionRuntime,
    update: Partial<ConnectionState>,
    creds: AuthenticationCreds,
    keysData: PersistedSignalKeys,
  ) {
    if (update.qr) {
      runtime.qr = update.qr;
      runtime.status = SessionStatus.PENDING_QR;
      await this.persistSessionState(sessionId, SessionStatus.PENDING_QR, {
        qr: update.qr,
        phoneNumber: runtime.phoneNumber,
        pushName: runtime.pushName,
      });
      return;
    }

    if (update.connection === 'open') {
      const phoneNumber = this.extractPhoneNumber(runtime.socket?.user?.id);
      const pushName = runtime.socket?.user?.name ?? null;
      runtime.status = SessionStatus.CONNECTED;
      runtime.qr = null;
      runtime.phoneNumber = phoneNumber;
      runtime.pushName = pushName;
      await this.saveAuthState(sessionId, creds, keysData);
      await this.persistSessionState(sessionId, SessionStatus.CONNECTED, {
        phoneNumber,
        pushName,
        qr: null,
      });
      return;
    }

    if (update.connection === 'connecting') {
      runtime.status = runtime.qr ? SessionStatus.PENDING_QR : SessionStatus.RECONNECTING;
      if (!runtime.qr) {
        await this.persistSessionState(sessionId, SessionStatus.RECONNECTING, {
          phoneNumber: runtime.phoneNumber,
          pushName: runtime.pushName,
        });
      }
      return;
    }

    if (update.connection === 'close') {
      const statusCode = (update.lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
      const disconnectMessage =
        update.lastDisconnect?.error instanceof Error
          ? update.lastDisconnect.error.message
          : statusCode
            ? `Disconnect status ${statusCode}`
            : 'Unknown disconnect';
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      runtime.socket = null;
      runtime.qr = null;

      if (loggedOut) {
        runtime.status = SessionStatus.LOGGED_OUT;
        await this.prisma.whatsAppAuthState.deleteMany({
          where: { sessionId },
        });
        await this.persistSessionState(sessionId, SessionStatus.LOGGED_OUT, {
          phoneNumber: runtime.phoneNumber,
          pushName: runtime.pushName,
          qr: null,
        });
        return;
      }

      runtime.status = SessionStatus.DISCONNECTED;
      this.logger.warn(`Session ${sessionId} disconnected before ready: ${disconnectMessage}`);
      await this.persistSessionState(sessionId, SessionStatus.DISCONNECTED, {
        phoneNumber: runtime.phoneNumber,
        pushName: runtime.pushName,
        qr: null,
      });

      if (!runtime.closedByService) {
        runtime.reconnectTimer = setTimeout(() => {
          void this.connectSession(sessionId).catch((error) => {
            const message = error instanceof Error ? error.message : 'Reconnect failed';
            this.logger.warn(`Reconnect failed for ${sessionId}: ${message}`);
          });
        }, 2_500);
      }
    }
  }

  private async loadAuthState(sessionId: string) {
    const persisted = await this.prisma.whatsAppAuthState.findUnique({
      where: { sessionId },
    });

    const keysData: PersistedSignalKeys = persisted
      ? JSON.parse(this.decrypt(persisted.keysJson), BufferJSON.reviver)
      : {};
    const creds: AuthenticationCreds = persisted
      ? JSON.parse(this.decrypt(persisted.credsJson), BufferJSON.reviver)
      : initAuthCreds();

    const state: AuthenticationState = {
      creds,
      keys: {
        get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
          const keyStore = keysData[type] ?? {};
          const values = {} as { [id: string]: SignalDataTypeMap[T] };

          for (const id of ids) {
            const value = keyStore[id];
            values[id] =
              type === 'app-state-sync-key' && value
                ? (proto.Message.AppStateSyncKeyData.fromObject(
                    value as Record<string, unknown>,
                  ) as unknown as SignalDataTypeMap[T])
                : (value as SignalDataTypeMap[T]);
          }

          return values;
        },
        set: async (data: Record<string, Record<string, unknown | null>>) => {
          for (const category of Object.keys(data)) {
            keysData[category] ??= {};
            for (const id of Object.keys(data[category] ?? {})) {
              const value = data[category]?.[id];
              if (value) {
                keysData[category][id] = value;
              } else {
                delete keysData[category][id];
              }
            }
          }

          await this.saveAuthState(sessionId, creds, keysData);
        },
      },
    };

    return { ...state, keysData };
  }

  private async saveAuthState(sessionId: string, creds: AuthenticationCreds, keysData: PersistedSignalKeys) {
    await this.prisma.whatsAppAuthState.upsert({
      where: { sessionId },
      update: {
        credsJson: this.encrypt(JSON.stringify(creds, BufferJSON.replacer)),
        keysJson: this.encrypt(JSON.stringify(keysData, BufferJSON.replacer)),
      },
      create: {
        sessionId,
        credsJson: this.encrypt(JSON.stringify(creds, BufferJSON.replacer)),
        keysJson: this.encrypt(JSON.stringify(keysData, BufferJSON.replacer)),
      },
    });
  }

  private async persistSessionState(
    sessionId: string,
    status: SessionStatus,
    extras?: { phoneNumber?: string | null; pushName?: string | null; qr?: string | null },
  ) {
    const updateResult = await this.prisma.whatsAppSession.updateMany({
      where: { id: sessionId },
      data: {
        status,
        phoneNumber: extras?.phoneNumber ?? undefined,
        pushName: extras?.pushName ?? undefined,
        lastSeenAt: new Date(),
        qrExpiresAt: status === SessionStatus.PENDING_QR ? new Date(Date.now() + 60_000) : null,
      },
    });

    if (!updateResult.count) {
      this.logger.warn(`Skipping session state persistence for missing session ${sessionId}`);
      await this.redis.del(`wa:session:${sessionId}:status`, `wa:session:${sessionId}:qr`);
      this.disposeRuntime(sessionId);
      return;
    }

    const updated = await this.prisma.whatsAppSession.findUnique({
      where: { id: sessionId },
      select: {
        phoneNumber: true,
        pushName: true,
      },
    });

    await this.prisma.connectionLog.create({
      data: {
        sessionId,
        eventType: `session.${status === SessionStatus.PENDING_QR ? 'qr.updated' : status}`,
        payloadJson: {
          status,
          qr: extras?.qr ?? null,
          phoneNumber: updated?.phoneNumber ?? extras?.phoneNumber ?? null,
          pushName: updated?.pushName ?? extras?.pushName ?? null,
        },
      },
    });

    await this.redis.set(`wa:session:${sessionId}:status`, status, 'EX', 3600);
    if (extras?.qr) {
      await this.redis.set(`wa:session:${sessionId}:qr`, extras.qr, 'EX', 60);
    } else {
      await this.redis.del(`wa:session:${sessionId}:qr`);
    }
  }

  private async resetSessionForFreshPairing(sessionId: string) {
    this.disposeRuntime(sessionId);
    await this.prisma.whatsAppAuthState.deleteMany({
      where: { sessionId },
    });
    await this.redis.del(`wa:session:${sessionId}:status`, `wa:session:${sessionId}:qr`);
    await this.prisma.whatsAppSession.updateMany({
      where: { id: sessionId },
      data: {
        status: SessionStatus.CREATED,
        phoneNumber: null,
        pushName: null,
        lastSeenAt: null,
        qrExpiresAt: null,
      },
    });
  }

  private disposeRuntime(sessionId: string) {
    const runtime = this.sessions.get(sessionId);
    if (!runtime) {
      return;
    }

    runtime.closedByService = true;
    if (runtime.reconnectTimer) {
      clearTimeout(runtime.reconnectTimer);
      runtime.reconnectTimer = null;
    }

    try {
      runtime.socket?.ws.close();
    } catch {
      // ignore
    }

    this.sessions.delete(sessionId);
  }

  private async waitForState(sessionId: string, statuses: SessionStatus[], timeoutMs = 45_000) {
    const runtime = this.getRuntime(sessionId);
    if (statuses.includes(runtime.status)) {
      return runtime;
    }

    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const current = this.getRuntime(sessionId);
      if (statuses.includes(current.status)) {
        return current;
      }
    }

    throw new Error(`Timed out waiting for session ${sessionId} to reach ${statuses.join(', ')}`);
  }

  private getRuntime(sessionId: string) {
    let runtime = this.sessions.get(sessionId);
    if (!runtime) {
      runtime = {
        socket: null,
        status: SessionStatus.CREATED,
        qr: null,
        phoneNumber: null,
        pushName: null,
        connectPromise: null,
        reconnectTimer: null,
        closedByService: false,
        generation: 0,
      };
      this.sessions.set(sessionId, runtime);
    }

    return runtime;
  }

  private async getBaileysVersion() {
    if (this.resolvedVersion) {
      return this.resolvedVersion;
    }

    try {
      const { version } = await fetchLatestBaileysVersion();
      this.resolvedVersion = version;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown version fetch error';
      this.logger.warn(`Unable to fetch latest Baileys version, using bundled default: ${message}`);
    }

    return this.resolvedVersion;
  }

  private toJid(phone: string) {
    return phone.includes('@') ? phone : `${phone.replace(/\D/g, '')}@s.whatsapp.net`;
  }

  private extractPhoneNumber(jid?: string | null) {
    if (!jid) {
      return null;
    }

    return jid.split(':')[0]?.split('@')[0] ?? null;
  }

  private encrypt(value: string) {
    const secret = Buffer.from(this.getEncryptionSecret(), 'utf8');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', secret, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  private decrypt(value: string) {
    const secret = Buffer.from(this.getEncryptionSecret(), 'utf8');
    const [ivHex, tagHex, encryptedHex] = value.split(':');
    const decipher = createDecipheriv('aes-256-gcm', secret, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedHex, 'hex')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  }

  private getEncryptionSecret() {
    const secret = process.env.ENCRYPTION_SECRET;
    if (!secret && process.env.NODE_ENV === 'production') {
      throw new Error('ENCRYPTION_SECRET is required in production');
    }

    const resolved = secret ?? 'dev-only-32-byte-encryption-key!';
    if (resolved.length !== 32) {
      throw new Error('ENCRYPTION_SECRET must be exactly 32 characters');
    }

    return resolved;
  }
}
