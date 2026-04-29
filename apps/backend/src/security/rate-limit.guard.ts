import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { Request } from 'express';

type Bucket = {
  resetAt: number;
  count: number;
};

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly buckets = new Map<string, Bucket>();

  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    const now = Date.now();
    const policy = this.getPolicy(request);
    const key = `${policy.name}:${this.getClientKey(request)}`;
    const bucket = this.buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + policy.windowMs });
      this.cleanup(now);
      return true;
    }

    bucket.count += 1;
    if (bucket.count > policy.limit) {
      throw new HttpException('Too many requests. Please slow down and try again shortly.', HttpStatus.TOO_MANY_REQUESTS);
    }

    return true;
  }

  private getPolicy(request: Request) {
    const path = request.path ?? request.url ?? '';
    if (path === '/auth/login') {
      return { name: 'login', limit: Number(process.env.RATE_LIMIT_LOGIN_MAX ?? 10), windowMs: 60_000 };
    }

    if (path.includes('/request-qr')) {
      return { name: 'qr', limit: Number(process.env.RATE_LIMIT_QR_MAX ?? 12), windowMs: 60_000 };
    }

    if (path.includes('/messages/')) {
      return { name: 'messages', limit: Number(process.env.RATE_LIMIT_MESSAGES_MAX ?? 120), windowMs: 60_000 };
    }

    return { name: 'global', limit: Number(process.env.RATE_LIMIT_GLOBAL_MAX ?? 600), windowMs: 60_000 };
  }

  private getClientKey(request: Request) {
    const apiKey = request.headers['x-api-key'];
    if (typeof apiKey === 'string') {
      return `key:${apiKey.slice(-12)}`;
    }

    return `ip:${request.ip ?? request.socket.remoteAddress ?? 'unknown'}`;
  }

  private cleanup(now: number) {
    if (this.buckets.size < 10_000) {
      return;
    }

    for (const [key, bucket] of this.buckets.entries()) {
      if (bucket.resetAt <= now) {
        this.buckets.delete(key);
      }
    }
  }
}
