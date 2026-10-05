import { z } from "zod";
import { AppError } from "./domain";

const brazilianAreaCodes = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28,
  31, 32, 33, 34, 35, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48, 49,
  51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69,
  71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89,
  91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

function normalizeBrazilianPhone(value: string) {
  // Accept display punctuation, but never silently discard letters or extensions.
  if (!/^\+?[\d\s().-]+$/.test(value.trim())) return null;
  let digits = value.replace(/\D/g, "");
  if (digits.length === 12 || digits.length === 13) {
    if (!digits.startsWith("55")) return null;
    digits = digits.slice(2);
  } else if (value.trim().startsWith("+")) return null;
  if (!brazilianAreaCodes.has(Number(digits.slice(0, 2)))) return null;
  const subscriber = digits.slice(2);
  if (!/^(?:[2-5]\d{7}|9\d{8})$/.test(subscriber)) return null;
  if (/^(\d)\1+$/.test(subscriber)) return null;
  return `55${digits}`;
}

export const phoneSchema = z.string().trim().max(30)
  .transform((value, context) => {
    const normalized = normalizeBrazilianPhone(value);
    if (!normalized) {
      context.addIssue({ code: "custom", message: "Informe um telefone brasileiro válido com DDD, por exemplo (85) 99912-3456." });
      return z.NEVER;
    }
    return normalized;
  });

export const fullNameSchema = z.string().trim()
  .transform((value) => value.replace(/\s+/g, " "))
  .pipe(z.string().min(5, "Informe seu nome completo.").max(120)
    .refine((value) => {
      const words = value.split(" ");
      return words.length >= 2 &&
        words.every((word) => /^[\p{L}]+(?:['’\-][\p{L}]+)*$/u.test(word)) &&
        (words[0].match(/\p{L}/gu)?.length || 0) >= 2 &&
        (words.at(-1)?.match(/\p{L}/gu)?.length || 0) >= 2;
    }, "Informe seu nome e sobrenome, sem e-mail ou nome de usuário."));

// Own-profile updates deliberately accept only these two fields.
export const profileSchema = z.object({ name: fullNameSchema, phone: phoneSchema }).strict();
export type ProfileFields = z.output<typeof profileSchema>;
type ProfileCandidate = { name?: unknown; phone?: unknown };

export function profileIsComplete(profile: ProfileCandidate) {
  return fullNameSchema.safeParse(profile.name).success && phoneSchema.safeParse(profile.phone).success;
}

export function profileNeedsOnboarding(actor: { role: string; user: ProfileCandidate }) {
  return actor.role !== "admin" && !profileIsComplete(actor.user);
}

export function clerkProfileName(firstName: string | null | undefined, lastName: string | null | undefined) {
  const candidate = [firstName, lastName].filter(Boolean).join(" ");
  const parsed = fullNameSchema.safeParse(candidate);
  return parsed.success ? parsed.data : "Cliente";
}

export function assertAdminRole(role: string) {
  if (role !== "admin") throw new AppError(403, "Acesso restrito ao administrador.");
}

export function profileDto(user: ProfileCandidate & { _id: unknown; email?: unknown; role?: unknown }) {
  return {
    _id: String(user._id),
    name: typeof user.name === "string" ? user.name : "",
    phone: typeof user.phone === "string" ? user.phone : "",
    email: typeof user.email === "string" ? user.email : "",
    role: user.role === "admin" ? "admin" as const : "client" as const,
    complete: profileIsComplete(user),
  };
}

export type OwnProfile = ReturnType<typeof profileDto>;
