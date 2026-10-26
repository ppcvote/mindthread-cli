// Live, read-only checks against https://mindthread.tw/api/v1.
// Always: public formulas, and a bogus key rejected with exit code 4.
// With MINDTHREAD_API_KEY (use an mt_test_ key): whoami, accounts, schedules, events, all GET.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const BIN = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const KEY = (process.env.MINDTHREAD_API_KEY || "").trim();

function cli(args, key) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, ...args], { env: { ...process.env, MINDTHREAD_API_KEY: key, MINDTHREAD_API_URL: "", MINDTHREAD_CONFIG_DIR: join(mkdtempSync(join(tmpdir(), "mt-live-")), "cfg") } });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end();
  });
}

test("formulas works without a key", { timeout: 30_000 }, async () => {
  const r = await cli(["--json", "formulas"], "");
  assert.equal(r.code, 0, r.stderr);
  assert.ok(JSON.parse(r.stdout).data.formulas.length > 0);
});

test("a bogus key exits 4 with unauthorized", { timeout: 30_000 }, async () => {
  const r = await cli(["--json", "whoami"], "mt_test_bogus_key_for_contract_test_0000");
  assert.equal(r.code, 4);
  assert.equal(JSON.parse(r.stdout).error.code, "unauthorized");
});

test("authenticated read-only commands", { timeout: 90_000, skip: KEY ? false : "set MINDTHREAD_API_KEY (an mt_test_ key) to run" }, async () => {
  for (const args of [["whoami"], ["accounts"], ["schedules"], ["events", "--limit", "5"], ["usage", "--days", "1"]]) {
    const r = await cli(["--json", ...args], KEY);
    assert.equal(r.code, 0, `${args.join(" ")}: ${r.stdout}${r.stderr}`);
    assert.equal(JSON.parse(r.stdout).ok, true);
    assert.ok(!r.stdout.includes(KEY) && !r.stderr.includes(KEY));
  }
});
