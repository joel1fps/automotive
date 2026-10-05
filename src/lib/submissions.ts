import { createHash } from "node:crypto";
import mongoose from "mongoose";
import { z } from "zod";
import { Submission, connectDB } from "./db";
import { assert } from "./domain";

type Kind = "Appointment" | "Coupon" | "Transaction";
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "requestId").sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)]));
  return value;
}
function identity(operation: string, actor: string, requestId: string | undefined, input: unknown) {
  if (!requestId) return null; // Compatibility with historical integrations.
  z.uuid().parse(requestId);
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  return { key: hash(`${operation}:${actor}:${requestId}`), fingerprint: hash(JSON.stringify(canonical(input))) };
}
export async function replaySubmission(operation: string, actor: string, requestId: string | undefined, input: unknown, kind: Kind, session?: mongoose.ClientSession) {
  const submission = identity(operation, actor, requestId, input);
  if (!submission) return null;
  const query = Submission.findOne({ key: submission.key });
  if (session) query.session(session);
  const saved = await query.lean();
  if (!saved) return null;
  assert(saved.fingerprint === submission.fingerprint && saved.kind === kind, "Este envio já foi usado com outros dados. Inicie uma nova operação.", 409);
  const record = mongoose.models[kind].findById(saved.recordId);
  if (session) record.session(session);
  const result = await record.lean();
  assert(result, "O resultado deste envio não está mais disponível.", 409);
  return result;
}
export async function runSubmission(operation: string, actor: string, requestId: string | undefined, input: unknown, kind: Kind, work: (session: mongoose.ClientSession) => Promise<any>): Promise<any> {
  await connectDB();
  const submission = identity(operation, actor, requestId, input);
  try {
    return await mongoose.connection.transaction(async session => {
      const previous = await replaySubmission(operation, actor, requestId, input, kind, session);
      if (previous) return previous;
      const result = await work(session);
      if (submission) await Submission.create([{ ...submission, kind, recordId: result._id }], { session });
      return result;
    });
  } catch (error) {
    if (submission && (error as { code?: number }).code === 11000) {
      const previous = await replaySubmission(operation, actor, requestId, input, kind);
      if (previous) return previous;
    }
    throw error;
  }
}
