import { BadRequestException, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { createHash, randomBytes } from "crypto";
import { MailConfigService } from "../common/mail/mail-config.service";
import { MailService } from "../common/mail/mail.service";
import { PrismaService } from "../common/prisma/prisma.service";
import type { AcceptInviteInput, ChangePasswordInput, LoginInput } from "@podium/shared-types";

// BUG-003 (2026-09-12 CTO audit): every account used to share one published
// password with no lockout at all. These are a documented, reasonable
// default for an internal ops tool, not a value the audit specified —
// easy to move to config later if AMM wants something stricter or looser.
const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60_000;
const INVITE_TOKEN_TTL_MS = 7 * 24 * 60 * 60_000;
const BCRYPT_ROUNDS = 12;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
    private readonly mailConfig: MailConfigService,
  ) {}

  async login(input: LoginInput) {
    const user = await this.prisma.client.user.findUnique({
      where: { email: input.email },
      include: { userRoles: { include: { role: true } }, cityAccess: true },
    });
    // Same "Invalid email or password" for every rejection reason (unknown
    // email, no password set yet, deactivated, wrong password) — an
    // attacker learns nothing about which accounts exist or are locked.
    if (!user || !user.passwordHash || user.deletedAt || !user.isActive) {
      throw new UnauthorizedException("Invalid email or password.");
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedException("Invalid email or password.");
    }

    const ok = await bcrypt.compare(input.password, user.passwordHash);
    if (!ok) {
      await this.registerFailedLogin(user.id, user.failedLoginAttempts);
      throw new UnauthorizedException("Invalid email or password.");
    }

    if (user.failedLoginAttempts > 0 || user.lockedUntil) {
      await this.prisma.client.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      });
    }

    const accessToken = this.signAccessToken(user.id, user.workspaceId);
    const refreshToken = await this.issueRefreshToken(user.id);

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        roles: user.userRoles.map((ur) => ur.role.name),
        cityAccess: user.cityAccess.map((c) => ({ cityId: c.cityId, scope: c.scope })),
        mustChangePassword: user.mustChangePassword,
      },
    };
  }

  private async registerFailedLogin(userId: string, currentAttempts: number): Promise<void> {
    const attempts = currentAttempts + 1;
    const lockingOut = attempts >= MAX_FAILED_LOGIN_ATTEMPTS;
    await this.prisma.client.user.update({
      where: { id: userId },
      data: {
        // Once locked, the counter resets — the lockout window itself is
        // now doing the job; there is no reason to let it climb further.
        failedLoginAttempts: lockingOut ? 0 : attempts,
        lockedUntil: lockingOut ? new Date(Date.now() + LOCKOUT_DURATION_MS) : undefined,
      },
    });
  }

  /** BUG-003: the shared-password world had no way for a user to change their own password at all. */
  async changePassword(userId: string, input: ChangePasswordInput): Promise<void> {
    const user = await this.prisma.client.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.passwordHash) {
      // Shouldn't happen for an authenticated user (login requires a hash),
      // but a clear error beats bcrypt.compare(x, null) throwing obscurely.
      throw new BadRequestException("This account has no password set — use the invite link instead.");
    }
    const ok = await bcrypt.compare(input.currentPassword, user.passwordHash);
    if (!ok) throw new UnauthorizedException("Current password is incorrect.");

    const newHash = await bcrypt.hash(input.newPassword, BCRYPT_ROUNDS);
    await this.prisma.client.$transaction([
      this.prisma.client.user.update({
        where: { id: userId },
        data: {
          passwordHash: newHash,
          mustChangePassword: false,
          passwordChangedAt: new Date(),
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      }),
      // A password change invalidates every other session — the whole
      // point of changing it is that the old credential can no longer be
      // trusted, and a still-valid refresh token from before the change
      // would defeat that.
      this.prisma.client.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.client.auditLog.create({
        data: {
          workspaceId: user.workspaceId,
          actorId: userId,
          action: "auth.password_changed",
          entityType: "user",
          entityId: userId,
          after: { mustChangePassword: false },
        },
      }),
    ]);
  }

  /**
   * BUG-003: creates a one-time invite/reset token for `targetUserId`,
   * issued by `issuedById`. Returns the raw token (and a ready-to-use URL) —
   * ***how that URL reaches the user is intentionally left to the caller***.
   * There is no live email integration (see docs/STATUS.md §1.3); this
   * method only issues the credential, it does not deliver it.
   */
  async createPasswordInvite(targetUserId: string, issuedById: string) {
    const user = await this.prisma.client.user.findUniqueOrThrow({ where: { id: targetUserId } });
    const raw = randomBytes(32).toString("hex");
    await this.prisma.client.$transaction([
      this.prisma.client.passwordInvite.create({
        data: {
          userId: targetUserId,
          tokenHash: hashToken(raw),
          expiresAt: new Date(Date.now() + INVITE_TOKEN_TTL_MS),
          createdById: issuedById,
        },
      }),
      this.prisma.client.auditLog.create({
        data: {
          workspaceId: user.workspaceId,
          actorId: issuedById,
          action: "auth.password_invite_created",
          entityType: "user",
          entityId: targetUserId,
          after: { expiresInDays: INVITE_TOKEN_TTL_MS / 86_400_000 },
        },
      }),
    ]);
    const webBaseUrl = this.config.get<string>("WEB_BASE_URL") ?? "http://localhost:3000";
    const inviteUrl = `${webBaseUrl}/accept-invite?token=${raw}`;

    /**
     * Mail delivery is attempted only when it is actually configured. When
     * MAIL_MODE is `disabled` the invite is still issued and the URL still
     * returned — an admin can hand it over out of band — but the response
     * says plainly that nothing was e-mailed, rather than implying the user
     * has been notified when they have not. This is the `delivery` field's
     * whole purpose: never let the caller believe a message was sent.
     */
    let delivery: { emailed: boolean; mode: string; reason?: string };
    if (this.mailConfig.mode === "disabled") {
      delivery = { emailed: false, mode: "disabled", reason: "MAIL_MODE is disabled — share the inviteUrl manually." };
    } else {
      try {
        const sent = await this.mail.send({
          to: user.email,
          subject: "Set your Podium password",
          text:
            `Hello ${user.name},\n\n` +
            `An account has been created for you on Podium, AMM Brands' operating system.\n\n` +
            `Set your password here (the link is single-use and expires in ${INVITE_TOKEN_TTL_MS / 86_400_000} days):\n` +
            `${inviteUrl}\n\n` +
            `If you weren't expecting this, you can ignore this message — the link does nothing until it's used.\n`,
        });
        delivery = { emailed: true, mode: sent.mode };
      } catch (err) {
        // A mail failure must not void an already-issued token: the invite
        // row is committed, so swallowing the send error and reporting it is
        // strictly better than throwing and leaving a usable token behind
        // that the caller believes was never created.
        delivery = { emailed: false, mode: this.mailConfig.mode, reason: (err as Error).message };
      }
    }

    return { token: raw, inviteUrl, expiresInDays: INVITE_TOKEN_TTL_MS / 86_400_000, delivery };
  }

  /** BUG-003: consumes a one-time invite/reset token and sets the user's password. */
  async acceptInvite(input: AcceptInviteInput) {
    const tokenHash = hashToken(input.token);
    const invite = await this.prisma.client.passwordInvite.findUnique({ where: { tokenHash } });
    if (!invite || invite.usedAt || invite.expiresAt < new Date()) {
      throw new UnauthorizedException("This invite link is invalid or has expired.");
    }

    const newHash = await bcrypt.hash(input.newPassword, BCRYPT_ROUNDS);
    const user = await this.prisma.client.user.findUniqueOrThrow({
      where: { id: invite.userId },
      include: { userRoles: { include: { role: true } }, cityAccess: true },
    });

    await this.prisma.client.$transaction([
      this.prisma.client.user.update({
        where: { id: invite.userId },
        data: {
          passwordHash: newHash,
          mustChangePassword: false,
          passwordChangedAt: new Date(),
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      }),
      this.prisma.client.passwordInvite.update({
        where: { id: invite.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.client.auditLog.create({
        data: {
          workspaceId: user.workspaceId,
          actorId: invite.userId,
          action: "auth.invite_accepted",
          entityType: "user",
          entityId: invite.userId,
          after: {},
        },
      }),
    ]);

    // Auto-login: the user just proved control of the invite link, which is
    // at least as strong a proof of identity as a password would be here.
    const accessToken = this.signAccessToken(user.id, user.workspaceId);
    const refreshToken = await this.issueRefreshToken(user.id);
    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        roles: user.userRoles.map((ur) => ur.role.name),
        cityAccess: user.cityAccess.map((c) => ({ cityId: c.cityId, scope: c.scope })),
        mustChangePassword: false,
      },
    };
  }

  async refresh(refreshToken: string) {
    const tokenHash = hashToken(refreshToken);
    const stored = await this.prisma.client.refreshToken.findUnique({ where: { tokenHash } });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException("Refresh token is invalid or expired.");
    }
    // Rotate: revoke the old token, issue a new pair (mitigates replay of a stolen refresh token).
    await this.prisma.client.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
    const user = await this.prisma.client.user.findUniqueOrThrow({ where: { id: stored.userId } });
    const accessToken = this.signAccessToken(user.id, user.workspaceId);
    const newRefreshToken = await this.issueRefreshToken(user.id);
    return { accessToken, refreshToken: newRefreshToken };
  }

  async logout(refreshToken: string) {
    const tokenHash = hashToken(refreshToken);
    await this.prisma.client.refreshToken.updateMany({ where: { tokenHash }, data: { revokedAt: new Date() } });
  }

  private signAccessToken(userId: string, workspaceId: string): string {
    return this.jwt.sign(
      { sub: userId, workspaceId },
      { secret: this.config.getOrThrow("JWT_ACCESS_SECRET"), expiresIn: this.config.get("JWT_ACCESS_TTL") ?? "15m" },
    );
  }

  private async issueRefreshToken(userId: string): Promise<string> {
    const raw = randomBytes(48).toString("hex");
    const ttl = this.config.get<string>("JWT_REFRESH_TTL") ?? "30d";
    await this.prisma.client.refreshToken.create({
      data: { userId, tokenHash: hashToken(raw), expiresAt: addDuration(new Date(), ttl) },
    });
    return raw;
  }

  /** Phase H: lets the controller size the httpOnly cookie's maxAge to match the token it actually issued. */
  getAccessTokenTtlMs(): number {
    return parseDurationMs(this.config.get<string>("JWT_ACCESS_TTL") ?? "15m");
  }

  getRefreshTokenTtlMs(): number {
    return parseDurationMs(this.config.get<string>("JWT_REFRESH_TTL") ?? "30d");
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function parseDurationMs(spec: string): number {
  const match = /^(\d+)([smhd])$/.exec(spec.trim());
  if (!match) return 30 * 24 * 60 * 60 * 1000;
  const value = Number(match[1]);
  const unitMs = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2] as "s" | "m" | "h" | "d"];
  return value * unitMs;
}

function addDuration(base: Date, spec: string): Date {
  return new Date(base.getTime() + parseDurationMs(spec));
}
