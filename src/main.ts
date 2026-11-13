import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { validationExceptionFactory } from '@common/filters/validation-exception.factory';
import { TranslateExceptionFilter } from '@common/filters/translate-exception.filter';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { LoggingInterceptor } from '@common/interceptors/logging.interceptor';
import { json, urlencoded, static as expressStatic } from 'express';
import * as path from 'path';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'error', 'warn', 'debug', 'verbose'],
    bodyParser: false, // Disable default body parser to use custom configuration
  });

  // Configure body parser with increased limit BEFORE any other middleware
  // This must be done before setGlobalPrefix and other configurations
  app.use(json({ limit: '50mb' }));
  app.use(urlencoded({ extended: true, limit: '50mb' }));

  // Serve static files from uploads folder (for local storage fallback)
  const uploadsPath = path.join(process.cwd(), 'uploads');
  app.use('/uploads', expressStatic(uploadsPath));
  app.use('/api/v1/uploads', expressStatic(uploadsPath));

  // Global prefix for all routes
  app.setGlobalPrefix('api/v1');

  // CORS
  app.enableCors();

  // Validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: validationExceptionFactory,
    }),
  );

  // Global interceptor for logging
  app.useGlobalInterceptors(new LoggingInterceptor());

  // Dịch message lỗi API sang tiếng Việt
  app.useGlobalFilters(new TranslateExceptionFilter());

  // Swagger configuration
  const config = new DocumentBuilder()
    .setTitle('NestJS Auth API')
    .setDescription('API with authentication system using NestJS')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  const port = process.env.PORT || 8081;
  await app.listen(port);

  const logger = new Logger('Bootstrap');
  logger.log(`🚀 Application is running at: http://localhost:${port}`);
  logger.log(`📚 Swagger UI: http://localhost:${port}/api`);
  logger.log(`🔗 API Base URL: http://localhost:${port}/api/v1`);
  logger.log(`📊 Logging middleware is activated`);
}

bootstrap();
