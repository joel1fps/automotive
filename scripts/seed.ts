import { seedCatalog } from "../src/lib/business";
import mongoose from "mongoose";
async function main(){
  try {
    await seedCatalog();
    await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
    console.log("Catálogo e configurações iniciais criados sem sobrescrever registros existentes.");
  } finally { await mongoose.disconnect(); }
}
void main().catch(error=>{console.error(error instanceof Error&&error.message==="DATABASE_NOT_CONFIGURED"?"Defina MONGODB_URI em .env.local antes de inicializar.":"Não foi possível inicializar o catálogo. Verifique a conexão e as permissões do banco.");process.exitCode=1;});
