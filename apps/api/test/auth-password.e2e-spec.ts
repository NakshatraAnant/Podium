import type { INestApplication } from "@nestjs/common";
import { getStorageToken, ThrottlerStorageService } from "@nestjs/throttler";
import * as bcrypt from "bcryptjs";
import { createHash, randomUUID } from "crypto";
import request from "supertest";
import { prisma } from "@podium/db";
import { bootstrapTestApp, loginAs } from "./support";

/**
 * BUG-003 (2026-09-12 CTO audit): every account used to share one published
 * password with no way to change it, no lockout, and no onboarding path.
 * These tests exercise the real endpoints end-to-end against the test
 * database — not just unit-level password hashing — using throwaway users
 * created and torn down here, so they never disturb the shared seed fixture
 * other e2e files log in against.
 */
describe("Password lifecycle (e2e)", () => {
  let app: INestApplication;
  let workspaceId: string;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    app = await bootstrapTestApp();
    const founder = await prisma.user.findFirstOrThrow({ where: { email: "anant.sharma@ammbrands.in" } });
    workspaceId = founder.workspaceId;
  });

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      await prisma.refreshToken.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.passwordInvite.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.auditLog.deleteMany({ where: { actorId: { in: createdUserIds } } });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await app.close();
  });

  // This file deliberately makes many /auth/login calls per test (to drive
  // real lockout behaviour) — enough on its own to trip the login route's
  // production rate limit (10/min/IP) well before any test-specific
  // assertion is reached. Resetting the in-memory throttle storage between
  // tests isolates that production safeguard from this file's own volume,
  // without weakening or bypassing it for real traffic.
  beforeEach(() => {
    app.get<ThrottlerStorageService>(getStorageToken()).storage.clear();
  });

  async function createTestUser(overrides: {
    passwordHash?: string | null;
    mustChangePassword?: boolean;
  } = {}) {
    const user = await prisma.user.create({
      data: {
        workspaceId,
        name: "Test User",
        email: `test-${randomUUID()}@ammbrands.test`,
        passwordHash: overrides.passwordHash,
        mustChangePassword: overrides.mustChangePassword,
      },
    });
    createdUserIds.push(user.id);
    return user;
  }

  describe("POST /auth/change-password", () => {
    it("rejects the wrong current password", async () => {
      const user = await createTestUser({ passwordHash: await bcrypt.hash("OldPass123!", 10) });
      const token = await loginAs(app, user.email, "OldPass123!");
      await request(app.getHttpServer())
        .post("/api/auth/change-password")
        .set("Authorization", `Bearer ${token}`)
        .send({ currentPassword: "wrong-password", newPassword: "NewPass123!" })
        .expect(401);
    });

    it("changes the password, revokes old sessions, and the old password stops working", async () => {
      const user = await createTestUser({ passwordHash: await bcrypt.hash("OldPass123!", 10) });
      const token = await loginAs(app, user.email, "OldPass123!");

      await request(app.getHttpServer())
        .post("/api/auth/change-password")
        .set("Authorization", `Bearer ${token}`)
        .send({ currentPassword: "OldPass123!", newPassword: "NewPass123!" })
        .expect(201);

      // The old password no longer works...
      await request(app.getHttpServer())
        .post("/api/auth/login")
        .send({ email: user.email, password: "OldPass123!" })
        .expect(401);

      // ...and the new one does.
      await request(app.getHttpServer())
        .post("/api/auth/login")
        .send({ email: user.email, password: "NewPass123!" })
        .expect(201);

      const audit = await prisma.auditLog.findFirst({
        where: { entityId: user.id, action: "auth.password_changed" },
      });
      expect(audit).not.toBeNull();
    });
  });

  describe("account lockout", () => {
    it("locks the account after repeated failed logins, even with the correct password", async () => {
      const user = await createTestUser({ passwordHash: await bcrypt.hash("CorrectPass123!", 10) });

      for (let i = 0; i < 5; i++) {
        await request(app.getHttpServer())
          .post("/api/auth/login")
          .send({ email: user.email, password: "wrong-password" })
          .expect(401);
      }

      const res = await request(app.getHttpServer())
        .post("/api/auth/login")
        .send({ email: user.email, password: "CorrectPass123!" })
        .expect(401);
      expect(res.body.error.message).toMatch(/invalid email or password/i);

      const locked = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(locked.lockedUntil).not.toBeNull();
      expect(locked.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    });

    it("a successful login resets the failed-attempt counter", async () => {
      const user = await createTestUser({ passwordHash: await bcrypt.hash("CorrectPass123!", 10) });
      await request(app.getHttpServer())
        .post("/api/auth/login")
        .send({ email: user.email, password: "wrong-password" })
        .expect(401);
      await request(app.getHttpServer())
        .post("/api/auth/login")
        .send({ email: user.email, password: "CorrectPass123!" })
        .expect(201);
      const refreshed = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(refreshed.failedLoginAttempts).toBe(0);
    });
  });

  describe("forced change on first login (mustChangePassword)", () => {
    it("blocks other authenticated routes until the password is changed, but not /users/me or /auth/change-password", async () => {
      const user = await createTestUser({
        passwordHash: await bcrypt.hash("TempPass123!", 10),
        mustChangePassword: true,
      });
      const loginRes = await request(app.getHttpServer())
        .post("/api/auth/login")
        .send({ email: user.email, password: "TempPass123!" })
        .expect(201);
      expect(loginRes.body.user.mustChangePassword).toBe(true);
      const token = loginRes.body.accessToken as string;

      // Blocked: an ordinary authenticated route.
      await request(app.getHttpServer())
        .get("/api/cities")
        .set("Authorization", `Bearer ${token}`)
        .expect(403);

      // Allowed: the two routes a stuck user must still be able to reach.
      await request(app.getHttpServer()).get("/api/users/me").set("Authorization", `Bearer ${token}`).expect(200);
      await request(app.getHttpServer())
        .post("/api/auth/change-password")
        .set("Authorization", `Bearer ${token}`)
        .send({ currentPassword: "TempPass123!", newPassword: "PermanentPass123!" })
        .expect(201);

      // Now the flag is cleared and the route that was blocked works.
      const relogin = await request(app.getHttpServer())
        .post("/api/auth/login")
        .send({ email: user.email, password: "PermanentPass123!" })
        .expect(201);
      expect(relogin.body.user.mustChangePassword).toBe(false);
      await request(app.getHttpServer())
        .get("/api/cities")
        .set("Authorization", `Bearer ${relogin.body.accessToken}`)
        .expect(200);
    });
  });

  describe("invite-based onboarding", () => {
    it("issues a one-time token that sets a new user's password and logs them in", async () => {
      const founderToken = await loginAs(app, "anant.sharma@ammbrands.in");
      const newUser = await createTestUser({ passwordHash: null, mustChangePassword: true });

      const inviteRes = await request(app.getHttpServer())
        .post(`/api/users/${newUser.id}/invite`)
        .set("Authorization", `Bearer ${founderToken}`)
        .expect(201);
      expect(inviteRes.body.token).toBeTruthy();
      expect(inviteRes.body.inviteUrl).toContain(inviteRes.body.token);

      const acceptRes = await request(app.getHttpServer())
        .post("/api/auth/accept-invite")
        .send({ token: inviteRes.body.token, newPassword: "InvitedPass123!" })
        .expect(201);
      expect(acceptRes.body.user.id).toBe(newUser.id);
      expect(acceptRes.body.user.mustChangePassword).toBe(false);

      // The token is single-use.
      await request(app.getHttpServer())
        .post("/api/auth/accept-invite")
        .send({ token: inviteRes.body.token, newPassword: "AnotherPass123!" })
        .expect(401);

      // The new password actually works.
      await request(app.getHttpServer())
        .post("/api/auth/login")
        .send({ email: newUser.email, password: "InvitedPass123!" })
        .expect(201);
    });

    it("rejects an expired invite token", async () => {
      const newUser = await createTestUser({ passwordHash: null });
      const raw = "expired-token-for-test-" + randomUUID();
      const tokenHash = createHash("sha256").update(raw).digest("hex");
      await prisma.passwordInvite.create({
        data: {
          userId: newUser.id,
          tokenHash,
          expiresAt: new Date(Date.now() - 60_000),
        },
      });
      await request(app.getHttpServer())
        .post("/api/auth/accept-invite")
        .send({ token: raw, newPassword: "SomePass123!" })
        .expect(401);
    });
  });
});
