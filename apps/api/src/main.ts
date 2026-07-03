import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
  await app.listen(process.env.PORT ?? 3001);
  console.log('rf-api listening on', process.env.PORT ?? 3001);
}
bootstrap();
