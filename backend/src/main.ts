import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Pino logger
  app.useLogger(app.get(Logger));

  // Segurança
  app.use(
    helmet({
      contentSecurityPolicy: false, // Desabilitado em dev — frontend é cross-origin
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  const corsOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim())
    : ['http://localhost:3000', 'http://localhost:80'];
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
  });

  // Prefixo global
  app.setGlobalPrefix('api/v1');

  // Validação
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Swagger
  const config = new DocumentBuilder()
    .setTitle('Rastreamento 21 GO API')
    .setDescription('API de rastreamento veicular')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = app.get(ConfigService).get<number>('port') || 3001;
  await app.listen(port);
}
bootstrap();
