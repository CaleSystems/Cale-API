import { z } from 'zod';

/** Mirrors apps/api's identity/auth.dto.ts LoginDto — POST /auth/login body. */
export const LoginRequestSchema = z.object({
  staffId: z.string().uuid(),
  branchId: z.string().uuid(),
  pin: z.string().min(4).max(12),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

/** Mirrors apps/api's identity/auth.dto.ts RefreshDto — POST /auth/refresh body. */
export const RefreshRequestSchema = z.object({
  refreshToken: z.string(),
});
export type RefreshRequest = z.infer<typeof RefreshRequestSchema>;

/** Mirrors apps/api's AuthService.AuthTokens — the login/refresh response body. */
export const AuthTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number(),
});
export type AuthTokens = z.infer<typeof AuthTokensSchema>;
