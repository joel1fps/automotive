import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";

// Provider module mocks stay confined to this child test process. Production
// routes and requireActor run unchanged; only the external Clerk provider is mocked.
test("Handlers reais: APIs administrativas retornam 401/403 e perfil próprio preserva autorização", { timeout: 120000 }, () => {
  const childEnvironment = { ...process.env };
  delete childEnvironment.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, [
    "--import", "tsx", "--test",
    path.join(process.cwd(), "tests", "fixtures", "api-access.ts"),
  ], { cwd: process.cwd(), env: childEnvironment, encoding: "utf8", timeout: 110000, maxBuffer: 2000000 });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /pass 25/);
});
