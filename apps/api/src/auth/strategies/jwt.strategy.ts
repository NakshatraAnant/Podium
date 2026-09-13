import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import type { Request } from "express";
import { ExtractJwt, Strategy } from "passport-jwt";
import { PrismaService } from "../../common/prisma/prisma.service";
import type { RequestUser } from "../../common/types";

interface AccessTokenPayload {
  sub: string;
  workspaceId: string;
}

/**
 * Phase H: the web frontend no longer keeps the access token in
 * localStorage (readable by any injected script) — it rides in an httpOnly
 * cookie the browser sends automatically and JS can never read. The
 * Authorization header stays supported too: every existing e2e test
 * authenticates that way, and it remains the right shape for a non-browser
 * API caller that has nowhere to keep a cookie. Cookie is tried first only
 * because the browser is the case an attacker actually targets.
 */
function cookieExtractor(req: Request): string | null {
  return req?.cookies?.accessToken ?? null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([cookieExtractor, ExtractJwt.fromAuthHeaderAsBearerToken()]),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>("JWT_ACCESS_SECRET"),
    });
  }

  /**
   * Resolves the full permission/city-access set from the database on every
   * request rather than trusting stale JWT claims — a role or city-access
   * change takes effect on the caller's very next request, never after a
   * token refresh (blueprint §11: "never trust the frontend", extended here
   * to "never trust a 15-minute-old token" for authorization decisions).
   */
  async validate(payload: AccessTokenPayload): Promise<RequestUser> {
    const user = await this.prisma.client.user.findUnique({
      where: { id: payload.sub },
      include: {
        userRoles: { include: { role: { include: { rolePermissions: { include: { permission: true } } } } } },
        cityAccess: true,
      },
    });
    if (!user || !user.isActive || user.deletedAt) {
      throw new UnauthorizedException("Account is no longer active.");
    }
    const permissions = new Set<string>();
    const roleNames: string[] = [];
    for (const ur of user.userRoles) {
      roleNames.push(ur.role.name);
      for (const rp of ur.role.rolePermissions) {
        permissions.add(`${rp.permission.resource}:${rp.permission.action}`);
      }
    }
    return {
      id: user.id,
      workspaceId: user.workspaceId,
      name: user.name,
      email: user.email,
      permissions,
      roleNames,
      cityAccess: user.cityAccess.map((c) => ({ cityId: c.cityId, scope: c.scope })),
      mustChangePassword: user.mustChangePassword,
    };
  }
}
