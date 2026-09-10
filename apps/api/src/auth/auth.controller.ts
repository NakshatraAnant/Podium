import { Body, Controller, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { loginSchema, refreshSchema } from "@podium/shared-types";
import { Public } from "../common/decorators/public.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
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
}
