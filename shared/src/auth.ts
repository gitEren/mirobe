import { z } from 'zod';

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/** Emails are stored and compared trimmed + lower-cased. */
export const EmailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

export const PasswordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);

export const RegisterSchema = z.object({
  email: EmailSchema,
  password: PasswordSchema,
  name: z.string().trim().max(80).optional(),
});
export type RegisterInput = z.infer<typeof RegisterSchema>;

export const LoginSchema = z.object({
  email: EmailSchema,
  // Not the full password policy: a login must never reveal which rule an old password breaks.
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});
export type LoginInput = z.infer<typeof LoginSchema>;

/** Error codes the auth endpoints and the AI gate return in `code`. */
export const AUTH_ERROR_CODES = ['EMAIL_TAKEN', 'INVALID_CREDENTIALS', 'RATE_LIMITED', 'AUTH_REQUIRED'] as const;
export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];

/** Deleting an account: a registered account confirms with its current password; an anonymous one sends nothing. */
export const DeleteAccountSchema = z.object({
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH).optional(),
});
export type DeleteAccountInput = z.infer<typeof DeleteAccountSchema>;
