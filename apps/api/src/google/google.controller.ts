import { Body, Controller, Delete, Get, Post, Query } from "@nestjs/common";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermissions } from "../common/decorators/require-permissions.decorator";
import type { RequestUser } from "../common/types";
import { GoogleService } from "./google.service";

/**
 * Phase 9's API surface. Every route here is honest about the integration's
 * state: with no credentials configured they all return 503 with the exact
 * setup steps, rather than empty arrays that read as "no mail today".
 */
@Controller("integrations/google")
export class GoogleController {
  constructor(private readonly google: GoogleService) {}

  @Get("status")
  status(@CurrentUser() user: RequestUser) {
    return this.google.status(user);
  }

  @Get("auth-url")
  authUrl(@CurrentUser() user: RequestUser, @Query("state") state = "podium") {
    return this.google.authUrl(user, state);
  }

  @Post("callback")
  callback(@CurrentUser() user: RequestUser, @Body("code") code: string) {
    return this.google.handleCallback(user, code);
  }

  @Delete("connection")
  disconnect(@CurrentUser() user: RequestUser) {
    return this.google.disconnect(user);
  }

  @Post("sync")
  sync(@CurrentUser() user: RequestUser) {
    return this.google.sync(user);
  }

  @Get("emails")
  @RequirePermissions("clients:view")
  emails(@CurrentUser() user: RequestUser, @Query("limit") limit?: string) {
    return this.google.listEmails(user, limit ? Number(limit) : undefined);
  }
}
