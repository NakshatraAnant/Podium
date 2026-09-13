import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { PostMessageInput, PromoteMessageInput } from "@podium/shared-types";
import { AutomationService } from "../automation/automation.service";
import { CityScopeService } from "../common/city-scope/city-scope.service";
import { PrismaService } from "../common/prisma/prisma.service";
import type { RequestUser } from "../common/types";
import { allowedCityIds } from "../common/types";
import { resolveMentions, suggestTaskName } from "./mentions";

/**
 * Chat (blueprint §23): company/city/project/DM channels, plus @mention ->
 * task promotion (the prototype's worked "@Rohit please confirm sound vendor"
 * example).
 */
@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cityScope: CityScopeService,
    private readonly automation: AutomationService,
  ) {}

  async listChannels(user: RequestUser) {
    const allowed = allowedCityIds(user);
    return this.prisma.client.channel.findMany({
      where: {
        workspaceId: user.workspaceId,
        deletedAt: null,
        OR: [
          { kind: "COMPANY" },
          { kind: "CITY", cityId: allowed === "ALL" ? undefined : { in: allowed } },
          { kind: "PROJECT", project: { ...(allowed === "ALL" ? {} : { cityId: { in: allowed } }) } },
        ],
      },
      orderBy: { name: "asc" },
    });
  }

  async messages(user: RequestUser, channelId: string, cursor?: string, limit = 50) {
    await this.assertChannelAccess(user, channelId);
    return this.prisma.client.message.findMany({
      where: { channelId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: limit,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
  }

  async postMessage(user: RequestUser, channelId: string, input: PostMessageInput) {
    await this.assertChannelAccess(user, channelId);
    const message = await this.prisma.client.message.create({ data: { channelId, authorId: user.id, body: input.body } });

    // Rule au11 ("Chat @mention -> notification"). Fired after the write has
    // committed, same convention as every other automation.emit() call in
    // this codebase — a notification failing must never roll back the
    // message that already posted. Real, resolved mentions only: an
    // unresolved or ambiguous handle notifies nobody rather than guessing.
    const roster = await this.prisma.client.user.findMany({
      where: { workspaceId: user.workspaceId, deletedAt: null },
      select: { id: true, name: true, email: true },
    });
    const mentioned = resolveMentions(message.body, roster)
      .map((m) => m.user)
      .filter((u): u is NonNullable<typeof u> => u !== null && u.id !== user.id);
    for (const target of mentioned) {
      await this.automation.emit({
        trigger: "chat.mentioned",
        workspaceId: user.workspaceId,
        entityType: "chat_mention",
        entityId: `${message.id}:${target.id}`,
        payload: { mentionedUserId: target.id, senderName: user.name, snippet: message.body.slice(0, 140), messageId: message.id, channelId },
      });
    }

    return message;
  }


  /**
   * What the confirm dialog needs before anything is written: who the message
   * mentions, which project the task would land in, and a suggested title.
   * The due date is deliberately NOT suggested — blueprint §23 has the sender
   * confirm it, and a guessed deadline is a guessed commitment.
   */
  async promotionPreview(user: RequestUser, messageId: string) {
    const { message, channel } = await this.loadPromotableMessage(user, messageId);
    const roster = await this.prisma.client.user.findMany({
      where: { workspaceId: user.workspaceId, deletedAt: null },
      select: { id: true, name: true, email: true },
    });
    const mentions = resolveMentions(message.body, roster);
    const assignee = mentions.find((m) => m.user)?.user ?? null;

    return {
      messageId: message.id,
      channelId: channel.id,
      project: channel.project ? { id: channel.project.id, name: channel.project.name } : null,
      suggestedName: suggestTaskName(message.body),
      suggestedOwner: assignee,
      mentions: mentions.map((m) => ({
        handle: m.handle,
        resolved: m.user ? { id: m.user.id, name: m.user.name } : null,
        ambiguousWith: m.ambiguousWith ?? null,
      })),
      /** The sender must supply this; there is nothing to infer it from. */
      dueAtRequired: true,
    };
  }

  /**
   * Promotes a chat message into a real task, links the task back to the
   * message it came from, and posts a Podium Bot confirmation into the same
   * channel so the thread shows what happened. All three writes plus the audit
   * row happen in one transaction — a task whose channel never acknowledged it
   * is exactly the kind of silent half-success this module must not produce.
   */
  async promoteMessageToTask(user: RequestUser, messageId: string, input: PromoteMessageInput) {
    const { message, channel } = await this.loadPromotableMessage(user, messageId);

    const project = channel.project;
    if (!project) {
      throw new BadRequestException(
        "This message is not in a project channel, so there is no project to attach a task to. Promote a message from a project channel instead.",
      );
    }
    this.cityScope.assertCanAccessCity(user, project.cityId);

    // Role grant OR membership of this specific project — blueprint §23 lets a
    // project member promote a message even when their role alone could not
    // create tasks anywhere else.
    const canByRole = user.permissions.has("tasks:create");
    const isMember =
      project.pmId === user.id ||
      (await this.prisma.client.projectMember.count({ where: { projectId: project.id, userId: user.id } })) > 0;
    if (!canByRole && !isMember) {
      throw new ForbiddenException("Only members of this project, or Ops/PM/Admin/Founder, can promote a message to a task.");
    }

    const existing = await this.prisma.client.task.findFirst({ where: { sourceMessageId: message.id, deletedAt: null } });
    if (existing) {
      throw new BadRequestException(`This message was already promoted to the task "${existing.name}".`);
    }

    const owner = await this.prisma.client.user.findFirst({
      where: { id: input.ownerId, workspaceId: user.workspaceId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!owner) throw new BadRequestException("The assignee is not a user in this workspace.");

    return this.prisma.client.$transaction(async (tx) => {
      const task = await tx.task.create({
        data: {
          projectId: project.id,
          name: input.name,
          ownerId: owner.id,
          dueAt: input.dueAt,
          priority: input.priority ?? "MEDIUM",
          status: "PLANNED",
          sourceMessageId: message.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      // authorId null => "Podium Bot", the same convention the flow engine uses.
      await tx.message.create({
        data: {
          channelId: channel.id,
          authorId: null,
          body: `Task created from ${user.name}'s message: "${task.name}" — assigned to ${owner.name}, due ${input.dueAt.toISOString().slice(0, 10)}.`,
        },
      });

      await tx.notification.create({
        data: {
          workspaceId: user.workspaceId,
          userId: owner.id,
          icon: "☑",
          text: `${user.name} assigned you a task from chat: ${task.name}`,
          sourceType: "task",
          sourceId: task.id,
        },
      });

      await tx.auditLog.create({
        data: {
          workspaceId: user.workspaceId,
          actorId: user.id,
          action: "task.promoted_from_message",
          entityType: "task",
          entityId: task.id,
          after: { messageId: message.id, channelId: channel.id, projectId: project.id, ownerId: owner.id, name: task.name },
        },
      });

      return task;
    });
  }

  private async loadPromotableMessage(user: RequestUser, messageId: string) {
    const message = await this.prisma.client.message.findFirst({
      where: { id: messageId, deletedAt: null, channel: { workspaceId: user.workspaceId } },
    });
    if (!message) throw new NotFoundException("Message not found.");
    if (message.authorId === null) {
      throw new BadRequestException("Podium Bot messages cannot be promoted to tasks.");
    }
    const channel = await this.assertChannelAccess(user, message.channelId);
    return { message, channel };
  }

  private async assertChannelAccess(user: RequestUser, channelId: string) {
    const channel = await this.prisma.client.channel.findFirst({ where: { id: channelId, workspaceId: user.workspaceId, deletedAt: null }, include: { project: true } });
    if (!channel) throw new NotFoundException("Channel not found.");
    if (channel.kind === "CITY" && channel.cityId) this.cityScope.assertCanAccessCity(user, channel.cityId);
    if (channel.kind === "PROJECT" && channel.project) this.cityScope.assertCanAccessCity(user, channel.project.cityId);
    if (channel.kind === "DM") {
      throw new ForbiddenException("DM channels are not yet exposed via this endpoint.");
    }
    return channel;
  }
}
