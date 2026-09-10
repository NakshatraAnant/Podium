import { Controller, Get } from "@nestjs/common";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import type { RequestUser } from "../common/types";

@Controller("users")
export class UsersController {
  @Get("me")
  me(@CurrentUser() user: RequestUser) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      roles: user.roleNames,
      cityAccess: user.cityAccess,
    };
  }
}
