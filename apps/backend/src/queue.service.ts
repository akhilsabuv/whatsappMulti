import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { QueueJobPayload, QueueName } from '@whatsapp-platform/common';

@Injectable()
export class QueueService {
  constructor(
    @InjectQueue(QueueName.SEND) private readonly sendQueue: Queue,
    @InjectQueue(QueueName.QR) private readonly qrQueue: Queue,
    @InjectQueue(QueueName.NUMBER_CHECK) private readonly numberCheckQueue: Queue,
  ) {}

  enqueue(payload: QueueJobPayload) {
    switch (payload.type) {
      case 'sendText':
      case 'sendFile':
      case 'checkAndSend':
        return this.sendQueue.add(payload.type, payload, {
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: 1000,
          removeOnFail: 1000,
        });
      case 'requestQr':
        return this.qrQueue.add(payload.type, payload, {
          attempts: 2,
          removeOnComplete: 1000,
          removeOnFail: 1000,
        });
      case 'checkNumber':
        return this.numberCheckQueue.add(payload.type, payload, {
          attempts: 2,
          removeOnComplete: 1000,
          removeOnFail: 1000,
        });
    }
  }
}
