import { test } from "node:test";
import assert from "node:assert/strict";
import { serverRole } from "../src/lib/access-policy";
test("Cadastro padrão é cliente e e-mail não verificado não concede administração", () => {
  assert.equal(
    serverRole({}, "admin@example.com", false, ["admin@example.com"]),
    "client",
  );
  assert.equal(
    serverRole({}, "client@example.com", true, ["admin@example.com"]),
    "client",
  );
});
test("Administração exige metadados do servidor ou e-mail verificado autorizado", () => {
  assert.equal(
    serverRole({ role: "admin" }, "client@example.com", false, []),
    "admin",
  );
  assert.equal(
    serverRole({}, "ADMIN@example.com", true, ["admin@example.com"]),
    "admin",
  );
});
