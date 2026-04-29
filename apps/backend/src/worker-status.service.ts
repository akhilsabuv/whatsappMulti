import { Injectable } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class WorkerStatusService {
  private readonly redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');

  async getWorkerStatus() {
    const heartbeat = await this.redis.get('worker:heartbeat');
    return {
      heartbeat,
      isHealthy: heartbeat ? Date.now() - new Date(heartbeat).getTime() < 60_000 : false,
    };
  }

  async getQueueStats() {
    const [sendWaiting, qrWaiting, numberWaiting] = await Promise.all([
      this.redis.get('queue:whatsapp-send:last'),
      this.redis.get('queue:whatsapp-qr:last'),
      this.redis.get('queue:whatsapp-number-check:last'),
    ]);

    return {
      lastProcessed: {
        send: sendWaiting,
        qr: qrWaiting,
        numberCheck: numberWaiting,
      },
    };
  }
}
