import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import * as os from 'os';

@Injectable()
export class WorkerHeartbeatService implements OnModuleInit, OnModuleDestroy {
  private readonly redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  private interval?: NodeJS.Timeout;

  async onModuleInit() {
    await this.reportMetrics();
    this.interval = setInterval(async () => {
      await this.reportMetrics();
    }, 15_000);
  }

  private async reportMetrics() {
    await this.redis.set('worker:heartbeat', new Date().toISOString(), 'EX', 120);
    const metrics = {
      loadavg: os.loadavg(),
      freemem: os.freemem(),
      totalmem: os.totalmem(),
      cpus: os.cpus().length,
    };
    await this.redis.set('worker:metrics', JSON.stringify(metrics), 'EX', 120);
  }

  onModuleDestroy() {
    if (this.interval) {
      clearInterval(this.interval);
    }
    void this.redis.quit();
  }
}
