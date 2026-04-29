import { Controller, Get } from '@nestjs/common';
import { ObservabilityService } from '../observability.service';
import { PrismaService } from '../prisma.service';
import { WorkerStatusService } from '../worker-status.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workerStatusService: WorkerStatusService,
    private readonly observability: ObservabilityService,
  ) {}

  @Get()
  async health() {
    await this.prisma.$queryRaw`SELECT 1`;
    const worker = await this.workerStatusService.getWorkerStatus();
    return {
      ok: true,
      database: 'up',
      worker,
      timestamp: new Date().toISOString(),
    };
  }

  @Get('metrics')
  async metrics() {
    return this.observability.snapshot();
  }
}
