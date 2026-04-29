import type { Request, Response } from 'express';
import { isSecureCookieEnabled } from '../config';

export const AUTH_COOKIE_NAME = 'wa_auth';
export const CSRF_COOKIE_NAME = 'wa_csrf';

export function readCookie(request: Request, name: string) {
  const header = request.headers.cookie;
  if (!header) {
    return null;
  }

  const match = header
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));

  if (!match) {
    return null;
  }

  return decodeURIComponent(match.slice(name.length + 1));
}

export function setAuthCookie(response: Response, token: string) {
  response.cookie(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isSecureCookieEnabled(),
    sameSite: isSecureCookieEnabled() ? 'none' : 'lax',
    maxAge: 12 * 60 * 60 * 1000,
    path: '/',
  });
}

export function setCsrfCookie(response: Response, token: string) {
  response.cookie(CSRF_COOKIE_NAME, token, {
    httpOnly: false,
    secure: isSecureCookieEnabled(),
    sameSite: isSecureCookieEnabled() ? 'none' : 'lax',
    maxAge: 12 * 60 * 60 * 1000,
    path: '/',
  });
}

export function clearAuthCookie(response: Response) {
  response.clearCookie(AUTH_COOKIE_NAME, {
    httpOnly: true,
    secure: isSecureCookieEnabled(),
    sameSite: isSecureCookieEnabled() ? 'none' : 'lax',
    path: '/',
  });
  response.clearCookie(CSRF_COOKIE_NAME, {
    httpOnly: false,
    secure: isSecureCookieEnabled(),
    sameSite: isSecureCookieEnabled() ? 'none' : 'lax',
    path: '/',
  });
}
