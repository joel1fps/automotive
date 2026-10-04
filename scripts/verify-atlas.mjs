import { randomUUID } from "node:crypto";
import { setServers } from "node:dns";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";
import mongoose from "mongoose";

// Use Next's environment loader without printing file contents or credentials.
const projectDir = fileURLToPath(new URL("..", import.meta.url));
nextEnv.loadEnvConfig(projectDir, true, { info() {}, error() {} });

const databaseName = "automotive_homologacao";
const runId = randomUUID();
const collectionName = "__automotive_smoke";
const committedId = `commit:${runId}`;
const abortedId = `rollback:${runId}`;

class SmokeError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function verify(condition, code) {
  if (!condition) throw new SmokeError(code);
}

async function main() {
  const uri = process.env.MONGODB_URI;
  verify(uri, "DATABASE_NOT_CONFIGURED");
  try {
    // The driver parses SRV and multi-host URIs without opening a connection.
    const parsed = new mongoose.mongo.MongoClient(uri);
    verify(parsed.db().databaseName === databaseName, "WRONG_DATABASE");
  } catch (error) {
    if (error instanceof SmokeError) throw error;
    throw new SmokeError("INVALID_URI");
  }

  if (process.env.MONGODB_DNS_SERVERS) {
    setServers(process.env.MONGODB_DNS_SERVERS.split(",").map(value => value.trim()).filter(Boolean));
  }

  const connection = mongoose.createConnection(uri, {
    serverSelectionTimeoutMS: 7000,
    autoCreate: false,
    autoIndex: false,
  });
  let collection;
  let session;
  let cleanupFailed = false;
  try {
    await connection.asPromise();
    verify(connection.name === databaseName, "WRONG_DATABASE");
    await connection.db.command({ ping: 1 });
    console.log("PASS: conexão com automotive_homologacao.");

    collection = connection.db.collection(collectionName);
    // Create the collection outside a transaction using only a document owned by this run.
    await collection.insertOne({ _id: `prepare:${runId}`, runId, state: "prepare" });
    session = await connection.startSession();
    await session.withTransaction(async () => {
      await collection.insertOne({ _id: committedId, runId, state: "committed", value: 1 }, { session });
      await collection.updateOne({ _id: committedId, runId }, { $set: { value: 2 } }, { session });
    });
    const committed = await collection.findOne({ _id: committedId, runId });
    verify(committed?.value === 2, "COMMIT_FAILED");
    console.log("PASS: transação confirmou as gravações.");

    const rollback = new SmokeError("EXPECTED_ROLLBACK");
    try {
      await session.withTransaction(async () => {
        await collection.updateOne({ _id: committedId, runId }, { $set: { value: 3 } }, { session });
        await collection.insertOne({ _id: abortedId, runId, state: "aborted" }, { session });
        throw rollback;
      });
      throw new SmokeError("ROLLBACK_FAILED");
    } catch (error) {
      if (error !== rollback) throw error;
    }
    const [unchanged, aborted] = await Promise.all([
      collection.findOne({ _id: committedId, runId }),
      collection.findOne({ _id: abortedId, runId }),
    ]);
    verify(unchanged?.value === 2 && aborted === null, "ROLLBACK_FAILED");
    console.log("PASS: transação interrompida não deixou alterações.");
  } finally {
    if (session) await session.endSession();
    if (collection) {
      try {
        // Never drop collections/databases or remove documents from other runs.
        await collection.deleteMany({ runId });
        verify(await collection.countDocuments({ runId }) === 0, "CLEANUP_FAILED");
        console.log("PASS: documentos deste teste removidos.");
      } catch {
        cleanupFailed = true;
        console.error("FAIL: limpeza incompleta dos documentos deste teste.");
      }
    }
    await connection.close();
    if (cleanupFailed) throw new SmokeError("CLEANUP_FAILED");
  }
}

const messages = {
  DATABASE_NOT_CONFIGURED: "Configure MONGODB_URI localmente antes de testar.",
  INVALID_URI: "MONGODB_URI deve ser uma URI MongoDB válida.",
  WRONG_DATABASE: "Este teste exige a base automotive_homologacao na URI e não grava em outras bases.",
  COMMIT_FAILED: "Não foi possível verificar a confirmação da transação.",
  ROLLBACK_FAILED: "Não foi possível verificar o cancelamento da transação.",
  CLEANUP_FAILED: "Revise a permissão de remoção na coleção __automotive_smoke.",
};

void main().catch(error => {
  // Database errors can contain hostnames or connection strings; log only fixed messages.
  const message = error instanceof SmokeError ? messages[error.code]
    : error?.code === 18 ? "Falha de autenticação: revise o usuário e a senha no arquivo local."
      : error?.code === 13 ? "O usuário precisa de readWrite na base automotive_homologacao."
        : error?.code === 20 ? "O servidor precisa suportar transações em replica set."
          : error?.name === "MongooseServerSelectionError" ? "Não foi possível conectar: revise o cluster, DNS e a lista de IPs do Atlas."
            : "Teste não concluído. Revise a conexão, as permissões e o suporte a transações.";
  console.error(`FAIL: ${message ?? "Teste não concluído."}`);
  process.exitCode = 1;
});
