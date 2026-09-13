import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import { AppModule } from "../src/app.module";

export async function bootstrapTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix("api"); // must mirror main.ts's bootstrap exactly
  app.use(cookieParser());
  await app.init();
  return app;
}

/** Logs in as a seeded demo user (see packages/db/prisma/seed.ts) and returns the access token. */
export async function loginAs(app: INestApplication, email: string, password = "Podium123!"): Promise<string> {
  const request = (await import("supertest")).default;
  const res = await request(app.getHttpServer()).post("/api/auth/login").send({ email, password });
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.accessToken as string;
}
