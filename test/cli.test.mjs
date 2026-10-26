// Contract tests with a local mock of https://mindthread.tw/api/v1: each command must send the
// documented method, path and body, only use routes listed in src/routes.ts, render errors with
// the documented exit codes, and never print the full key.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { matchRoute } from "../dist/routes.js";

const BIN = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const KEY = "mt_test_FAKEKEY000000000000000wxyz";
const ACC1 = "AAAAAAAAAAAAAAAAAAA1"; // 20-char Firestore-style ids
const ACC2 = "BBBBBBBBBBBBBBBBBBB2";

const ok = (data, extra = {}) => ({ status: 200, body: { ok: true, request_id: "req_test", data, ...extra } });
const fail = (status, error) => ({ status, body: { error: { request_id: "req_err", ...error } } });

/** Default answers per route; a test can override with its own handler */
function answer(req) {
  const p = req.path;
  if (p === "/accounts") return ok({ accounts: [
    { id: ACC1, threads_username: "@brand_one", display_name: "Brand One", status: "active", stats: { followers: 10, total_posts: 3 } },
    { id: ACC2, threads_username: "@brand_two", display_name: "Brand Two", status: "active", stats: { followers: 20, total_posts: 5 } },
  ] });
  if (p === "/me") return ok({ plan: "pro", key: { id: "K1", label: "agent", prefix: "mt_test", last4: "wxyz", kind: "test", scopes: { read: "allow" } }, api: { remaining_today: 499, daily_limit: 500, reset_at: "2026-10-27T16:00:00.000Z" }, accounts: { total: 2, connected: 2 } });
  if (p === "/content/publish") return ok({ post: { id: "post1", kind: "text", status: req.body.publish_now ? "published" : "scheduled", publish_at: req.body.publish_at ?? null } });
  if (p === "/content/schedule") return ok({ id: "sch1", status: "scheduled", publish_at: "2026-10-27T01:00:00.000Z" });
  if (p === "/content/generate") return ok({ contents: [{ text: "draft one", formula_used: "curiosity_hook", char_count: 9, rule_violations: [] }] });
  if (p === "/schedules") return ok({ schedules: [{ id: "s1", status: "scheduled", publish_at: "2026-10-27T01:00:00.000Z", text: "hello" }] });
  if (p === "/library" && req.method === "POST") return ok({ added: req.body.items.length, ids: req.body.items.map((_, i) => `lib${i}`), items: [] });
  if (p === "/patrol/cloud/pending") return ok({ items: [{ id: "pend1", type: "reply", draft: "nice point", post: { text: "original post", permalink: "https://www.threads.net/@x/post/1" } }], has_more: false, next_cursor: null });
  return ok({ echo: true });
}

