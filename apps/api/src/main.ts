import "reflect-metadata";

import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

import { NestFactory } from "@nestjs/core";

if (existsSync(".env")) {
  loadEnvFile(".env");
}

async function bootstrap() {
  const { AppModule } = await import("./app.module");
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
    credentials: true,
  });
  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3000);
}

void bootstrap();
