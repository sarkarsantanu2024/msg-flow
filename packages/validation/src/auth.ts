import { z } from 'zod';

export const emailSchema = z.string().trim().toLowerCase().email('Enter a valid email address');

/**
 * Password policy: length over composition rules. A 10-character passphrase
 * beats "P@ssw0rd" and users actually comply with it.
 */
export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(200, 'That password is too long');

export const signupSchema = z.object({
  name: z.string().trim().min(2, 'Enter your name').max(100),
  email: emailSchema,
  password: passwordSchema,
  organizationName: z.string().trim().min(2, 'Enter your organization name').max(100),
  timezone: z.string().default('Asia/Kolkata'),
});
export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password'),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: z.string().min(10, 'Invalid reset link'),
  password: passwordSchema,
});

export const inviteMemberSchema = z.object({
  email: emailSchema,
  role: z.enum(['ADMIN', 'OPERATOR', 'VIEWER']),
  name: z.string().trim().min(2).max(100).optional(),
});

export const updateMemberRoleSchema = z.object({
  membershipId: z.string().min(1),
  role: z.enum(['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER']),
});

export const tenantSettingsSchema = z.object({
  name: z.string().trim().min(2).max(100),
  timezone: z.string().min(1),
});

export const apiKeySchema = z.object({
  name: z.string().trim().min(2).max(60),
  scopes: z.array(z.string()).default(['read']),
  expiresInDays: z.coerce.number().int().min(1).max(3650).optional(),
});
