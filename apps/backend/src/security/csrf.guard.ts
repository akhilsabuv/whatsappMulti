import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { timingSafeEqual } from 'crypto';
import { getAllowedOrigins } from '../config';
import { AUTH_COOKIE_NAME, CSRF_COOKIE_NAME, readCookie } from './cookies';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(request.method)) {
      return true;
    }

    if (request.path === '/auth/login' || request.path.startsWith('/client-portal/')) {
      return true;
    }

    if (typeof request.headers['x-api-key'] === 'string') {
      return true;
    }

    if (!readCookie(request, AUTH_COOKIE_NAME)) {
      return true;
    }

    this.assertAllowedOrigin(request);
    const cookieToken = readCookie(request, CSRF_COOKIE_NAME);
    const headerToken = request.headers['x-csrf-token'];

    if (!cookieToken || typeof headerToken !== 'string' || !safeCompare(cookieToken, headerToken)) {
      throw new ForbiddenException('Invalid CSRF token');
    }

    return true;
  }

  private assertAllowedOrigin(request: Request) {
    const origin = request.headers.origin;
    if (!origin) {
      return;
    }

    if (!getAllowedOrigins().includes(origin)) {
      throw new ForbiddenException('Origin is not allowed');
    }
  }
}

function safeCompare(a: string, b: string) {
  const first = Buffer.from(a);
  const second = Buffer.from(b);
  return first.length === second.length && timingSafeEqual(first, second);
}

