import { User, connectDB } from "./db";
import { AppError } from "./domain";
import { profileDto, profileSchema } from "./profile";

type ProfileActor = { userId: string };

export async function readOwnProfile(actor: ProfileActor) {
  await connectDB();
  const user = await User.findById(actor.userId);
  if (!user) throw new AppError(404, "Perfil não encontrado.");
  return profileDto(user);
}

export async function updateOwnProfile(actor: ProfileActor, input: unknown) {
  const profile = profileSchema.parse(input);
  await connectDB();
  const user = await User.findByIdAndUpdate(actor.userId, { $set: profile }, {
    returnDocument: "after", runValidators: true,
  });
  if (!user) throw new AppError(404, "Perfil não encontrado.");
  return profileDto(user);
}

// Clerk controls identity and privileges; the local profile controls display name and phone.
export async function syncClerkIdentity(identity: {
  clerkId: string; name: string; email?: string; role: "client" | "admin";
}) {
  await connectDB();
  const existing = await User.findOne({ clerkId: identity.clerkId });
  if (existing && existing.email === (identity.email || "") && existing.role === identity.role) return existing;
  const update = {
    $set: { email: identity.email || "", role: identity.role },
    $setOnInsert: { name: identity.name, loyaltyCount: 0, totalWashes: 0 },
  };
  try {
    return await User.findOneAndUpdate({ clerkId: identity.clerkId }, update, {
      upsert: true, returnDocument: "after",
    });
  } catch (error) {
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== 11000) throw error;
    return await User.findOneAndUpdate({ clerkId: identity.clerkId }, update, { returnDocument: "after" });
  }
}
