import { loadEnvConfig } from "@next/env";
import mongoose from "mongoose";
import { migrateOperationalData } from "../src/lib/operational-migration";
import { AppError } from "../src/lib/domain";

async function main() {
loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
try {
  const result = await migrateOperationalData();
  console.log("Migração aditiva de automotive_homologacao:", JSON.stringify(result));
} catch (error) {
  // Driver errors may include connection details; never print them.
  console.error("Migração não aplicada:", error instanceof AppError
    ? error.message : "Verifique a conexão e os documentos legados. Nenhum segredo foi exibido.");
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
}
void main();
