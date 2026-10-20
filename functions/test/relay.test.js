const { test } = require("node:test");
const assert = require("node:assert/strict");
const { STUN, cleanIceServers, relayPass } = require("../relay");

const cloudflare = {
  iceServers: [
    { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"] },
    {
      urls: [
        "turn:turn.cloudflare.com:3478?transport=udp", "turn:turn.cloudflare.com:53?transport=udp",
        "turn:turn.cloudflare.com:3478?transport=tcp", "turns:turn.cloudflare.com:5349?transport=tcp",
        "javascript:alert(1)",
      ],
      username: "u", credential: "c", extra: "dropped",
    },
  ],
};

test("keeps only what WebRTC needs and drops port 53", () => {
  assert.deepEqual(cleanIceServers(cloudflare), [
    { urls: ["stun:stun.cloudflare.com:3478"] },
    {
      urls: ["turn:turn.cloudflare.com:3478?transport=udp", "turn:turn.cloudflare.com:3478?transport=tcp", "turns:turn.cloudflare.com:5349?transport=tcp"],
      username: "u", credential: "c",
    },
  ]);
  assert.deepEqual(cleanIceServers({ iceServers: { urls: "turn:x:3478", username: "u", credential: "c" } }),
    [{ urls: ["turn:x:3478"], username: "u", credential: "c" }]);
  assert.deepEqual(cleanIceServers(null), []);
});

test("without a relay key, sharing keeps working with STUN only", async () => {
  let called = false;
  const servers = await relayPass({ keyId: "", apiToken: "", fetchImpl: () => { called = true; } });
  assert.deepEqual(servers, STUN);
  assert.equal(called, false);
});

test("asks Cloudflare for a short-lived pass and adds the relay", async () => {
  let seen;
  const fetchImpl = async (url, init) => { seen = { url, init }; return { ok: true, json: async () => cloudflare }; };
  const servers = await relayPass({ keyId: "key1", apiToken: "tok", fetchImpl });
  assert.match(seen.url, /\/v1\/turn\/keys\/key1\/credentials\/generate-ice-servers$/);
  assert.equal(seen.init.headers.Authorization, "Bearer tok");
  assert.equal(JSON.parse(seen.init.body).ttl, 7200);
  assert.deepEqual(servers.slice(0, STUN.length), STUN);
  assert.equal(servers.at(-1).username, "u");
  assert.ok(servers.every((s) => s.urls.every((u) => !/:53(\?|$)/.test(u))));
});

test("falls back to STUN when Cloudflare fails or is slow", async () => {
  assert.deepEqual(await relayPass({ keyId: "k", apiToken: "t", fetchImpl: async () => ({ ok: false, status: 401 }) }), STUN);
  assert.deepEqual(await relayPass({ keyId: "k", apiToken: "t", fetchImpl: async () => { throw new Error("timeout"); } }), STUN);
  assert.deepEqual(await relayPass({ keyId: "k", apiToken: "t", fetchImpl: async () => ({ ok: true, json: async () => ({}) }) }), STUN);
});
