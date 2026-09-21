#!/usr/bin/env node
/**
 * Does genlayer-js get any further than genlayer-py with the 210 KB WASM?
 *
 * genlayer-js is the SDK the genlayer CLI uses, and it deployed a Python
 * contract to Bradbury successfully. This drives its real deployContract path
 * for both a tiny Python contract and the WASM, and stops at the broadcast.
 *
 * NOTHING IS SENT. All JSON-RPC goes through a local guard proxy on 127.0.0.1
 * that forwards every read method to Bradbury but refuses eth_sendRawTransaction
 * outright, so estimation runs for real and the broadcast cannot happen even if
 * the key were funded.
 *
 * Usage:
 *   node check_genlayer_js.mjs
 */

import { readFileSync } from "fs";
import http from "http";
import { createRequire } from "module";

const CLI = "/home/van/.nvm/versions/node/v24.10.0/lib/node_modules/genlayer";
// The 210 KB verifier is the whole point of this check and is NOT vendored
// here: clone github.com/genlayerlabs/tls-twitter-bounty and point WASM_PATH at
// tls-verifier-wasm/verifier.wasm. The fallback is the tiny probe, which only
// shows the estimation path succeeding.
const WASM =
  process.env.WASM_PATH ??
  new URL("./tiny-wasm/tiny_probe.wasm", import.meta.url).pathname;
const UPSTREAM = "https://rpc-bradbury.genlayer.com";
const THROWAWAY = "0x" + "11".repeat(32);

const require = createRequire(`${CLI}/package.json`);
const jsPath = require.resolve("genlayer-js");
const chainsPath = jsPath.replace(/dist\/index\.js$/, "dist/chains/index.js");
const { createClient, createAccount } = await import(`file://${jsPath}`);
const { testnetBradbury } = await import(`file://${chainsPath}`);

// ---- guard proxy -----------------------------------------------------------
const BLOCKED = new Set(["eth_sendRawTransaction", "eth_sendTransaction"]);
let blockedCount = 0;

const proxy = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", async () => {
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      res.writeHead(400).end("{}");
      return;
    }
    const calls = Array.isArray(parsed) ? parsed : [parsed];
    if (calls.some((c) => BLOCKED.has(c.method))) {
      blockedCount++;
      const reply = calls.map((c) => ({
        jsonrpc: "2.0",
        id: c.id,
        error: { code: -32000, message: "BLOCKED BY PROBE: refusing to broadcast" },
      }));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(Array.isArray(parsed) ? reply : reply[0]));
      return;
    }
    const upstream = await fetch(UPSTREAM, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "wasm-probe/1.0" },
      body,
    });
    const text = await upstream.text();
    res.writeHead(upstream.status, { "Content-Type": "application/json" });
    res.end(text);
  });
});

await new Promise((r) => proxy.listen(0, "127.0.0.1", r));
const endpoint = `http://127.0.0.1:${proxy.address().port}`;
console.log(`guard proxy       : ${endpoint} -> ${UPSTREAM}`);
console.log(`blocked methods   : ${[...BLOCKED].join(", ")}`);

// ---- payloads --------------------------------------------------------------
const wasmBytes = new Uint8Array(readFileSync(WASM));
const PY = new TextEncoder().encode(
  `# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from genlayer import *


class Contract(gl.Contract):
    n: u256

    def __init__(self):
        self.n = u256(1)

    @gl.public.view
    def get_n(self) -> u256:
        return self.n
`,
);

const account = createAccount(THROWAWAY);
const client = createClient({ chain: testnetBradbury, endpoint, account });
console.log(`deployer          : ${account.address}`);
console.log(`chain             : ${testnetBradbury.name} (id ${testnetBradbury.id})`);
console.log(`genlayer-js code  : accepts "string | Uint8Array"`);
await client.initializeConsensusSmartContract();

for (const [label, code] of [
  ["python-tiny", PY],
  ["wasm-210KB", wasmBytes],
]) {
  console.log(`\n--- ${label} (${code.length} bytes) ---`);
  const before = blockedCount;
  try {
    const hash = await client.deployContract({ code, args: [] });
    console.log(`  UNEXPECTED: returned ${hash}`);
  } catch (e) {
    const msg = (e?.shortMessage || e?.message || String(e)).split("\n")[0];
    if (blockedCount > before) {
      console.log(`  ESTIMATION PASSED, blocked at broadcast by the proxy`);
    } else {
      console.log(`  FAILED BEFORE BROADCAST: ${msg}`);
      const d = e?.details || e?.cause?.details || e?.cause?.message;
      if (d) console.log(`  details: ${String(d).slice(0, 220)}`);
    }
  }
}

proxy.close();
