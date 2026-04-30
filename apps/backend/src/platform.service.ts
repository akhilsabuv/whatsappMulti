import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuditAction, SessionStatus, UserRole } from '@whatsapp-platform/common';
import { compare, hash } from 'bcryptjs';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import Redis from 'ioredis';
import * as os from 'os';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from './prisma.service';
import { QueueService } from './queue.service';
import { RealtimeGateway } from './realtime.gateway';
import { JsonPayload, UserEntity } from './types';
import type { Prisma } from '@prisma/client';
import QRCode from 'qrcode';
import { getEncryptionSecret, getJwtSecret, isSwaggerEnabled } from './config';

@Injectable()
export class PlatformService {
  private readonly logger = new Logger(PlatformService.name);
  private readonly redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly queueService: QueueService,
    private readonly realtimeGateway: RealtimeGateway,
  ) {}

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await compare(password, user.passwordHash);
    if (!valid || user.role === UserRole.API_USER) {
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.audit(user.id, AuditAction.LOGIN, 'user', user.id, { email });

    return {
      accessToken: await this.jwtService.signAsync({
        sub: user.id,
        role: user.role,
        email: user.email,
      }),
      user: this.stripSensitiveUser(user),
    };
  }

  me(user: UserEntity) {
    return this.stripSensitiveUser(user);
  }

  async changeOwnPassword(user: UserEntity, currentPassword: string, newPassword: string) {
    if (user.role === UserRole.API_USER) {
      throw new UnauthorizedException('API users cannot use dashboard password change');
    }

    const storedUser = await this.prisma.user.findUnique({ where: { id: user.id } });
    if (!storedUser || !storedUser.isActive) {
      throw new UnauthorizedException('User not active');
    }

    const valid = await compare(currentPassword, storedUser.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hash(newPassword, 10),
      },
    });

    await this.audit(user.id, 'auth.password.changed', 'user', user.id, {
      email: storedUser.email,
      role: storedUser.role,
    });

    return { success: true };
  }

  async createApiUser(admin: UserEntity, input: { role?: UserRole; name?: string; email: string; password?: string; apiKeyName?: string; sessionLabel?: string }) {
    const targetRole = input.role ?? UserRole.API_USER;
    if (![UserRole.ADMIN, UserRole.API_USER].includes(targetRole)) {
      throw new BadRequestException('Only ADMIN or API_USER can be created here');
    }

    if (admin.role !== UserRole.SUPERADMIN && targetRole !== UserRole.API_USER) {
      throw new UnauthorizedException('Admins can only create API users');
    }

    if (targetRole === UserRole.ADMIN && (!input.password || input.password.length < 8)) {
      throw new BadRequestException('Admin accounts require a password of at least 8 characters');
    }

    const email = input.email.trim().toLowerCase();
    const existingUser = await this.prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      throw new BadRequestException('A user with this email already exists');
    }

    const passwordForHash = targetRole === UserRole.API_USER ? randomBytes(32).toString('hex') : input.password!;
    const derivedName = input.name?.trim() || this.deriveNameFromEmail(email);
    let createdUser;
    try {
      createdUser = await this.prisma.user.create({
        data: {
          name: derivedName,
          email,
          passwordHash: await hash(passwordForHash, 10),
          role: targetRole,
          parentAdminId: admin.id,
        },
      });
    } catch (createError) {
      if (typeof createError === 'object' && createError !== null && 'code' in createError && createError.code === 'P2002') {
        throw new BadRequestException('A user with this email already exists');
      }
      throw createError;
    }

    let apiKey: { id: string; rawKey: string; name: string } | null = null;
    let session = null;

    if (targetRole === UserRole.API_USER) {
      apiKey = await this.createApiKeyInternal(
        createdUser.id,
        input.apiKeyName?.trim() || `${createdUser.name} Default Key`,
      );

      session = await this.createSession(createdUser.id, input.sessionLabel?.trim() || 'Primary session');
    }

    await this.audit(admin.id, AuditAction.USER_CREATED, 'user', createdUser.id, {
      email: createdUser.email,
      role: targetRole,
      withApiKey: Boolean(apiKey),
      withSession: Boolean(session),
    });

    return {
      user: this.stripSensitiveUser(createdUser),
      apiKey,
      session,
      docs: this.getApiUserDocsMetadata(),
    };
  }

  async listManagedUsers(admin: UserEntity) {
    if (admin.role === UserRole.SUPERADMIN) {
      const users = await this.prisma.user.findMany({
        where: {
          role: {
            in: [UserRole.ADMIN, UserRole.API_USER],
          },
        },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          parentAdminId: true,
          isActive: true,
          portalTokenVersion: true,
          parentAdmin: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          createdAt: true,
          updatedAt: true,
          sessions: true,
          apiKeys: {
            where: { revokedAt: null },
            select: { id: true, name: true, isActive: true, createdAt: true, lastUsedAt: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      const ownerAuditRows = await this.prisma.auditLog.findMany({
        where: {
          action: AuditAction.USER_CREATED,
          targetType: 'user',
          targetId: {
            in: users.map((user: { id: string }) => user.id),
          },
        },
        select: {
          targetId: true,
          actorUser: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      });

      const ownerByTargetId = new Map<string, { id: string; name: string; email: string }>();
      for (const auditRow of ownerAuditRows) {
        if (auditRow.actorUser && !ownerByTargetId.has(auditRow.targetId)) {
          ownerByTargetId.set(auditRow.targetId, auditRow.actorUser);
        }
      }

      return users.map((user: {
        id: string;
        role: string;
        portalTokenVersion: number;
        sessions: Array<{ id: string }>;
        parentAdmin: { id: string; name: string; email: string } | null;
      } & Record<string, unknown>) => ({
        ...user,
        owner: user.parentAdmin ?? ownerByTargetId.get(user.id) ?? null,
        portalShareUrl:
          user.role === UserRole.API_USER ? this.buildClientPortalUrl(user.id, user.sessions[0]?.id ?? null, user.portalTokenVersion) : null,
      }));
    }

    const users = await this.prisma.user.findMany({
      where: {
        parentAdminId: admin.id,
        role: UserRole.API_USER,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        parentAdminId: true,
        isActive: true,
        portalTokenVersion: true,
        parentAdmin: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        createdAt: true,
        updatedAt: true,
        sessions: true,
        apiKeys: {
          where: { revokedAt: null },
          select: { id: true, name: true, isActive: true, createdAt: true, lastUsedAt: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return users.map((user: {
      id: string;
      portalTokenVersion: number;
      sessions: Array<{ id: string }>;
      parentAdmin: { id: string; name: string; email: string } | null;
    } & Record<string, unknown>) => ({
      ...user,
      owner: {
        id: admin.id,
        name: admin.name,
        email: admin.email,
      },
      portalShareUrl: this.buildClientPortalUrl(user.id, user.sessions[0]?.id ?? null, user.portalTokenVersion),
    }));
  }

  async createApiKeyForManagedUser(admin: UserEntity, userId: string, name: string) {
    await this.assertManagedApiUser(admin, userId);
    const created = await this.createApiKeyInternal(userId, name);
    await this.audit(admin.id, AuditAction.API_KEY_CREATED, 'api_key', created.id, {
      userId,
      name,
      previousKeysBlocked: true,
    });
    return {
      ...created,
      docs: this.getApiUserDocsMetadata(),
    };
  }

  async getApiUserAccessBundle(admin: UserEntity, userId: string) {
    const managedUser = await this.assertManagedApiUser(admin, userId);
    const sessions = await this.prisma.whatsAppSession.findMany({
      where: { userId },
      select: {
        id: true,
        label: true,
        status: true,
        phoneNumber: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    const apiKeys = await this.prisma.apiKey.findMany({
      where: {
        userId,
        revokedAt: null,
      },
      select: {
        id: true,
        name: true,
        rawKeyEnc: true,
        isActive: true,
        createdAt: true,
        lastUsedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      user: {
        id: managedUser.id,
        name: managedUser.name,
        email: managedUser.email,
      },
      apiKeys: apiKeys.map((key: {
        id: string;
        name: string;
        rawKeyEnc: string | null;
        isActive: boolean;
        createdAt: Date;
        lastUsedAt: Date | null;
      }) => {
        let rawKey = null;
        if (key.rawKeyEnc) {
          try {
            rawKey = this.decrypt(key.rawKeyEnc);
          } catch (e) {
            rawKey = '<Decryption Error: Secret Changed>';
          }
        }
        return {
          id: key.id,
          name: key.name,
          rawKey,
          isActive: key.isActive,
          createdAt: key.createdAt,
          lastUsedAt: key.lastUsedAt,
        };
      }),
      sessions,
      docs: this.getApiUserDocsMetadata(),
      portal: {
        shareUrl: this.buildClientPortalUrl(managedUser.id, sessions[0]?.id ?? null, managedUser.portalTokenVersion),
      },
    };
  }

  async getActiveApiKeyForManagedUserByEmail(admin: UserEntity, email: string) {
    const normalizedEmail = email?.trim().toLowerCase();
    if (!normalizedEmail || !normalizedEmail.includes('@')) {
      throw new BadRequestException('A valid email is required');
    }

    const managedUser = await this.prisma.user.findFirst({
      where: {
        email: normalizedEmail,
        role: UserRole.API_USER,
        ...(admin.role === UserRole.SUPERADMIN ? {} : { parentAdminId: admin.id }),
      },
    });

    if (!managedUser) {
      throw new NotFoundException('API user not found');
    }

    const activeKey = await this.prisma.apiKey.findFirst({
      where: {
        userId: managedUser.id,
        isActive: true,
        revokedAt: null,
      },
      select: {
        id: true,
        name: true,
        rawKeyEnc: true,
        isActive: true,
        createdAt: true,
        lastUsedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!activeKey) {
      throw new NotFoundException('Active API key not found');
    }

    let rawKey = null;
    if (activeKey.rawKeyEnc) {
      try {
        rawKey = this.decrypt(activeKey.rawKeyEnc);
      } catch {
        rawKey = '<Decryption Error: Secret Changed>';
      }
    }

    return {
      user: {
        id: managedUser.id,
        name: managedUser.name,
        email: managedUser.email,
      },
      apiKey: {
        id: activeKey.id,
        name: activeKey.name,
        rawKey,
        isActive: activeKey.isActive,
        createdAt: activeKey.createdAt,
        lastUsedAt: activeKey.lastUsedAt,
      },
      docs: this.getApiUserDocsMetadata(),
    };
  }

  async revokeManagedUserPortalLinks(admin: UserEntity, userId: string) {
    const managedUser = await this.assertManagedApiUser(admin, userId);
    const updated = await this.prisma.user.update({
      where: { id: managedUser.id },
      data: { portalTokenVersion: { increment: 1 } },
      include: { sessions: { orderBy: { createdAt: 'asc' }, take: 1 } },
    });

    await this.audit(admin.id, 'client_portal.revoked', 'user', managedUser.id, {});

    return {
      success: true,
      shareUrl: this.buildClientPortalUrl(updated.id, updated.sessions[0]?.id ?? null, updated.portalTokenVersion),
    };
  }

  async deleteManagedUser(admin: UserEntity, userId: string) {
    const managedUser = await this.assertManagedApiUser(admin, userId);
    await this.deleteUsersCascade([userId]);

    await this.audit(admin.id, AuditAction.USER_DELETED, 'user', userId, {
      email: managedUser.email,
      deletedByRole: admin.role,
    });

    return { success: true };
  }

  async revokeApiKey(admin: UserEntity, apiKeyId: string) {
    const key = await this.prisma.apiKey.findUnique({
      where: { id: apiKeyId },
      include: { user: true },
    });

    if (!key) {
      throw new NotFoundException('API key not found');
    }

    const canRevoke =
      admin.role === UserRole.SUPERADMIN
        ? key.user.role === UserRole.API_USER
        : key.user.parentAdminId === admin.id;

    if (!canRevoke) {
      throw new NotFoundException('API key not found');
    }

    await this.prisma.apiKey.update({
      where: { id: apiKeyId },
      data: { isActive: false, revokedAt: new Date() },
    });

    await this.audit(admin.id, AuditAction.API_KEY_REVOKED, 'api_key', apiKeyId, {});
    return { success: true };
  }

  async setApiKeyStatus(admin: UserEntity, apiKeyId: string, isActive: boolean) {
    const key = await this.prisma.apiKey.findUnique({
      where: { id: apiKeyId },
      include: { user: true },
    });

    if (!key || key.revokedAt) {
      throw new NotFoundException('API key not found');
    }

    const canManage =
      admin.role === UserRole.SUPERADMIN
        ? key.user.role === UserRole.API_USER
        : key.user.parentAdminId === admin.id;

    if (!canManage) {
      throw new NotFoundException('API key not found');
    }

    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      if (isActive) {
        await tx.apiKey.updateMany({
          where: {
            userId: key.userId,
            id: { not: apiKeyId },
            revokedAt: null,
          },
          data: { isActive: false },
        });
      }

      await tx.apiKey.update({
        where: { id: apiKeyId },
        data: { isActive },
      });
    });

    await this.audit(admin.id, AuditAction.API_KEY_STATUS_CHANGED, 'api_key', apiKeyId, {
      userId: key.userId,
      isActive,
      otherKeysBlocked: isActive,
    });

    return { success: true };
  }

  async createManagedSession(admin: UserEntity, userId: string, label: string) {
    await this.assertManagedApiUser(admin, userId);
    const session = await this.createSession(userId, label);
    await this.audit(admin.id, AuditAction.SESSION_CREATED, 'session', session.id, { userId, label });
    return session;
  }

  async changeManagedUserPassword(admin: UserEntity, userId: string, password: string) {
    const managedUser = await this.assertManagedApiUser(admin, userId);
    await this.prisma.user.update({
      where: { id: managedUser.id },
      data: {
        passwordHash: await hash(password, 10),
      },
    });

    await this.audit(admin.id, 'user.password.changed', 'user', managedUser.id, {
      email: managedUser.email,
    });

    return { success: true };
  }

  async requestQr(actorUserId: string, sessionId: string) {
    const session = await this.prisma.whatsAppSession.findUnique({ where: { id: sessionId } });
    if (!session) {
      throw new NotFoundException('Session not found');
    }

    await this.prisma.whatsAppSession.update({
      where: { id: session.id },
      data: {
        status: SessionStatus.PENDING_QR,
        qrExpiresAt: new Date(Date.now() + 60_000),
      },
    });

    const job = await this.queueService.enqueue({
      type: 'requestQr',
      sessionId: session.id,
      actorUserId,
    });

    await this.audit(actorUserId, AuditAction.SESSION_QR_REQUESTED, 'session', session.id, {});

    const qr = await this.redis.get(`wa:session:${session.id}:qr`);
    return {
      sessionId: session.id,
      status: SessionStatus.PENDING_QR,
      qr,
      jobId: String(job.id),
    };
  }

  async requestQrForManagedSession(admin: UserEntity, sessionId: string) {
    await this.assertManagedSession(admin, sessionId);
    return this.requestQr(admin.id, sessionId);
  }

  async getManagedSessionLive(admin: UserEntity, sessionId: string) {
    const session = await this.assertManagedSession(admin, sessionId);
    return this.buildSessionLiveState(session);
  }

  async apiSessionStatus(userId: string, fallbackSessionId?: string) {
    const session = await this.resolveUserSession(userId, fallbackSessionId);
    const liveStatus = await this.redis.get(`wa:session:${session.id}:status`);
    return {
      sessionId: session.id,
      status: liveStatus ?? session.status,
      isActive: (liveStatus ?? session.status) === SessionStatus.CONNECTED,
      phoneNumber: session.phoneNumber,
    };
  }

  async queueTextMessage(userId: string, sessionId: string | undefined, to: string, text: string) {
    const session = await this.resolveUserSession(userId, sessionId);
    const job = await this.queueService.enqueue({
      type: 'sendText',
      sessionId: session.id,
      userId,
      to,
      text,
    });

    const message = await this.prisma.messageLog.create({
      data: {
        sessionId: session.id,
        userId,
        jobId: String(job.id),
        direction: 'outbound',
        toNumber: to,
        messageType: 'text',
        status: 'queued',
      },
    });

    await this.audit(userId, AuditAction.MESSAGE_QUEUED, 'session', session.id, { to, type: 'text' });
    this.realtimeGateway.emit('message.status.changed', {
      messageId: message.id,
      jobId: String(job.id),
      sessionId: session.id,
      userId,
      toNumber: to,
      messageType: 'text',
      status: 'queued',
      createdAt: message.createdAt,
    });
    return { jobId: String(job.id), messageId: message.id, status: 'queued' };
  }

  async queueFileMessage(
    userId: string,
    sessionId: string | undefined,
    input: { to: string; caption?: string; fileName: string; mimeType: string; storagePath: string },
  ) {
    this.logger.log(`Queueing file message from ${userId} to ${input.to}: ${input.fileName} (${input.mimeType}) at ${input.storagePath}`);
    const session = await this.resolveUserSession(userId, sessionId);
    const job = await this.queueService.enqueue({
      type: 'sendFile',
      sessionId: session.id,
      userId,
      to: input.to,
      caption: input.caption,
      fileName: input.fileName,
      mimeType: input.mimeType,
      storagePath: input.storagePath,
    });

    const message = await this.prisma.messageLog.create({
      data: {
        sessionId: session.id,
        userId,
        jobId: String(job.id),
        direction: 'outbound',
        toNumber: input.to,
        messageType: 'file',
        status: 'queued',
      },
    });

    await this.audit(userId, AuditAction.MESSAGE_QUEUED, 'session', session.id, { to: input.to, type: input.mimeType });
    this.realtimeGateway.emit('message.status.changed', {
      messageId: message.id,
      jobId: String(job.id),
      sessionId: session.id,
      userId,
      toNumber: input.to,
      messageType: 'file',
      status: 'queued',
      createdAt: message.createdAt,
    });
    return { jobId: String(job.id), messageId: message.id, status: 'queued' };
  }

  async queueCheckedMessage(
    userId: string,
    sessionId: string | undefined,
    input:
      | { to: string; type: 'text'; text: string }
      | { to: string; type: 'file'; text?: string; fileName: string; mimeType: string; storagePath: string },
  ) {
    const session = await this.resolveUserSession(userId, sessionId);
    const job = await this.queueService.enqueue({
      type: 'checkAndSend',
      sessionId: session.id,
      userId,
      to: input.to,
      messageType: input.type,
      text: input.type === 'text' ? input.text : undefined,
      caption: input.type === 'file' ? input.text : undefined,
      fileName: input.type === 'file' ? input.fileName : undefined,
      mimeType: input.type === 'file' ? input.mimeType : undefined,
      storagePath: input.type === 'file' ? input.storagePath : undefined,
    });

    const message = await this.prisma.messageLog.create({
      data: {
        sessionId: session.id,
        userId,
        jobId: String(job.id),
        direction: 'outbound',
        toNumber: input.to,
        messageType: input.type,
        status: 'queued',
      },
    });

    await this.audit(userId, AuditAction.MESSAGE_QUEUED, 'session', session.id, {
      to: input.to,
      type: input.type,
      numberCheckRequired: true,
    });
    this.realtimeGateway.emit('message.status.changed', {
      messageId: message.id,
      jobId: String(job.id),
      sessionId: session.id,
      userId,
      toNumber: input.to,
      messageType: input.type,
      status: 'queued',
      createdAt: message.createdAt,
    });

    return { jobId: String(job.id), messageId: message.id, status: 'queued', numberCheck: 'required' };
  }

  async queueNumberCheck(userId: string, sessionId: string | undefined, phone: string) {
    const session = await this.resolveUserSession(userId, sessionId);
    const job = await this.queueService.enqueue({
      type: 'checkNumber',
      sessionId: session.id,
      phone,
    });

    return {
      phone,
      status: 'queued',
      jobId: String(job.id),
      cached: await this.redis.get(`wa:number:${phone}`),
    };
  }

  async usageForUser(userId: string) {
    const sessions = await this.prisma.whatsAppSession.findMany({
      where: { userId },
      include: { usageDaily: { orderBy: { date: 'desc' }, take: 14 } },
    });

    return sessions.map((session: { id: string; label: string; status: string; usageDaily: unknown[] }) => ({
      sessionId: session.id,
      label: session.label,
      status: session.status,
      daily: session.usageDaily,
    }));
  }

  async getManagedUserMessages(admin: UserEntity, userId: string) {
    await this.assertManagedApiUser(admin, userId);
    return this.prisma.messageLog.findMany({
      where: { userId },
      select: {
        id: true,
        jobId: true,
        providerMessageId: true,
        direction: true,
        toNumber: true,
        messageType: true,
        status: true,
        errorText: true,
        createdAt: true,
        updatedAt: true,
        session: {
          select: {
            id: true,
            label: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 25,
    });
  }

  async getClientPortal(token: string) {
    const { apiUser, session } = await this.resolvePortalToken(token);
    const live = await this.buildSessionLiveState(session);

    return {
      user: {
        id: apiUser.id,
        name: apiUser.name,
        email: apiUser.email,
      },
      session: live,
      shareUrl: this.buildClientPortalUrl(apiUser.id, session.id, apiUser.portalTokenVersion),
    };
  }

  async requestQrFromPortal(token: string) {
    const { apiUser, session } = await this.resolvePortalToken(token);
    return this.requestQr(apiUser.id, session.id);
  }

  async sendPortalTestMessage(token: string, to: string, text: string) {
    const { apiUser, session } = await this.resolvePortalToken(token);
    return this.queueTextMessage(apiUser.id, session.id, to, text);
  }

  async superadminUsers() {
    return this.prisma.user.findMany({
      include: {
        sessions: true,
        apiKeys: {
          select: { id: true, name: true, isActive: true, revokedAt: true, createdAt: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async superadminSetAdminStatus(superadmin: UserEntity, userId: string, isActive: boolean) {
    if (superadmin.role !== UserRole.SUPERADMIN) {
      throw new UnauthorizedException('Only superadmin can change admin status');
    }

    const adminUser = await this.prisma.user.findFirst({
      where: {
        id: userId,
        role: UserRole.ADMIN,
      },
    });

    if (!adminUser) {
      throw new NotFoundException('Admin not found');
    }

    const updated = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const admin = await tx.user.update({
        where: { id: userId },
        data: { isActive },
      });

      if (!isActive) {
        await tx.user.updateMany({
          where: {
            parentAdminId: userId,
            role: UserRole.API_USER,
          },
          data: { isActive: false },
        });

        await tx.apiKey.updateMany({
          where: {
            user: {
              parentAdminId: userId,
              role: UserRole.API_USER,
            },
            revokedAt: null,
          },
          data: { isActive: false },
        });
      }

      return admin;
    });

    await this.audit(superadmin.id, 'user.updated', 'user', userId, {
      role: UserRole.ADMIN,
      isActive,
      childApiAccessBlocked: !isActive,
    });

    return this.stripSensitiveUser(updated);
  }

  async superadminDeleteAdmin(superadmin: UserEntity, userId: string) {
    if (superadmin.role !== UserRole.SUPERADMIN) {
      throw new UnauthorizedException('Only superadmin can delete admins');
    }

    const adminUser = await this.prisma.user.findFirst({
      where: {
        id: userId,
        role: UserRole.ADMIN,
      },
    });

    if (!adminUser) {
      throw new NotFoundException('Admin not found');
    }

    const childUsers = await this.prisma.user.findMany({
      where: {
        parentAdminId: userId,
        role: UserRole.API_USER,
      },
      select: { id: true },
    });

    await this.deleteUsersCascade([userId, ...childUsers.map((item: { id: string }) => item.id)]);

    await this.audit(superadmin.id, AuditAction.USER_DELETED, 'user', userId, {
      role: UserRole.ADMIN,
      deletedChildren: childUsers.length,
    });

    return { success: true, deletedApiUsers: childUsers.length };
  }

  async superadminSessions() {
    return this.prisma.whatsAppSession.findMany({
      include: {
        user: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  private getDockerContainers(): any[] {
    return [];
  }

  async superadminSummary() {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const [users, sessions, sentToday, receivedToday, failedToday, failedJobs, connectionLogs] = await Promise.all([
      this.prisma.user.count({ where: { role: UserRole.ADMIN } }),
      this.prisma.whatsAppSession.findMany(),
      this.prisma.usageDaily.aggregate({ _sum: { sentCount: true } }),
      this.prisma.usageDaily.aggregate({ _sum: { receivedCount: true } }),
      this.prisma.usageDaily.aggregate({ _sum: { failedCount: true } }),
      this.prisma.messageLog.count({ where: { status: 'failed' } }),
      this.prisma.connectionLog.findMany({ orderBy: { createdAt: 'desc' }, take: 10 }),
    ]);
    const queuedToday = await this.prisma.messageLog.count({
      where: {
        status: 'queued',
        createdAt: { gte: today },
      },
    });

    const workerMetricsRaw = await this.redis.get('worker:metrics');
    let workerMetrics = null;
    if (workerMetricsRaw) {
      try {
        workerMetrics = JSON.parse(workerMetricsRaw);
      } catch {}
    }

    const systemHealth = {
      backend: {
        loadavg: os.loadavg(),
        freemem: os.freemem(),
        totalmem: os.totalmem(),
        cpus: os.cpus().length,
      },
      worker: workerMetrics,
    };

    return {
      admins: users,
      apiUsers: await this.prisma.user.count({ where: { role: UserRole.API_USER } }),
      sessions: sessions.length,
      connectedCount: sessions.filter((session: { status: string }) => session.status === SessionStatus.CONNECTED).length,
      disconnectedCount: sessions.filter((session: { status: string }) => session.status === SessionStatus.DISCONNECTED).length,
      qrPendingCount: sessions.filter((session: { status: string }) => session.status === SessionStatus.PENDING_QR).length,
      queuedMessagesToday: queuedToday,
      sentMessagesToday: sentToday._sum.sentCount ?? 0,
      receivedMessagesToday: receivedToday._sum.receivedCount ?? 0,
      failedToday: failedToday._sum.failedCount ?? 0,
      failedJobs,
      recentConnectionEvents: connectionLogs,
      systemHealth,
      containers: this.getDockerContainers(),
    };
  }

  async adminSummary(admin: UserEntity) {
    const managedUsers = await this.prisma.user.findMany({
      where: {
        parentAdminId: admin.id,
        role: UserRole.API_USER,
      },
      include: {
        sessions: {
          include: {
            usageDaily: {
              orderBy: { date: 'desc' },
              take: 1,
            },
          },
        },
      },
    });

    const sessions = managedUsers.flatMap((user: { sessions: Array<{ status: string; usageDaily: Array<{ sentCount: number; receivedCount: number; failedCount: number }> }> }) => user.sessions);
    const latestUsage = sessions.flatMap((session: { usageDaily: Array<{ sentCount: number; receivedCount: number; failedCount: number }> }) => session.usageDaily);
    const sessionIds = sessions.map((session: { id?: string } & Record<string, unknown>) => session.id).filter(Boolean) as string[];
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const queuedToday = sessionIds.length
      ? await this.prisma.messageLog.count({
          where: {
            sessionId: { in: sessionIds },
            status: 'queued',
            createdAt: { gte: today },
          },
        })
      : 0;

    return {
      admins: 0,
      apiUsers: managedUsers.length,
      sessions: sessions.length,
      connectedCount: sessions.filter((session: { status: string }) => session.status === SessionStatus.CONNECTED).length,
      disconnectedCount: sessions.filter((session: { status: string }) => session.status === SessionStatus.DISCONNECTED).length,
      qrPendingCount: sessions.filter((session: { status: string }) => session.status === SessionStatus.PENDING_QR).length,
      queuedMessagesToday: queuedToday,
      sentMessagesToday: latestUsage.reduce((sum: number, item: { sentCount: number }) => sum + item.sentCount, 0),
      receivedMessagesToday: latestUsage.reduce((sum: number, item: { receivedCount: number }) => sum + item.receivedCount, 0),
      failedToday: latestUsage.reduce((sum: number, item: { failedCount: number }) => sum + item.failedCount, 0),
    };
  }

  async usageOverview() {
    return this.prisma.usageDaily.findMany({
      include: {
        session: {
          include: {
            user: {
              select: { name: true, email: true },
            },
          },
        },
      },
      orderBy: { date: 'desc' },
      take: 100,
    });
  }

  async recordSessionEvent(sessionId: string, eventType: string, payload: JsonPayload) {
    await this.prisma.connectionLog.create({
      data: {
        sessionId,
        eventType,
        payloadJson: payload as never,
      },
    });
    this.realtimeGateway.emit(eventType, { sessionId, ...((payload as Record<string, unknown>) ?? {}) });
  }

  async updateSessionStatus(sessionId: string, status: SessionStatus, extras?: { phoneNumber?: string; pushName?: string; qr?: string | null }) {
    const updated = await this.prisma.whatsAppSession.update({
      where: { id: sessionId },
      data: {
        status,
        lastSeenAt: new Date(),
        phoneNumber: extras?.phoneNumber,
        pushName: extras?.pushName,
        qrExpiresAt: status === SessionStatus.PENDING_QR ? new Date(Date.now() + 60_000) : null,
      },
    });

    await this.redis.set(`wa:session:${sessionId}:status`, status, 'EX', 3600);
    if (extras?.qr) {
      await this.redis.set(`wa:session:${sessionId}:qr`, extras.qr, 'EX', 60);
    }

    await this.recordSessionEvent(sessionId, `session.${status === SessionStatus.PENDING_QR ? 'qr.updated' : status}`, {
      status,
      phoneNumber: updated.phoneNumber,
    });

    return updated;
  }

  async persistAuthState(sessionId: string, creds: unknown, keys: unknown) {
    await this.prisma.whatsAppAuthState.upsert({
      where: { sessionId },
      update: {
        credsJson: this.encrypt(JSON.stringify(creds)),
        keysJson: this.encrypt(JSON.stringify(keys)),
      },
      create: {
        sessionId,
        credsJson: this.encrypt(JSON.stringify(creds)),
        keysJson: this.encrypt(JSON.stringify(keys)),
      },
    });
  }

  async readAuthState(sessionId: string) {
    const state = await this.prisma.whatsAppAuthState.findFirst({
      where: { sessionId },
      orderBy: { updatedAt: 'desc' },
    });

    if (!state) {
      return null;
    }

    return {
      creds: JSON.parse(this.decrypt(state.credsJson)),
      keys: JSON.parse(this.decrypt(state.keysJson)),
    };
  }

  async logMessageResult(input: {
    sessionId: string;
    userId: string;
    direction: string;
    toNumber?: string;
    messageType: string;
    status: string;
    errorText?: string;
  }) {
    await this.prisma.messageLog.create({
      data: {
        sessionId: input.sessionId,
        userId: input.userId,
        direction: input.direction,
        toNumber: input.toNumber,
        messageType: input.messageType,
        status: input.status,
        errorText: input.errorText,
      },
    });

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    await this.prisma.usageDaily.upsert({
      where: {
        sessionId_date: {
          sessionId: input.sessionId,
          date: today,
        },
      },
      update: {
        sentCount: input.direction === 'outbound' && input.status === 'sent' ? { increment: 1 } : undefined,
        failedCount: input.status === 'failed' ? { increment: 1 } : undefined,
      },
      create: {
        sessionId: input.sessionId,
        date: today,
        sentCount: input.direction === 'outbound' && input.status === 'sent' ? 1 : 0,
        failedCount: input.status === 'failed' ? 1 : 0,
      },
    });

    this.realtimeGateway.emit('usage.message.count.changed', {
      sessionId: input.sessionId,
      status: input.status,
      messageType: input.messageType,
    });
  }

  private async createApiKeyInternal(userId: string, name: string) {
    const rawKey = this.generateGoogleStyleApiKey();
    const created = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.apiKey.updateMany({
        where: {
          userId,
          revokedAt: null,
          isActive: true,
        },
        data: { isActive: false },
      });

      return tx.apiKey.create({
        data: {
          userId,
          name,
          keyHash: createHash('sha256').update(rawKey).digest('hex'),
          rawKeyEnc: this.encrypt(rawKey),
        },
      });
    });

    return { id: created.id, rawKey, name: created.name };
  }

  private generateGoogleStyleApiKey() {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const bytes = randomBytes(35);
    let suffix = '';

    for (const byte of bytes) {
      suffix += alphabet[byte % alphabet.length];
    }

    return `AIza${suffix}`;
  }

  private buildClientPortalUrl(userId: string, sessionId: string | null, portalTokenVersion: number) {
    const token = this.createClientPortalToken(userId, sessionId, portalTokenVersion);
    return `${this.getPublicAppUrl()}/client-access/${token}`;
  }

  private getPublicAppUrl() {
    return process.env.PUBLIC_APP_URL ?? `http://localhost:${process.env.FRONTEND_PUBLIC_PORT ?? process.env.FRONTEND_PORT ?? 3000}`;
  }

  private createClientPortalToken(userId: string, sessionId: string | null, portalTokenVersion: number) {
    return this.jwtService.sign(
      {
        scope: 'client_portal',
        userId,
        sessionId,
        portalTokenVersion,
      },
      {
        secret: getJwtSecret(),
        expiresIn: process.env.PORTAL_TOKEN_TTL ?? '24h',
      },
    );
  }

  private deriveNameFromEmail(email: string) {
    const localPart = email.split('@')[0] ?? 'api-user';
    const cleaned = localPart
      .replace(/[._-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleaned) {
      return 'API User';
    }

    return cleaned
      .split(' ')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  private getApiUserDocsMetadata() {
    const publicApiUrl = process.env.PUBLIC_API_URL ?? `http://localhost:${process.env.BACKEND_PUBLIC_PORT ?? process.env.BACKEND_PORT ?? 3001}`;
    const swaggerEnabled = isSwaggerEnabled();
    return {
      swaggerUrl: swaggerEnabled ? `${publicApiUrl}/docs` : null,
      swaggerJsonUrl: swaggerEnabled ? `${publicApiUrl}/docs-json` : null,
      apiTag: 'API User',
      authHeader: 'X-API-Key',
      endpoints: [
        'POST /api/session/request-qr',
        'GET /api/session/status',
        'GET /api/contacts/check-number?phone=60123456789',
        'POST /api/messages/send',
        'POST /api/messages/send-text',
        'POST /api/messages/send-file',
        'GET /api/usage/me',
      ],
    };
  }

  private async createSession(userId: string, label: string) {
    return this.prisma.whatsAppSession.create({
      data: {
        userId,
        label,
        status: SessionStatus.CREATED,
      },
    });
  }

  private stripSensitiveUser(user: UserEntity) {
    const { passwordHash, ...safeUser } = user;
    return safeUser;
  }

  private async assertManagedApiUser(admin: UserEntity, userId: string) {
    if (admin.role === UserRole.SUPERADMIN) {
      const managedBySuperadmin = await this.prisma.user.findFirst({
        where: {
          id: userId,
          role: UserRole.API_USER,
        },
      });

      if (!managedBySuperadmin) {
        throw new NotFoundException('User not found');
      }

      return managedBySuperadmin;
    }

    const managed = await this.prisma.user.findFirst({
      where: {
        id: userId,
        role: UserRole.API_USER,
        parentAdminId: admin.id,
      },
    });

    if (!managed) {
      throw new NotFoundException('User not found');
    }

    return managed;
  }

  private async assertManagedSession(admin: UserEntity, sessionId: string) {
    const session = await this.prisma.whatsAppSession.findUnique({
      where: { id: sessionId },
      include: {
        user: true,
      },
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    if (admin.role === UserRole.SUPERADMIN) {
      if (session.user.role !== UserRole.API_USER) {
        throw new NotFoundException('Session not found');
      }
      return session;
    }

    if (session.user.role !== UserRole.API_USER || session.user.parentAdminId !== admin.id) {
      throw new NotFoundException('Session not found');
    }

    return session;
  }

  private async resolvePortalToken(token: string) {
    let payload: { scope?: string; userId?: string; sessionId?: string | null; portalTokenVersion?: number };
    try {
      payload = await this.jwtService.verifyAsync(token, {
        secret: getJwtSecret(),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired portal link');
    }

    if (payload.scope !== 'client_portal' || !payload.userId) {
      throw new UnauthorizedException('Invalid portal link');
    }

    const apiUser = await this.prisma.user.findFirst({
      where: {
        id: payload.userId,
        role: UserRole.API_USER,
        isActive: true,
      },
    });

    if (!apiUser) {
      throw new NotFoundException('Portal user not found');
    }

    if (payload.portalTokenVersion !== apiUser.portalTokenVersion) {
      throw new UnauthorizedException('Portal link has been revoked');
    }

    const session = await this.resolveUserSession(apiUser.id, payload.sessionId ?? undefined);
    return { apiUser, session };
  }

  private async buildSessionLiveState(session: {
    id: string;
    label: string;
    status: string;
    phoneNumber: string | null;
    pushName: string | null;
  }) {
    const [liveStatus, qr] = await Promise.all([
      this.redis.get(`wa:session:${session.id}:status`),
      this.redis.get(`wa:session:${session.id}:qr`),
    ]);

    const qrDataUrl = qr ? await QRCode.toDataURL(qr, { margin: 1, width: 260 }) : null;

    return {
      sessionId: session.id,
      label: session.label,
      status: liveStatus ?? session.status,
      phoneNumber: session.phoneNumber,
      pushName: session.pushName,
      qr,
      qrDataUrl,
      isMockMode: process.env.MOCK_WHATSAPP !== 'false',
    };
  }

  private async resolveUserSession(userId: string, sessionId?: string) {
    const session = await this.prisma.whatsAppSession.findFirst({
      where: {
        userId,
        ...(sessionId ? { id: sessionId } : {}),
      },
      orderBy: { createdAt: 'asc' },
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    return session;
  }

  private async deleteUsersCascade(userIds: string[]) {
    if (!userIds.length) {
      return;
    }

    const sessions = await this.prisma.whatsAppSession.findMany({
      where: { userId: { in: userIds } },
      select: { id: true },
    });
    const sessionIds = sessions.map((session: { id: string }) => session.id);

    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      if (sessionIds.length) {
        await tx.whatsAppAuthState.deleteMany({
          where: { sessionId: { in: sessionIds } },
        });
        await tx.connectionLog.deleteMany({
          where: { sessionId: { in: sessionIds } },
        });
        await tx.usageDaily.deleteMany({
          where: { sessionId: { in: sessionIds } },
        });
        await tx.messageLog.deleteMany({
          where: { sessionId: { in: sessionIds } },
        });
        await tx.whatsAppSession.deleteMany({
          where: { id: { in: sessionIds } },
        });
      }

      await tx.apiKey.deleteMany({
        where: { userId: { in: userIds } },
      });
      await tx.auditLog.deleteMany({
        where: { actorUserId: { in: userIds } },
      });
      await tx.user.deleteMany({
        where: { id: { in: userIds } },
      });
    });
  }

  async audit(actorUserId: string | null, action: string, targetType: string, targetId: string, payload: JsonPayload) {
    await this.prisma.auditLog.create({
      data: {
        actorUserId: actorUserId ?? undefined,
        action,
        targetType,
        targetId,
        payloadJson: payload as never,
      },
    });
  }

  private encrypt(value: string) {
    const secret = Buffer.from(getEncryptionSecret(), 'utf8');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', secret, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]).toString('base64');
  }

  private decrypt(value: string) {
    const secret = Buffer.from(getEncryptionSecret(), 'utf8');
    const input = Buffer.from(value, 'base64');
    const iv = input.subarray(0, 12);
    const tag = input.subarray(12, 28);
    const body = input.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', secret, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
  }
}
