import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { PostMessageInput } from "@podium/shared-types";
import { CityScopeService } from "../common/city-scope/city-scope.service";
import { PrismaService } from "../common/prisma/prisma.service";
import type { RequestUser } from "../common/types";
import { allowedCityIds } from "../common/types";

/**
 * Chat (blueprint §23): company/city/project/DM channels. @mention -> task
 * promotion (the prototype's worked "@Rohit please confirm sound vendor"
 * example) is left for the automation engine phase — this ships real
 * channel listing, history, and posting, which is what My Work/Flows/Event
 * Day already depend on for their "Podium Bot" messages.
 */
@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cityScope: CityScopeService,
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
    return this.prisma.client.message.create({ data: { channelId, authorId: user.id, body: input.body } });
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
