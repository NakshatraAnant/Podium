import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { postMessageSchema } from "@podium/shared-types";
import { Audit } from "../common/decorators/audit.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
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

  @Post("channels/:id/messages")
  @Audit("message", "chat.post_message")
  postMessage(@CurrentUser() user: RequestUser, @Param("id") id: string, @Body(new ZodValidationPipe(postMessageSchema)) body: ReturnType<typeof postMessageSchema.parse>) {
    return this.chat.postMessage(user, id, body);
  }
}
