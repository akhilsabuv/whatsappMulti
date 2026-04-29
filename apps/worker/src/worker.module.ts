import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NumberCheckWorkerProcessor, QrWorkerProcessor, SendWorkerProcessor } from './worker.processor';
import { WorkerJobService } from './worker.processor';
import { WorkerPrismaService } from './worker.prisma.service';
import { WhatsAppGatewayService } from './whatsapp-gateway.service';
import { WorkerHeartbeatService } from './worker-heartbeat.service';
import { WorkerObservabilityService } from './worker-observability.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    BullModule.forRoot({
      connection: {
        url: process.env.REDIS_URL ?? 'redis://localhost:6379',
      },
    }),
    BullModule.registerQueue(
      { name: 'whatsapp-send' },
      { name: 'whatsapp-qr' },
      { name: 'whatsapp-number-check' },
    ),
  ],
  providers: [
    WorkerPrismaService,
    WorkerJobService,
    QrWorkerProcessor,
    SendWorkerProcessor,
    NumberCheckWorkerProcessor,
    WhatsAppGatewayService,
    WorkerHeartbeatService,
    WorkerObservabilityService,
  ],
})
export class WorkerModule {}
