import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { getAllowedOrigins, isSwaggerEnabled, validateRuntimeConfig } from './config';
import { ObservabilityService } from './observability.service';

async function bootstrap() {
  validateRuntimeConfig();

  const allowedOrigins = getAllowedOrigins();
  const app = await NestFactory.create(AppModule, {
    cors: {
      origin: (origin, callback) => {
        if (!origin || origin === 'null' || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
          callback(null, true);
          return;
        }

        callback(new Error(`Origin ${origin} not allowed by CORS`), false);
      },
      credentials: true,
    },
  });
  const observability = app.get(ObservabilityService);

  app.getHttpAdapter().getInstance().disable('x-powered-by');
  app.use((_request: Request, response: Response, next: NextFunction) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });
  app.use((request: Request, response: Response, next: NextFunction) => {
    const startedAt = Date.now();
    response.on('finish', () => {
      void observability.recordRequest({
        method: request.method,
        path: request.route?.path ?? request.path,
        statusCode: response.statusCode,
        durationMs: Date.now() - startedAt,
      });
    });
    next();
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));

  if (isSwaggerEnabled()) {
    const config = new DocumentBuilder()
      .setTitle('WhatsApp Platform API')
      .setDescription(
        'Dashboard and API-key routes for the WhatsApp platform. API-user endpoints are grouped under the "API User" tag and authenticated with the X-API-Key header.',
      )
      .setVersion('1.0.0')
      .addBearerAuth()
      .addApiKey({ type: 'apiKey', in: 'header', name: 'X-API-Key' }, 'api-key')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document);
    app.getHttpAdapter().get('/docs-json', (_, response) => response.json(document));
  }

  await app.listen(Number(process.env.BACKEND_PORT ?? 3001));
}

bootstrap();
