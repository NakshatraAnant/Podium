import { Controller, Get, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { AuthService } from "../auth/auth.service";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { PrismaService } from "../common/prisma/prisma.service";
import { RequirePermissions } from "../common/decorators/require-permissions.decorator";
import { SkipMustChangePassword } from "../common/decorators/skip-must-change-password.decorator";
import type { RequestUser } from "../common/types";

@Controller("users")
export class UsersController {
  constructor(
    private readonly authService: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Phase F.5: a bare list of active users so a lead-conversion form (PM
   * picker) or a lead-creation form (owner picker) has something real to
   * populate a dropdown from — no such endpoint existed anywhere before
   * this. Gated on the existing "people" resource (already granted to
   * Founder/Admin/Operations in the seed matrix), the same resource
   * `POST /users/:id/invite` already uses for people-management actions.
   */
  @RequirePermissions("people:view")
  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.prisma.client.user.findMany({
      where: { workspaceId: user.workspaceId, isActive: true, deletedAt: null },
      select: {
        id: true,
        name: true,
        email: true,
        userRoles: { select: { role: { select: { name: true } } } },
      },
      orderBy: { name: "asc" },
    }).then((rows) =>
      rows.map((r) => ({ id: r.id, name: r.name, email: r.email, roles: r.userRoles.map((ur) => ur.role.name) })),
    );
  }

  // BUG-003: reachable even mid-forced-change, so the frontend can render
  // "you're logged in as X, please change your password" rather than a bare
  // 403 with nothing to identify who's stuck.
  @SkipMustChangePassword()
  @Get("me")
  me(@CurrentUser() user: RequestUser) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      roles: user.roleNames,
      cityAccess: user.cityAccess,
      mustChangePassword: user.mustChangePassword,
    };
  }

  /**
   * BUG-003: issues a one-time password invite/reset token for another
   * user — used both to onboard a brand-new account and to reset an
   * existing one. Returns the raw token/URL directly in the response; there
   * is no live email integration yet (see docs/STATUS.md §1.3), so
   * delivering that URL to the actual person is on the caller for now.
   */
  @RequirePermissions("people:edit")
  @Post(":id/invite")
  invite(@CurrentUser() actor: RequestUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.authService.createPasswordInvite(id, actor.id);
  }
}
