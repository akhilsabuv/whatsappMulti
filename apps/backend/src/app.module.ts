import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { MulterModule } from '@nestjs/platform-express';
import { APP_GUARD } from '@nestjs/core';
import { ApiController } from './controllers/api.controller';
import { AuthController } from './controllers/auth.controller';
import { ClientPortalController } from './controllers/client-portal.controller';
import { HealthController } from './controllers/health.controller';
import { SuperadminController } from './controllers/superadmin.controller';
import { AdminController } from './controllers/admin.controller';
import { ApiKeyGuard, JwtAuthGuard, RolesGuard } from './security/guards';
import { PlatformService } from './platform.service';
import { PrismaService } from './prisma.service';
import { RealtimeGateway } from './realtime.gateway';
import { QueueService } from './queue.service';
import { WorkerStatusService } from './worker-status.service';
import { getJwtSecret } from './config';
import { RateLimitGuard } from './security/rate-limit.guard';
import { UploadSecurityService } from './upload-security.service';
import { ObservabilityService } from './observability.service';
import { CsrfGuard } from './security/csrf.guard';
import { BackupService } from './backup.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    JwtModule.register({
      global: true,
      secret: getJwtSecret(),
      signOptions: { expiresIn: '12h' },
    }),
    BullModule.forRoot({
      connection: {
        url: process.env.REDIS_URL ?? 'redis://localhost:6379',
      },
    }),
    BullModule.registerQueue(
      { name: 'whatsapp-send' },
      { name: 'whatsapp-qr' },
      { name: 'whatsapp-number-check' },
      { name: 'whatsapp-reconnect' },
      { name: 'whatsapp-maintenance' },
    ),
    MulterModule.register({
      dest: process.env.UPLOAD_DIR ?? '/shared/uploads',
      limits: {
        fileSize: Number(process.env.FILE_MAX_MB ?? 10) * 1024 * 1024,
        files: 1,
        fields: 4,
        fieldSize: 16 * 1024,
      },
    }),
  ],
  controllers: [
    AuthController,
    SuperadminController,
    AdminController,
    ApiController,
    ClientPortalController,
    HealthController,
  ],
  providers: [
    PrismaService,
    PlatformService,
    RealtimeGateway,
    QueueService,
    WorkerStatusService,
    UploadSecurityService,
    ObservabilityService,
    BackupService,
    JwtAuthGuard,
    ApiKeyGuard,
    RolesGuard,
    {
      provide: APP_GUARD,
      useClass: RateLimitGuard,
    },
    {
      provide: APP_GUARD,
      useClass: CsrfGuard,
    },
  ],
})
export class AppModule {}
