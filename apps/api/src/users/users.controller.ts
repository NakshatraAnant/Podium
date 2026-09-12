import { Controller, Get, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { AuthService } from "../auth/auth.service";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermissions } from "../common/decorators/require-permissions.decorator";
import { SkipMustChangePassword } from "../common/decorators/skip-must-change-password.decorator";
import type { RequestUser } from "../common/types";

@Controller("users")
export class UsersController {
  constructor(private readonly authService: AuthService) {}

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
