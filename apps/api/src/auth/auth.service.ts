import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { createHash, randomBytes } from "crypto";
import { PrismaService } from "../common/prisma/prisma.service";
import type { LoginInput } from "@podium/shared-types";

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async login(input: LoginInput) {
    const user = await this.prisma.client.user.findUnique({
      where: { email: input.email },
      include: { userRoles: { include: { role: true } }, cityAccess: true },
    });
    if (!user || !user.passwordHash || user.deletedAt || !user.isActive) {
      throw new UnauthorizedException("Invalid email or password.");
    }
    const ok = await bcrypt.compare(input.password, user.passwordHash);
    if (!ok) throw new UnauthorizedException("Invalid email or password.");

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
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function addDuration(base: Date, spec: string): Date {
  const match = /^(\d+)([smhd])$/.exec(spec.trim());
  if (!match) return new Date(base.getTime() + 30 * 24 * 60 * 60 * 1000);
  const value = Number(match[1]);
  const unitMs = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2] as "s" | "m" | "h" | "d"];
  return new Date(base.getTime() + value * unitMs);
}
