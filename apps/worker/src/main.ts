import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';

async function bootstrap() {
  process.on('unhandledRejection', (reason) => {
    const message = reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason);
    console.error('[worker] unhandledRejection', message);
  });

  process.on('uncaughtException', (error) => {
    console.error('[worker] uncaughtException', error);
  });

  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
}

bootstrap();
