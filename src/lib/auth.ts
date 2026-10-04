import { auth, currentUser } from "@clerk/nextjs/server";
import { User, RateLimit, connectDB } from "./db";
import { AppError } from "./domain";
import { serverRole } from "./access-policy";
export async function requireActor(admin = false) {
  if (
    !process.env.CLERK_SECRET_KEY ||
    !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
  )
    throw new AppError(503, "O acesso está aguardando configuração.");
  const { userId } = await auth();
  if (!userId) throw new AppError(401, "Entre na sua conta para continuar.");
  const clerk = await currentUser();
  if (!clerk) throw new AppError(401, "Sessão inválida");
  const email = clerk.emailAddresses.find(
    (e) => e.id === clerk.primaryEmailAddressId,
  );
  const allowlist = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  const role = serverRole(
    clerk.publicMetadata,
    email?.emailAddress,
    email?.verification?.status === "verified",
    allowlist,
  );
  if (admin && role !== "admin")
    throw new AppError(403, "Acesso restrito ao administrador.");
  await connectDB();
  const user = await User.findOneAndUpdate(
    { clerkId: userId },
    {
      $set: {
        name:
          [clerk.firstName, clerk.lastName].filter(Boolean).join(" ") ||
          email?.emailAddress ||
          "Cliente",
        email: email?.emailAddress,
        role,
      },
      $setOnInsert: { loyaltyCount: 0, totalWashes: 0 },
    },
    { upsert: true, returnDocument: "after" },
  );
  return { clerkId: userId, userId: String(user._id), role, user };
}
export async function rateLimit(key: string, limit = 60) {
  await connectDB();
  const window = Math.floor(Date.now() / 60000);
  let record;
  try {
    record = await RateLimit.findOneAndUpdate(
      { key: `${key}:${window}` },
      {
        $inc: { count: 1 },
        $setOnInsert: { expiresAt: new Date((window + 2) * 60000) },
      },
      { upsert: true, returnDocument: "after" },
    );
  } catch (error) {
    if (
      !error ||
      typeof error !== "object" ||
      !("code" in error) ||
      error.code !== 11000
    )
      throw error;
    record = await RateLimit.findOneAndUpdate(
      { key: `${key}:${window}` },
      { $inc: { count: 1 } },
      { returnDocument: "after" },
    );
  }
  if (record.count > limit)
    throw new AppError(429, "Muitas solicitações. Aguarde um minuto.");
}