async function mock(override) {
  const calls = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const u = new URL(req.url, "http://x");
      const path = u.pathname.replace(/^\/api\/v1/, "");
      const call = { method: req.method, path, query: Object.fromEntries(u.searchParams), headers: req.headers, body: raw ? JSON.parse(raw) : undefined };
      calls.push(call);
      const out = (override && override(call)) || answer(call);
      res.writeHead(out.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(out.body));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}/api/v1`, calls, close: () => new Promise((r) => server.close(r)) };
}

function cli(args, env = {}, input) {
  return new Promise((resolve) => {
    const home = mkdtempSync(join(tmpdir(), "mt-cli-"));
    const child = spawn(process.execPath, [BIN, ...args], {
      env: { ...process.env, MINDTHREAD_CONFIG_DIR: join(home, ".mindthread"), MINDTHREAD_API_KEY: KEY, MINDTHREAD_ACCOUNT: "", MINDTHREAD_JSON: "", ...env },
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ code, stdout, stderr, home }));
    if (input !== undefined) child.stdin.end(input); else child.stdin.end();
  });
}

/** Run a command against a fresh mock and return { r, calls } */
async function withMock(args, { env = {}, override, input } = {}) {
  const m = await mock(override);
  try {
    const r = await cli(args, { MINDTHREAD_API_URL: m.url, ...env }, input);
    for (const c of m.calls) assert.ok(matchRoute(c.method, c.path), `${c.method} ${c.path} is listed in src/routes.ts`);
    for (const c of m.calls) {
      assert.equal(c.headers.authorization, `Bearer ${KEY}`);
      assert.match(c.headers["user-agent"], /^mindthread-cli\/\d+\.\d+\.\d+/);
    }
    assert.ok(!r.stdout.includes(KEY) && !r.stderr.includes(KEY), "the full key is never printed");
    return { r, calls: m.calls };
  } finally { await m.close(); }
}

test("whoami renders the plan; --json prints the envelope untouched", async () => {
  const { r } = await withMock(["whoami"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /Plan\s+pro/);
  assert.match(r.stdout, /499\/500/);
  const j = await withMock(["whoami", "--json"]);
  assert.equal(JSON.parse(j.r.stdout).data.plan, "pro");
  const env = await withMock(["whoami"], { env: { MINDTHREAD_JSON: "1" } });
  assert.equal(JSON.parse(env.r.stdout).request_id, "req_test");
});

test("post --now publishes to the account picked by @handle", async () => {
  const { r, calls } = await withMock(["post", "hello world", "-a", "@brand_two", "--now", "--topic-tag", "Threads 新手"]);
  assert.equal(r.code, 0, r.stderr);
  const pub = calls.find((c) => c.path === "/content/publish");
  assert.deepEqual(pub.body, { account_id: ACC2, text: "hello world", publish_now: true, topic_tag: "Threads 新手" });
  assert.match(r.stdout, /Published/);
});

test("post --at sends publish_at; relative times become ISO; offsets are required", async () => {
  const { calls } = await withMock(["post", "later", "-a", ACC1, "--at", "2026-11-01T09:00:00+08:00", "--media", "https://x.test/a.png,https://x.test/b.png"]);
  const pub = calls.find((c) => c.path === "/content/publish");
  assert.equal(pub.body.publish_at, "2026-11-01T09:00:00+08:00");
  assert.deepEqual(pub.body.media_urls, ["https://x.test/a.png", "https://x.test/b.png"]);
  assert.equal(calls.some((c) => c.path === "/accounts"), false, "a 20-char id skips the account lookup");

  const rel = await withMock(["post", "soon", "-a", ACC1, "--at", "+2h"]);
  const at = Date.parse(rel.calls.find((c) => c.path === "/content/publish").body.publish_at);
  assert.ok(Math.abs(at - (Date.now() + 2 * 3600e3)) < 120e3);

  const bad = await withMock(["post", "x", "-a", ACC1, "--at", "2026-11-01 09:00"]);
  assert.equal(bad.r.code, 2);
  assert.match(bad.r.stderr, /UTC offset/);
  assert.equal(bad.calls.length, 0);
});

test("warnings from the API are printed one per line and never change the exit code (API 1.17.0)", async () => {
  const warn = { code: "off_hours", message: "Scheduled for 03:00 (Asia/Taipei), outside this account's usual posting hours (9:00, 21:00, based on its posting times). Make sure this time is intended.", message_zh: "x", detail: {} };
  const { r } = await withMock(["post", "later", "-a", ACC1, "--at", "2026-11-01T03:00:00+08:00"], { override: (c) => c.path === "/content/publish" ? ok({ post: { id: "p9", kind: "text", status: "scheduled", publish_at: c.body.publish_at }, warnings: [warn] }) : null });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /⚠ off_hours: Scheduled for 03:00/);
  const q = await withMock(["queue", "list", "-a", ACC1], { override: (c) => c.path === "/library" && c.method === "GET" ? ok({ items: [{ id: "lib1", position: 1, next_publish_at: "2026-10-29T01:30:00.000Z", text: "昨天的新聞", warnings: [{ code: "stale_time_reference", message: "Written 10/26, publishing 10/29 (3 days later)", message_zh: "x", detail: {} }] }] }) : null });
  assert.match(q.r.stdout, /⚠ lib1: stale_time_reference: Written 10\/26/);
  const j = await withMock(["post", "later", "-a", ACC1, "--at", "2026-11-01T03:00:00+08:00", "--json"], { override: (c) => c.path === "/content/publish" ? ok({ post: { id: "p9" }, warnings: [warn] }) : null });
  assert.equal(JSON.parse(j.r.stdout).data.warnings[0].code, "off_hours", "--json keeps the envelope untouched");
});

test("changed_since_last_viewed prints the removed and added sentences on approve, bulk approve, edit and schedules list (API 1.18.0)", async () => {
  const changed = { code: "changed_since_last_viewed", message: "Changed since the account owner last viewed it (10/25 14:02, Asia/Taipei): 1 sentence removed, 1 added. Review the difference before it goes out.", message_zh: "x", detail: { removed: ["Seats are limited."], added: ["Seats are gone, join the next batch."], removed_count: 1, added_count: 1, media_changed: true, time_changed: false } };
  const a = await withMock(["queue", "approve", "lib1"], { override: (c) => c.path === "/library/lib1/approve" ? ok({ id: "lib1", status: "queued", warnings: [changed] }) : null });
  assert.equal(a.r.code, 0, a.r.stderr);
  assert.match(a.r.stdout, /⚠ lib1: changed_since_last_viewed: Changed since the account owner last viewed it/);
  assert.match(a.r.stdout, /\n      - Seats are limited\./);
  assert.match(a.r.stdout, /\n      \+ Seats are gone, join the next batch\./);
  assert.match(a.r.stdout, /~ media changed/);
  const b = await withMock(["queue", "approve", "lib1", "lib2"], { override: (c) => c.path === "/library/bulk" ? ok({ action: "approve", requested: 2, done: 2, results: [{ id: "lib1", ok: true, status: "queued", warnings: [changed] }, { id: "lib2", ok: true, status: "queued", warnings: [] }] }) : null });
  assert.match(b.r.stdout, /⚠ lib1: changed_since_last_viewed/);
  assert.doesNotMatch(b.r.stdout, /lib2: changed/);
  const e = await withMock(["queue", "edit", "lib1", "new text"], { override: (c) => c.path === "/library/lib1" && c.method === "PATCH" ? ok({ id: "lib1", status: "queued", warnings: [changed] }) : null });
  assert.match(e.r.stdout, /✓ Updated lib1[\s\S]*⚠ lib1: changed_since_last_viewed/);
  const l = await withMock(["schedules", "list"], { override: (c) => c.path === "/schedules" ? ok({ schedules: [{ id: "p1", status: "scheduled", publish_at: "2026-10-30T01:00:00.000Z", text: "hello", warnings: [{ ...changed, detail: { ...changed.detail, media_changed: false, time_changed: true, previous_scheduled_at: "2026-10-29T01:00:00.000Z", scheduled_at: "2026-10-30T01:00:00.000Z" } }] }] }) : null });
  assert.match(l.r.stdout, /⚠ p1: changed_since_last_viewed/);
  assert.match(l.r.stdout, /~ publish time: 2026-10-29T01:00:00.000Z → 2026-10-30T01:00:00.000Z/);
  const j = await withMock(["queue", "approve", "lib1", "--json"], { override: (c) => c.path === "/library/lib1/approve" ? ok({ id: "lib1", status: "queued", warnings: [changed] }) : null });
  assert.equal(JSON.parse(j.r.stdout).data.warnings[0].code, "changed_since_last_viewed", "--json keeps the envelope untouched");
  assert.equal(j.r.code, 0);
});

test("post --best-time uses /content/schedule with auto_optimize_time; text can come from stdin", async () => {
  const { r, calls } = await withMock(["post", "-", "-a", ACC1, "--best-time"], { input: "from stdin\n" });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(calls.at(-1).body, { account_id: ACC1, text: "from stdin", auto_optimize_time: true });
});

test("post needs exactly one timing flag and an account when several are connected", async () => {
  const none = await withMock(["post", "x", "-a", ACC1]);
  assert.equal(none.r.code, 2);
  const many = await withMock(["post", "x", "--now"]);
  assert.equal(many.r.code, 2);
  assert.match(many.r.stderr, /@brand_one, @brand_two/);
  const env = await withMock(["post", "x", "--now"], { env: { MINDTHREAD_ACCOUNT: "brand_one" } });
  assert.equal(env.calls.at(-1).body.account_id, ACC1);
});

test("approval_required exits 3 and hands over the confirmation link", async () => {
  const { r } = await withMock(["post", "x", "-a", ACC1, "--now"], {
    override: (c) => c.path === "/content/publish" && fail(403, { code: "approval_required", message: "Needs owner", approval_id: "apr_1", approval: { id: "apr_1", human_url: "https://mindthread.tw/approve/apr_1", human_message: "Your agent wants to publish a post" } }),
  });
  assert.equal(r.code, 3);
  assert.match(r.stderr, /https:\/\/mindthread\.tw\/approve\/apr_1/);
  assert.match(r.stderr, /mindthread approval apr_1/);
  assert.match(r.stderr, /request_id req_err/);
});

test("errors: insufficient_scope shows the fix, rate limits exit 5, rejected keys exit 4, --json prints the error envelope", async () => {
  const scope = await withMock(["schedules"], { override: () => fail(403, { code: "insufficient_scope", message: "Denied", required: ["read"], fix: "Settings → API keys → Edit permissions" }) });
  assert.equal(scope.r.code, 1);
  assert.match(scope.r.stderr, /Fix: Settings → API keys/);

  const rl = await withMock(["schedules"], { override: () => fail(429, { code: "rate_limit_exceeded", message: "Too many", window: "minute", limit: 120, used: 120, retry_after_seconds: 30 }) });
  assert.equal(rl.r.code, 5);
  assert.match(rl.r.stderr, /Retry after 30 s/);

  const bad = await withMock(["whoami"], { override: () => fail(401, { code: "unauthorized", message: "Invalid API token" }) });
  assert.equal(bad.r.code, 4);
  assert.match(bad.r.stderr, /rejected MINDTHREAD_API_KEY/);

  const rules = await withMock(["--json", "post", "x", "-a", ACC1, "--now"], { override: (c) => c.path === "/content/publish" && fail(422, { code: "content_rules_violated", message: "Blocked", violations: [{ rule: "forbid_cta" }] }) });
  assert.equal(rules.r.code, 1);
  assert.equal(JSON.parse(rules.r.stdout).error.code, "content_rules_violated");
});

test("no key: exits 4 before any request", async () => {
  const { r, calls } = await withMock(["accounts"], { env: { MINDTHREAD_API_KEY: "" } });
  assert.equal(r.code, 4);
  assert.match(r.stderr, /No API key/);
  assert.equal(calls.length, 0);
});

test("generate, schedules, queue add (--- separated stdin), patrol pending/approve/reject, keyword suggestions", async () => {
  const g = await withMock(["generate", "remote work", "-n", "2", "-f", "curiosity_hook"]);
  assert.deepEqual(g.calls[0].body, { topic: "remote work", count: 2, formula: "curiosity_hook" });
  assert.match(g.r.stdout, /draft one/);

  const s = await withMock(["schedules", "-a", ACC1]);
  assert.deepEqual(s.calls[0].query, { account_id: ACC1 });
  assert.match(s.r.stdout, /s1/);

  const q = await withMock(["queue", "add", "-", "-a", ACC1, "--draft"], { input: "first\n---\nsecond\n" });
  assert.deepEqual(q.calls[0].body, { account_id: ACC1, status: "draft", items: [{ text: "first" }, { text: "second" }] });

  const p = await withMock(["patrol", "pending", "-a", ACC1]);
  assert.deepEqual(p.calls[0].query, { account_id: ACC1, status: "pending" });
  assert.match(p.r.stdout, /nice point/);

  const ap = await withMock(["patrol", "approve", "pend1", "--reply", "edited"]);
  assert.equal(ap.calls[0].path, "/patrol/cloud/pending/pend1/approve");
  assert.deepEqual(ap.calls[0].body, { reply: "edited" });

  const rj = await withMock(["patrol", "reject", "pend1"]);
  assert.equal(rj.calls[0].path, "/patrol/cloud/pending/pend1/reject");

  const kw = await withMock(["patrol", "keywords", "-a", ACC1]);
  assert.equal(kw.calls[0].path, "/patrol/cloud/keyword-suggestions");

  const ps = await withMock(["patrol", "set", "-a", ACC1, "--keywords", "保險,#退休", "--daily-cap", "10", "--review", "--disable"]);
  assert.deepEqual(ps.calls[0].body, { account_id: ACC1, keywords: ["保險", "#退休"], daily_cap: 10, enabled: false, review_before_reply: true });
});

test("queue approve uses the single route for one id and bulk for several", async () => {
  const one = await withMock(["queue", "approve", "lib1"]);
  assert.equal(one.calls[0].path, "/library/lib1/approve");
  const many = await withMock(["queue", "approve", "lib1", "lib2"]);
  assert.deepEqual(many.calls[0].body, { action: "approve", ids: ["lib1", "lib2"] });
});

test("insights accepts -a all; settings set sends only changed fields", async () => {
  const i = await withMock(["insights", "-a", "all", "-p", "30d"]);
  assert.deepEqual(i.calls[0].query, { account_id: "all", period: "30d" });
  const st = await withMock(["settings", "set", "-a", ACC1, "--schedule-times", "09:00,21:00", "--review-before-publish", "true", "--content-rules", "{\"forbid_cta\":true,\"enforce\":\"block\"}", "--dry-run"]);
  assert.equal(st.calls[0].method, "PATCH");
  assert.equal(st.calls[0].path, `/accounts/${ACC1}/settings`);
  assert.deepEqual(st.calls[0].body, { schedule_times: "09:00,21:00", review_before_publish: true, content_rules: { forbid_cta: true, enforce: "block" }, dry_run: true });
});

test("ids from the command line cannot change the route", async () => {
  const { calls } = await withMock(["schedules", "cancel", "../me"]);
  assert.equal(calls[0].path, "/schedules/..%2Fme");
});

test("raw api command passes method, path, query and body", async () => {
  const m = await mock();
  try {
    const r = await cli(["api", "POST", "/api/v1/accounts/x/material", "-d", "{\"dry\":true}", "-q", "a=1"], { MINDTHREAD_API_URL: m.url });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(m.calls[0].path, "/accounts/x/material");
    assert.deepEqual(m.calls[0].query, { a: "1" });
    assert.deepEqual(m.calls[0].body, { dry: true });
    assert.equal(JSON.parse(r.stdout).ok, true);
  } finally { await m.close(); }
});

test("auth login verifies and saves the key with owner-only permissions; status masks it; logout removes it", async () => {
  const m = await mock();
  try {
    const login = await cli(["auth", "login", KEY], { MINDTHREAD_API_URL: m.url, MINDTHREAD_API_KEY: "" });
    assert.equal(login.code, 0, login.stderr);
    assert.equal(m.calls[0].path, "/me");
    const file = join(login.home, ".mindthread", "config.json");
    assert.equal(JSON.parse(readFileSync(file, "utf8")).apiKey, KEY);
    assert.ok(!login.stdout.includes(KEY));
    if (process.platform !== "win32") assert.equal((await import("node:fs")).statSync(file).mode & 0o777, 0o600);

    const bad = await cli(["auth", "login", "not-a-key", "--no-verify"], { MINDTHREAD_API_KEY: "" });
    assert.equal(bad.code, 2);
  } finally { await m.close(); }

  const home = mkdtempSync(join(tmpdir(), "mt-cli-"));
  const dir = join(home, ".mindthread");
  const run = (args) => new Promise((resolve) => {
    const c = spawn(process.execPath, [BIN, ...args], { env: { ...process.env, MINDTHREAD_CONFIG_DIR: dir, MINDTHREAD_API_KEY: "" } });
    let out = "";
    c.stdout.on("data", (d) => (out += d));
    c.on("close", (code) => resolve({ code, out }));
    c.stdin.end();
  });
  (await import("node:fs")).mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "config.json"), JSON.stringify({ apiKey: KEY }));
  const st = await run(["auth", "status"]);
  assert.match(st.out, /mt_test_…wxyz/);
  assert.ok(!st.out.includes(KEY));
  const out = await run(["auth", "logout"]);
  assert.equal(out.code, 0);
  assert.equal(existsSync(join(dir, "config.json")), false);
  const none = await run(["auth", "status"]);
  assert.equal(none.code, 4);
});

test("help and version exit 0; unknown commands exit 2", async () => {
  assert.equal((await cli(["--help"])).code, 0);
  const v = await cli(["--version"]);
  assert.match(v.stdout.trim(), /^\d+\.\d+\.\d+$/);
  assert.equal((await cli(["nope"])).code, 2);
});
