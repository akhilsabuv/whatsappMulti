import { Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';

type RequestMetric = {
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
};

@Injectable()
export class ObservabilityService {
  private readonly logger = new Logger(ObservabilityService.name);
  private readonly redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');

  async recordRequest(metric: RequestMetric) {
    const routeKey = `${metric.method}:${metric.path.replace(/[^\w:/.-]/g, '_')}`;
    const now = new Date().toISOString();

    this.logger.log(JSON.stringify({
      event: 'http.request',
      ...metric,
      timestamp: now,
    }));

    await this.redis
      .multi()
      .incr('metrics:http:requests_total')
      .incr(`metrics:http:status:${metric.statusCode}`)
      .incr(`metrics:http:route:${routeKey}`)
      .set('metrics:http:last_request_at', now, 'EX', 86400)
      .lpush('metrics:http:recent', JSON.stringify({ ...metric, timestamp: now }))
      .ltrim('metrics:http:recent', 0, 99)
      .exec();
  }

  async snapshot() {
    const [requestsTotal, lastRequestAt, recentRaw, deadLetters] = await Promise.all([
      this.redis.get('metrics:http:requests_total'),
      this.redis.get('metrics:http:last_request_at'),
      this.redis.lrange('metrics:http:recent', 0, 19),
      this.redis.llen('queue:dead-letter'),
    ]);

    return {
      http: {
        requestsTotal: Number(requestsTotal ?? 0),
        lastRequestAt,
        recent: recentRaw.map((item) => JSON.parse(item)),
      },
      queues: {
        deadLetters,
        recentDeadLetters: (await this.redis.lrange('queue:dead-letter', 0, 19)).map((item) => JSON.parse(item)),
      },
      timestamp: new Date().toISOString(),
    };
  }
}

