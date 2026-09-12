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

// BUG-003 (2026-09-12 CTO audit): a password strong enough to matter, but
// no stricter than that — this is an internal ops tool, not a bank.
const PASSWORD_MIN_LENGTH = 10;
const passwordField = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordField,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const acceptInviteSchema = z.object({
  token: z.string().min(1),
  newPassword: passwordField,
});
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;

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
    // BUG-003: true forces the frontend into the change-password screen;
    // enforced server-side too (MustChangePasswordGuard blocks every other
    // authenticated route while this is set), so this flag is a UX hint,
    // never the actual security boundary.
    mustChangePassword: z.boolean(),
  }),
});
export type AuthTokens = z.infer<typeof authTokensSchema>;
