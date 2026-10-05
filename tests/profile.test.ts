import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { User, connectDB } from "../src/lib/db";
import { AppError } from "../src/lib/domain";
import {
  assertAdminRole, clerkProfileName, fullNameSchema, phoneSchema,
  profileIsComplete, profileNeedsOnboarding, profileSchema,
} from "../src/lib/profile";
import { readOwnProfile, syncClerkIdentity, updateOwnProfile } from "../src/lib/profile-store";

let server: MongoMemoryReplSet;
before(async () => {
  server = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: "8.0.13" } });
  process.env.MONGODB_URI = server.getUri();
  await connectDB();
  await User.init();
}, { timeout: 240000 });
after(async () => { await mongoose.disconnect(); await server?.stop(); });

test("Primeiro acesso exige perfil completo e administradores não ficam bloqueados", () => {
  assert.equal(profileNeedsOnboarding({ role: "client", user: { name: "João da Silva" } }), true);
  assert.equal(profileNeedsOnboarding({ role: "client", user: { name: "cliente@example.com", phone: "85999123456" } }), true);
  assert.equal(profileNeedsOnboarding({ role: "admin", user: {} }), false);
  assert.equal(profileNeedsOnboarding({ role: "client", user: { name: "João da Silva", phone: "(85) 99912-3456" } }), false);
  assert.equal(clerkProfileName(null, null), "Cliente");
  assert.equal(clerkProfileName("usuario_123", null), "Cliente");
  assert.equal(clerkProfileName("João", "da Silva"), "João da Silva");
  assert.equal(fullNameSchema.parse("  Maria   D’Ávila  "), "Maria D’Ávila");
  for (const name of ["Cliente", "123 456", "joel@example.com", "joel_filho 015", "João"]) {
    assert.equal(fullNameSchema.safeParse(name).success, false);
  }
});

test("Telefone brasileiro aceita formatação, DDD e +55 e rejeita números incompletos", () => {
  for (const value of ["(85) 99912-3456", "85999123456", "+55 (85) 99912-3456", "5585999123456"]) {
    assert.equal(phoneSchema.parse(value), "5585999123456");
  }
  assert.equal(phoneSchema.parse("(11) 3456-7890"), "551134567890");
  assert.equal(phoneSchema.parse("(55) 99912-3456"), "5555999123456");
  assert.equal(phoneSchema.parse("+55 (85) 90123-4567"), "5585901234567");
  for (const value of ["", "999123456", "(85) 9123-4567", "(20) 99912-3456", "+1 85999123456", "(85) 99999-9999", "85 999123456 ramal 2", "abc85999123456"]) {
    assert.equal(phoneSchema.safeParse(value).success, false, value);
  }
});

test("Perfil próprio atualiza só o cliente autenticado, preserva identidade e rejeita privilégios", async () => {
  const own = await User.create({ clerkId: "profile-own", name: "Cliente", email: "own@example.com", role: "client", loyaltyCount: 3 });
  const other = await User.create({ clerkId: "profile-other", name: "Outra Pessoa", phone: "5585999129876", role: "client", loyaltyCount: 7 });
  const actor = { userId: String(own._id) };
  assert.equal((await readOwnProfile(actor)).complete, false);
  const result = await updateOwnProfile(actor, { name: "  João  da Silva ", phone: "(85) 99912-3456" });
  assert.deepEqual(result, { _id: String(own._id), name: "João da Silva", phone: "5585999123456", email: "own@example.com", role: "client", complete: true });
  const updated = await User.findById(own._id);
  assert.equal(updated.role, "client");
  assert.equal(updated.loyaltyCount, 3);
  assert.equal((await User.findById(other._id)).name, "Outra Pessoa");
  for (const extra of [{ role: "admin" }, { loyaltyCount: 9 }, { userId: String(other._id) }, { clerkId: "other" }, { email: "admin@example.com" }, { coupons: [] }]) {
    assert.equal(profileSchema.safeParse({ name: "João da Silva", phone: "85999123456", ...extra }).success, false);
    await assert.rejects(updateOwnProfile(actor, { name: "João da Silva", phone: "85999123456", ...extra }));
  }
  await assert.rejects(updateOwnProfile(actor, { name: "João da Silva", phone: "123" }));
  assert.equal((await User.findById(own._id)).phone, "5585999123456");
  assert.throws(() => assertAdminRole(updated.role), (error: unknown) => error instanceof AppError && error.status === 403);
  assert.doesNotThrow(() => assertAdminRole("admin"));
});

test("Sincronizar Clerk mantém nome editado e telefone locais, identidade continua no servidor", async () => {
  const created = await syncClerkIdentity({ clerkId: "profile-clerk", name: clerkProfileName(null, null), email: "initial@example.com", role: "client" });
  assert.equal(profileIsComplete(created), false);
  await updateOwnProfile({ userId: String(created._id) }, { name: "Nome Local Editado", phone: "85999123456" });
  const synchronized = await syncClerkIdentity({ clerkId: "profile-clerk", name: "Nome Antigo Clerk", email: "verified@example.com", role: "client" });
  assert.equal(synchronized.name, "Nome Local Editado");
  assert.equal(synchronized.phone, "5585999123456");
  assert.equal(synchronized.email, "verified@example.com");
  assert.equal(synchronized.role, "client");
  const unchanged = await syncClerkIdentity({ clerkId: "profile-clerk", name: "Outro Nome Clerk", email: "verified@example.com", role: "client" });
  assert.equal(+unchanged.updatedAt, +synchronized.updatedAt);
  const revoked = await syncClerkIdentity({ clerkId: "profile-clerk", name: "Outro Nome Clerk", email: "verified@example.com", role: "admin" });
  const demoted = await syncClerkIdentity({ clerkId: "profile-clerk", name: "Outro Nome Clerk", email: "verified@example.com", role: "client" });
  assert.equal(revoked.role, "admin");
  assert.equal(demoted.role, "client");
  assert.equal(profileNeedsOnboarding({ role: synchronized.role, user: synchronized }), false);
  const dto = await readOwnProfile({ userId: String(created._id) });
  assert.equal("clerkId" in dto, false);
  assert.equal("loyaltyCount" in dto, false);
  assert.equal("vehicles" in dto, false);
});
