import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshInput = z.infer<typeof refreshSchema>;

export const authTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  user: z.object({
    id: z.string().uuid(),
    name: z.string(),
    email: z.string().email(),
    roles: z.array(z.string()),
    cityAccess: z.array(
      z.object({ cityId: z.string().uuid().nullable(), scope: z.enum(["READ", "WRITE", "ALL"]) }),
    ),
  }),
});
export type AuthTokens = z.infer<typeof authTokensSchema>;
