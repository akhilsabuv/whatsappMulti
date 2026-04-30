const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const { test } = require('node:test');

function read(path) {
  return readFileSync(path, 'utf8');
}

test('cookie-auth mutating requests are protected by CSRF guard and frontend headers', () => {
  const csrfGuard = read('apps/backend/src/security/csrf.guard.ts');
  const appModule = read('apps/backend/src/app.module.ts');
  const dashboard = read('apps/frontend/components/dashboard-client.tsx');
  const userManage = read('apps/frontend/components/user-manage-client.tsx');

  assert.match(csrfGuard, /x-csrf-token/);
  assert.match(csrfGuard, /AUTH_COOKIE_NAME/);
  assert.match(csrfGuard, /CSRF_COOKIE_NAME/);
  assert.match(csrfGuard, /Origin is not allowed/);
  assert.match(appModule, /useClass: CsrfGuard/);
  assert.match(dashboard, /csrfHeaders\(\)/);
  assert.match(userManage, /csrfHeaders\(\)/);
});

test('portal bearer links are short lived and version-revocable', () => {
  const platform = read('apps/backend/src/platform.service.ts');
  const schema = read('apps/backend/prisma/schema.prisma');
  const migration = read('apps/backend/prisma/migrations/20260427010000_portal_token_version/migration.sql');
  const controller = read('apps/backend/src/controllers/admin.controller.ts');

  assert.match(schema, /portalTokenVersion\s+Int\s+@default\(0\)/);
  assert.match(migration, /portal_token_version/);
  assert.match(platform, /portalTokenVersion/);
  assert.match(platform, /PORTAL_TOKEN_TTL \?\? '24h'/);
  assert.doesNotMatch(platform, /expiresIn: '30d'/);
  assert.match(platform, /Portal link has been revoked/);
  assert.match(controller, /portal\/revoke/);
});

test('role and ownership guards cover admin and API-key access paths', () => {
  const adminController = read('apps/backend/src/controllers/admin.controller.ts');
  const apiController = read('apps/backend/src/controllers/api.controller.ts');
  const guards = read('apps/backend/src/security/guards.ts');
  const platform = read('apps/backend/src/platform.service.ts');

  assert.match(adminController, /@UseGuards\(JwtAuthGuard, RolesGuard\)/);
  assert.match(adminController, /@Roles\(UserRole.ADMIN, UserRole.SUPERADMIN\)/);
  assert.match(apiController, /@UseGuards\(ApiKeyGuard\)/);
  assert.match(guards, /keyHash: hash/);
  assert.match(platform, /assertManagedApiUser/);
  assert.match(platform, /assertManagedSession/);
  assert.match(platform, /parentAdminId: admin.id/);
  assert.match(adminController, /api-users\/active-api-key/);
  assert.match(platform, /getActiveApiKeyForManagedUserByEmail/);
  assert.match(platform, /email: normalizedEmail/);
});

test('uploads are content-sniffed, optionally malware-scanned, and cleaned up', () => {
  const uploadSecurity = read('apps/backend/src/upload-security.service.ts');
  const apiController = read('apps/backend/src/controllers/api.controller.ts');
  const worker = read('apps/worker/src/worker.processor.ts');

  assert.match(uploadSecurity, /%PDF-/);
  assert.match(uploadSecurity, /RIFF/);
  assert.match(uploadSecurity, /file\.mimetype !== detected\.mimeType/);
  assert.match(uploadSecurity, /CLAMSCAN_PATH/);
  assert.match(uploadSecurity, /REQUIRE_MALWARE_SCAN/);
  assert.match(apiController, /uploadSecurity\.inspect/);
  assert.match(worker, /cleanupUpload/);
  assert.match(worker, /rm\(storagePath/);
});

test('queue failures are captured for dead-letter observability', () => {
  const workerObservability = read('apps/worker/src/worker-observability.service.ts');
  const backendObservability = read('apps/backend/src/observability.service.ts');
  const runbookExists = existsSync('docs/operations-runbook.md');

  assert.equal(runbookExists, true);
  assert.match(workerObservability, /queue:dead-letter/);
  assert.match(workerObservability, /ALERT_WEBHOOK_URL/);
  assert.match(backendObservability, /recentDeadLetters/);
});
