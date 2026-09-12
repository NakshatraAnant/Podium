import { Body, Controller, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { acceptInviteSchema, changePasswordSchema, loginSchema, refreshSchema } from "@podium/shared-types";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Public } from "../common/decorators/public.decorator";
import { SkipMustChangePassword } from "../common/decorators/skip-must-change-password.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { RequestUser } from "../common/types";
import { AuthService } from "./auth.service";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } }) // rate-limited per blueprint §30
  @Post("login")
  login(@Body(new ZodValidationPipe(loginSchema)) body: ReturnType<typeof loginSchema.parse>) {
    return this.authService.login(body);
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post("refresh")
  refresh(@Body(new ZodValidationPipe(refreshSchema)) body: ReturnType<typeof refreshSchema.parse>) {
    return this.authService.refresh(body.refreshToken);
  }

  @Public()
  @Post("logout")
  async logout(@Body(new ZodValidationPipe(refreshSchema)) body: ReturnType<typeof refreshSchema.parse>) {
    await this.authService.logout(body.refreshToken);
    return { ok: true };
  }

  // BUG-003: the one route a user with mustChangePassword=true must still be
  // able to reach — see MustChangePasswordGuard.
  @SkipMustChangePassword()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("change-password")
  async changePassword(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(changePasswordSchema)) body: ReturnType<typeof changePasswordSchema.parse>,
  ) {
    await this.authService.changePassword(user.id, body);
    return { ok: true };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("accept-invite")
  acceptInvite(@Body(new ZodValidationPipe(acceptInviteSchema)) body: ReturnType<typeof acceptInviteSchema.parse>) {
    return this.authService.acceptInvite(body);
  }
}
