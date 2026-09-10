import { z } from "zod";

export const postMessageSchema = z.object({
  body: z.string().min(1).max(4000),
});
export type PostMessageInput = z.infer<typeof postMessageSchema>;
