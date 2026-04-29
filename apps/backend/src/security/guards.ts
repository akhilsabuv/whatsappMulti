import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@whatsapp-platform/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma.service';
import { ROLES_KEY } from './decorators';
import { getJwtSecret } from '../config';
import { AUTH_COOKIE_NAME, readCookie } from './cookies';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      const cookieToken = readCookie(request, AUTH_COOKIE_NAME);
      if (!cookieToken) {
        throw new UnauthorizedException('Missing bearer token');
      }

      request.headers.authorization = `Bearer ${cookieToken}`;
    }

    const effectiveAuthHeader = request.headers.authorization;
    const token = effectiveAuthHeader.slice(7);
    const payload = await this.jwtService.verifyAsync(token, {
      secret: getJwtSecret(),
    });

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('User not active');
    }

    request.user = user;
    return true;
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!roles?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    return roles.includes(request.user.role as UserRole);
  }
}

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const rawApiKey = request.headers['x-api-key'];
    if (typeof rawApiKey !== 'string' || rawApiKey.length < 12) {
      throw new BadRequestException('Missing X-API-Key header');
    }

    const hash = createHash('sha256').update(rawApiKey).digest('hex');
    const key = await this.prisma.apiKey.findFirst({
      where: {
        keyHash: hash,
        isActive: true,
        revokedAt: null,
      },
      include: {
        user: {
          include: {
            parentAdmin: true,
            sessions: true,
          },
        },
      },
    });

    if (!key || !key.user.isActive || key.user.parentAdmin?.isActive === false) {
      throw new UnauthorizedException('Invalid API key');
    }

    await this.prisma.apiKey.update({
      where: { id: key.id },
      data: { lastUsedAt: new Date() },
    });

    request.apiKey = key;
    request.apiUser = key.user;
    request.session = key.user.sessions[0] ?? null;
    return true;
  }
}
