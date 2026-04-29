const PLACEHOLDER_VALUES = new Set([
  'change-me-super-secret',
  '01234567890123456789012345678901',
  'ChangeMe123!',
  'postgres',
  'owner@example.com',
  'admin@example.com',
]);

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

function requireEnv(name: string, options?: { minLength?: number; exactLength?: number; allowPlaceholderInDev?: boolean }) {
  const value = process.env[name];
  if (!value) {
    if (isProduction()) {
      throw new Error(`Missing required environment variable ${name}`);
    }
    return undefined;
  }

  if (options?.exactLength && value.length !== options.exactLength) {
    throw new Error(`${name} must be exactly ${options.exactLength} characters`);
  }

  if (options?.minLength && value.length < options.minLength) {
    throw new Error(`${name} must be at least ${options.minLength} characters`);
  }

  if (isProduction() && PLACEHOLDER_VALUES.has(value)) {
    throw new Error(`${name} is using an unsafe placeholder value`);
  }

  return value;
}

export function validateRuntimeConfig() {
  requireEnv('DATABASE_URL');
  requireEnv('REDIS_URL');
  requireEnv('JWT_SECRET', { minLength: 32 });
  requireEnv('ENCRYPTION_SECRET', { exactLength: 32 });

  if (isProduction()) {
    requireEnv('PUBLIC_APP_URL');
    requireEnv('ALLOWED_ORIGINS');
    requireEnv('SUPERADMIN_EMAIL');
    requireEnv('SUPERADMIN_PASSWORD', { minLength: 12 });
    requireEnv('DEFAULT_ADMIN_EMAIL');
    requireEnv('DEFAULT_ADMIN_PASSWORD', { minLength: 12 });
  }
}

export function getJwtSecret() {
  const secret = requireEnv('JWT_SECRET', { minLength: isProduction() ? 32 : 16 });
  if (secret) {
    return secret;
  }

  return 'dev-only-jwt-secret-change-before-production';
}

export function getEncryptionSecret() {
  const secret = requireEnv('ENCRYPTION_SECRET', { exactLength: 32 });
  if (secret) {
    return secret;
  }

  return 'dev-only-32-byte-encryption-key!';
}

export function getAllowedOrigins() {
  const configured = process.env.ALLOWED_ORIGINS;
  if (!configured) {
    return isProduction() ? [] : ['http://localhost:3000', 'http://localhost:3100'];
  }

  return configured
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function isSwaggerEnabled() {
  return process.env.ENABLE_SWAGGER === 'true' || (!isProduction() && process.env.ENABLE_SWAGGER !== 'false');
}

export function isSecureCookieEnabled() {
  return isProduction() || process.env.COOKIE_SECURE === 'true';
}
