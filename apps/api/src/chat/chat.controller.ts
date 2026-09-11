import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { postMessageSchema, promoteMessageSchema } from "@podium/shared-types";
import { Audit } from "../common/decorators/audit.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermissions } from "../common/decorators/require-permissions.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { RequestUser } from "../common/types";
import { ChatService } from "./chat.service";

@Controller()
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get("channels")
  listChannels(@CurrentUser() user: RequestUser) {
    return this.chat.listChannels(user);
  }

  @Get("channels/:id/messages")
  messages(@CurrentUser() user: RequestUser, @Param("id") id: string, @Query("cursor") cursor?: string) {
    return this.chat.messages(user, id, cursor);
  }

  /**
   * What the promote-to-task confirm dialog needs. Gated on tasks:view rather
   * than tasks:create so a project member can open the dialog; the actual
   * promotion re-checks role-or-membership properly.
   */
  @Get("messages/:messageId/promotion-preview")
  @RequirePermissions("tasks:view")
  promotionPreview(@CurrentUser() user: RequestUser, @Param("messageId") messageId: string) {
    return this.chat.promotionPreview(user, messageId);
  }

  @Post("messages/:messageId/promote-task")
  @RequirePermissions("tasks:view")
  @Audit("task", "task.promoted_from_message")
  promoteTask(
    @CurrentUser() user: RequestUser,
    @Param("messageId") messageId: string,
    @Body(new ZodValidationPipe(promoteMessageSchema)) body: ReturnType<typeof promoteMessageSchema.parse>,
  ) {
    return this.chat.promoteMessageToTask(user, messageId, body);
  }

  @Post("channels/:id/messages")
  @Audit("message", "chat.post_message")
  postMessage(@CurrentUser() user: RequestUser, @Param("id") id: string, @Body(new ZodValidationPipe(postMessageSchema)) body: ReturnType<typeof postMessageSchema.parse>) {
    return this.chat.postMessage(user, id, body);
  }
}
