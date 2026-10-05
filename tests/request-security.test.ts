import { test } from "node:test";
import assert from "node:assert/strict";
import { allowedOrigins, assertMutationOrigin, MAX_REQUEST_BYTES, publicRateKey, readBoundedText, readJsonBody } from "../src/lib/request-security";
import { contentSecurityPolicy } from "../src/lib/security-headers";

function hasStatus(status: number) {
  return (error: unknown) => !!error && typeof error === "object" && "status" in error && error.status === status;
}
test("Origens autorizadas são exatas, vêm da configuração e excluem localhost na Vercel", () => {
  assert.deepEqual(allowedOrigins({ NODE_ENV: "production", VERCEL: "1", NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
    VERCEL_URL: "automotive-abcd.vercel.app", VERCEL_BRANCH_URL: "automotive-main.vercel.app",
    ALLOWED_ORIGINS: "https://automotive.example/, https://automotive.example, https://*.example, https://user:pass@example.com, https://evil.example/path, javascript:alert(1)" }),
  ["https://automotive.example", "https://automotive-abcd.vercel.app", "https://automotive-main.vercel.app"]);
  assert.deepEqual(allowedOrigins({ NODE_ENV: "development" }), ["http://localhost:3000"]);
});
test("Mutações rejeitam origem externa, origem ausente e subdomínio; aceita somente origem própria", () => {
  const previous = process.env.NEXT_PUBLIC_SITE_URL;
  process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
  try {
    const rejectedHeaders: Record<string, string>[] = [
      { origin: "https://evil.example" }, { origin: "null" }, {},
      { origin: "http://localhost:3000", "sec-fetch-site": "same-site" },
      { origin: "http://localhost:3000", "sec-fetch-site": "cross-site" },
    ];
    for (const headers of rejectedHeaders) assert.throws(() => assertMutationOrigin(new Request("http://localhost:3000/api/profile/me", { method: "PATCH", headers })), hasStatus(403));
    assert.doesNotThrow(() => assertMutationOrigin(new Request("http://localhost:3000/api/profile/me", { method: "PATCH", headers: { origin: "http://localhost:3000", "sec-fetch-site": "same-origin" } })));
    assert.doesNotThrow(() => assertMutationOrigin(new Request("http://localhost:3000/api/profile/me", { method: "PATCH", headers: { authorization: "Bearer signed-session-token" } })));
    assert.doesNotThrow(() => assertMutationOrigin(new Request("http://localhost:3000/api/services")));
  } finally { if (previous === undefined) delete process.env.NEXT_PUBLIC_SITE_URL; else process.env.NEXT_PUBLIC_SITE_URL = previous; }
});
test("JSON exige tipo correto, codificação válida e sintaxe válida", async () => {
  const json = (value: string, type = "application/json") => new Request("http://localhost:3000", { method: "POST", headers: { "content-type": type }, body: value });
  assert.deepEqual(await readJsonBody(json('{"name":"João"}', "application/json; charset=utf-8")), { name: "João" });
  await assert.rejects(readJsonBody(json("{}", "text/plain")), hasStatus(415));
  await assert.rejects(readJsonBody(json("{}", "application/json-evil")), hasStatus(415));
  await assert.rejects(readJsonBody(json("{")), hasStatus(400));
  await assert.rejects(readBoundedText(new Request("http://localhost:3000", { method: "POST", body: new Uint8Array([0xc3, 0x28]) })), hasStatus(400));
});
test("Tamanho declarado é validado antes de consumir o corpo", async () => {
  await assert.rejects(readBoundedText(new Request("http://localhost:3000", { method: "POST", headers: { "content-length": String(MAX_REQUEST_BYTES) }, body: "{}" })), hasStatus(413));
  await assert.rejects(readBoundedText(new Request("http://localhost:3000", { method: "POST", headers: { "content-length": "-1" }, body: "{}" })), hasStatus(400));
});
test("Corpo sem Content-Length é interrompido e cancelado no limite em bytes", async () => {
  let cancelled = false;
  let reads = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) { reads++; controller.enqueue(new Uint8Array(100000)); },
    cancel() { cancelled = true; },
  });
  const request = new Request("http://localhost:3000", { method: "POST", body: stream, duplex: "half" } as RequestInit);
  await assert.rejects(readBoundedText(request), hasStatus(413));
  assert.equal(cancelled, true);
  assert.ok(reads <= 4);
});
test("Falsificar forwarded headers localmente não muda o bucket; IP não aparece na chave", () => {
  const previous = process.env.VERCEL;
  try {
    delete process.env.VERCEL;
    const first = new Request("http://localhost:3000", { headers: { "x-forwarded-for": "203.0.113.1" } });
    const second = new Request("http://localhost:3000", { headers: { "x-vercel-forwarded-for": "203.0.113.2" } });
    assert.equal(publicRateKey(first, "tracking"), publicRateKey(second, "tracking"));
    process.env.VERCEL = "1";
    assert.notEqual(publicRateKey(first, "tracking"), publicRateKey(second, "tracking"));
    assert.match(publicRateKey(first, "tracking"), /^tracking:[a-f0-9]{64}$/);
    assert.equal(publicRateKey(first, "tracking").includes("203.0.113.1"), false);
  } finally { if (previous === undefined) delete process.env.VERCEL; else process.env.VERCEL = previous; }
});
test("CSP permite Clerk configurado e bloqueia frames, objetos e eval em produção", () => {
  const policy = contentSecurityPolicy({ NODE_ENV: "production", VERCEL: "1", NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: `pk_live_${Buffer.from("clerk.automotive.example$").toString("base64")}` }, "unpredictableNonceForFixture=");
  assert.match(policy, /https:\/\/clerk\.automotive\.example/);
  assert.match(policy, /frame-ancestors 'none'/);
  assert.match(policy, /object-src 'none'/);
  assert.match(policy, /base-uri 'self'/);
  assert.match(policy, /script-src[^;]*'nonce-unpredictableNonceForFixture='[^;]*'strict-dynamic'/);
  assert.match(policy, /upgrade-insecure-requests/);
  assert.doesNotMatch(policy, /unsafe-eval|ws:\/\//);
  assert.doesNotMatch(policy.split(";").find(directive => directive.startsWith("script-src")) || "", /unsafe-inline/);
  assert.match(contentSecurityPolicy({ NODE_ENV: "development" }), /unsafe-eval/);
});
