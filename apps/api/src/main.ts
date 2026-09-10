import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: { origin: process.env.WEB_BASE_URL ?? "http://localhost:3000", credentials: true } });
  app.setGlobalPrefix("api");
  const port = process.env.API_PORT ? Number(process.env.API_PORT) : 3001;
  await app.listen(port);
  Logger.log(`Podium API listening on http://localhost:${port}/api`, "Bootstrap");
}

bootstrap();
