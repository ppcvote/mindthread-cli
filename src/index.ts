#!/usr/bin/env node
/**
 * mindthread: the Threads scheduler built for AI agents, as a CLI.
 * Every command maps to one MindThread REST call (src/routes.ts); --json prints the API envelope as-is.
 */
import { Command, CommanderError, Option } from "commander";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { ApiError, KEY_PAGE, VERSION, api, apiUrl, configFile, deleteConfig, mask, request, resolveKey, seg, writeConfig, type Method } from "./client.js";
import { EXIT, UsageError, block, clip, emit, kv, line, printJson, renderError, state, table } from "./output.js";

// ── input helpers ────────────────────────────────────────────────────────────

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** Text from the argument, --file (path or -) or "-". Stdin is only read when asked for: an agent that spawns us with an open stdin pipe must never hang */
async function readText(arg: string | undefined, file: string | undefined, what = "text"): Promise<string> {
  if (file) return (file === "-" ? await readStdin() : readFileSync(file, "utf8")).trim();
  if (arg === "-") return (await readStdin()).trim();
  if (arg !== undefined) return arg;
  throw new UsageError(`Give the ${what} as an argument, with --file <path>, or "-" to read stdin`);
}

/** Several texts in one input, separated by lines that contain only --- */
const splitParts = (s: string) => s.split(/^\s*---\s*$/m).map((p) => p.trim()).filter(Boolean);

/** --at: ISO 8601 with an offset, or relative +30m / +2h / +1d */
function parseWhen(s: string): string {
  const rel = /^\+(\d+)\s*([mhd])$/i.exec(s.trim());
  if (rel) {
    const unit = { m: 60_000, h: 3_600_000, d: 86_400_000 }[rel[2].toLowerCase() as "m" | "h" | "d"];
    return new Date(Date.now() + Number(rel[1]) * unit).toISOString();
  }
  if (!/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(s.trim()) || Number.isNaN(Date.parse(s))) {
    throw new UsageError(`--at needs a time with a UTC offset, e.g. 2026-11-01T09:00:00+08:00, or a relative time like +2h (got "${s}")`);
  }
  return s.trim();
}

const int = (name: string, min: number, max: number) => (v: string) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new UsageError(`${name} must be a whole number from ${min} to ${max}`);
  return n;
};
const bool = (name: string) => (v: string) => {
  const t = v.trim().toLowerCase();
  if (["true", "on", "yes", "1"].includes(t)) return true;
  if (["false", "off", "no", "0"].includes(t)) return false;
  throw new UsageError(`${name} must be true or false`);
};
const collect = (v: string, prev: string[] = []) => prev.concat(v.split(",").map((x) => x.trim()).filter(Boolean));
const csv = (v: string) => v.split(",").map((x) => x.trim()).filter(Boolean);

/** JSON from an inline string, @file or - (stdin) */
async function readJson(v: string, name: string): Promise<unknown> {
  const raw = v === "-" ? await readStdin() : v.startsWith("@") ? readFileSync(v.slice(1), "utf8") : v;
  try { return JSON.parse(raw); } catch { throw new UsageError(`${name} is not valid JSON`); }
}

// ── accounts ─────────────────────────────────────────────────────────────────

type Account = { id: string; threads_username?: string; display_name?: string; status?: string; stats?: Record<string, number> };
let accountsCache: Account[] | null = null;
async function listAccounts(): Promise<Account[]> {
  accountsCache ??= ((await api.get("/accounts")).data?.accounts ?? []) as Account[];
  return accountsCache;
}

/** -a accepts an account id or a @handle; without it MINDTHREAD_ACCOUNT, then the only connected account */
async function resolveAccount(input: string | undefined, allowAll = false): Promise<string> {
  const v = (input ?? process.env.MINDTHREAD_ACCOUNT ?? "").trim();
  if (allowAll && v === "all") return "all";
  if (/^[A-Za-z0-9]{20}$/.test(v)) return v; // Firestore document id
  const accounts = await listAccounts();
  if (v) {
    const handle = v.replace(/^@/, "").toLowerCase();
    const hit = accounts.find((a) => a.id === v || String(a.threads_username ?? "").replace(/^@/, "").toLowerCase() === handle);
    if (!hit) throw new UsageError(`No connected account matches "${v}". Connected: ${accounts.map((a) => a.threads_username).join(", ") || "none"}`);
    return hit.id;
  }
  if (accounts.length === 1) return accounts[0].id;
  if (!accounts.length) throw new UsageError("No Threads account is connected yet. Connect one at https://mindthread.tw or run `mindthread connect-link`.");
  throw new UsageError(`Several accounts are connected; pick one with -a <@handle|id> or MINDTHREAD_ACCOUNT: ${accounts.map((a) => a.threads_username).join(", ")}`);
}

const accountOpt = () => new Option("-a, --account <account>", "account @handle or id (default: MINDTHREAD_ACCOUNT, or the only connected account)");

// ── program ──────────────────────────────────────────────────────────────────

const program = new Command();
program
  .name("mindthread")
  .description("Threads scheduler built for AI agents: write, schedule and publish Threads posts, review replies and read insights.")
  .version(VERSION, "-v, --version")
  .option("--json", "print the raw API response as JSON (for scripts and agents)")
  .showHelpAfterError("(add --help for usage)")
  .exitOverride()
  .hook("preAction", () => { state.json = Boolean(program.opts().json) || process.env.MINDTHREAD_JSON === "1"; })
  .addHelpText("after", `
Environment:
  MINDTHREAD_API_KEY   API key (mt_live_… or mt_test_…), overrides the saved key
  MINDTHREAD_ACCOUNT   default account (@handle or id) for -a
  MINDTHREAD_API_URL   API base URL (default https://mindthread.tw/api/v1)

Exit codes: 0 ok, 1 error, 2 usage, 3 waiting for the owner's approval, 4 missing or rejected key, 5 rate limited

Get a key: ${KEY_PAGE}
Docs: https://github.com/ppcvote/mindthread-cli · API: https://mindthread.tw/api/v1/openapi.json`);

/** Wrap an action: render errors and set the exit code without cutting stdout short */
const run = <A extends unknown[]>(fn: (...args: A) => Promise<void>) => async (...args: A) => {
  try { await fn(...args); } catch (e) { process.exitCode = renderError(e); }
};

// auth ─────────────────────────────────────────────────────────────────────────

const auth = program.command("auth").description("save, check or remove the API key");

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
    process.stderr.write(question);
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = () => {};
    rl.question("", (answer) => { rl.close(); process.stderr.write("\n"); resolve(answer.trim()); });
  });
}

auth
  .command("login")
  .description("save an API key to ~/.mindthread/config.json (prompts when no key is given)")
  .argument("[key]", "the key, or '-' to read it from stdin; omit it to paste at a hidden prompt")
  .option("--no-verify", "save without checking the key against the API")
  .action(run(async (keyArg: string | undefined, opts: { verify: boolean }) => {
    if (keyArg === undefined && !process.stdin.isTTY) throw new UsageError("Pass the key as an argument, or '-' to read it from stdin");
    const key = (keyArg === "-" ? await readStdin() : keyArg ?? (await promptHidden("MindThread API key: "))).trim();
    if (!/^mt_(live|test)_[A-Za-z0-9_-]{8,}$/.test(key)) throw new UsageError("That does not look like a MindThread API key (mt_live_… or mt_test_…)");
    let who: Record<string, any> = {};
    if (opts.verify) {
      const before = process.env.MINDTHREAD_API_KEY;
      process.env.MINDTHREAD_API_KEY = key;
      try { who = (await api.get("/me")).data ?? {}; } finally { if (before === undefined) delete process.env.MINDTHREAD_API_KEY; else process.env.MINDTHREAD_API_KEY = before; }
    }
    writeConfig({ apiKey: key });
    emit({ ok: true, saved: configFile(), key: mask(key), plan: who.plan ?? null }, () => {
      line(`✓ Saved ${mask(key)} to ${configFile()}${who.plan ? ` (plan: ${who.plan}${who.key?.label ? `, key: ${who.key.label}` : ""})` : ""}`);
      if (process.env.MINDTHREAD_API_KEY) line("  Note: MINDTHREAD_API_KEY is set in this shell and takes precedence over the saved key.");
    });
  }));

auth
  .command("status")
  .description("show which key is in use (offline; `mindthread whoami` checks it against the API)")
  .action(run(async () => {
    const { key, source } = resolveKey();
    const info = { authenticated: Boolean(key), source, key: key ? mask(key) : null, kind: key?.startsWith("mt_test_") ? "test" : key ? "live" : null, api_url: apiUrl() };
    emit(info, () => {
      if (!key) { line(`✗ No API key. Set MINDTHREAD_API_KEY or run \`mindthread auth login\`. Create one at ${KEY_PAGE}.`); return; }
      line(`✓ ${info.kind} key ${info.key} from ${source === "env" ? "MINDTHREAD_API_KEY" : configFile()}`);
      line(`  API: ${info.api_url}`);
    });
    if (!key) process.exitCode = EXIT.auth;
  }));

auth
  .command("logout")
  .description("delete the saved key")
  .action(run(async () => {
    const removed = deleteConfig();
    emit({ ok: true, removed }, () => line(removed ? `✓ Removed ${configFile()}` : "Nothing saved."));
  }));

// whoami / accounts ────────────────────────────────────────────────────────────

program
  .command("whoami")
  .description("plan, key identity and permissions, remaining daily calls, connected accounts")
  .action(run(async () => {
    const res = await api.get("/me");
    emit(res, () => {
      const d = res.data ?? {};
      const k = d.key ?? {};
      line(`  Plan       ${d.plan ?? "?"}${res.test_mode ? "  (test key: writes are simulated)" : ""}`);
      line(`  Key        ${k.label || "(no label)"}  ${k.prefix ?? ""}_…${k.last4 ?? ""}  ${k.kind ?? ""}`);
      if (d.api) line(`  Calls      ${d.api.remaining_today}/${d.api.daily_limit} left today (resets ${d.api.reset_at})`);
      if (d.accounts) line(`  Accounts   ${d.accounts.connected}/${d.accounts.total} connected`);
      if (k.scopes) line(`  Permissions ${Object.entries(k.scopes as Record<string, string>).map(([s, m]) => `${s}=${m}`).join("  ")}`);
    });
  }));

program
  .command("accounts")
  .description("list connected Threads accounts (use the @handle or id with -a)")
  .action(run(async () => {
    const res = await api.get("/accounts");
    emit(res, () => table((res.data?.accounts ?? []).map((a: Account) => ({ ...a, followers: a.stats?.followers, posts: a.stats?.total_posts })),
      [["threads_username", "HANDLE"], ["id", "ID"], ["status", "STATUS"], ["followers", "FOLLOWERS"], ["posts", "POSTS"], ["display_name", "NAME"]]));
  }));

program
  .command("connect-link")
  .description("get a link that connects another Threads account (open it in a browser)")
  .action(run(async () => {
    const res = await api.post("/accounts/connect-link");
    emit(res, () => kv(res.data ?? {}));
  }));

// writing ──────────────────────────────────────────────────────────────────────

program
  .command("generate")
  .description("draft 1-5 posts in the account's voice (nothing is published)")
  .argument("<topic>", "what to write about")
  .addOption(accountOpt())
  .option("-n, --count <n>", "number of drafts (1-5)", int("--count", 1, 5), 1)
  .option("-f, --formula <id>", "content formula (see `mindthread formulas`)", "auto")
  .option("-q, --quality <level>", "fast | standard | premium")
  .option("--context <text>", "reference material (up to 8000 chars); @file reads a file")
  .action(run(async (topic: string, o: { account?: string; count: number; formula: string; quality?: string; context?: string }) => {
    const account_id = o.account || process.env.MINDTHREAD_ACCOUNT ? await resolveAccount(o.account) : undefined;
    const context = o.context?.startsWith("@") ? readFileSync(o.context.slice(1), "utf8") : o.context;
    const res = await api.post("/content/generate", { topic, account_id, count: o.count, formula: o.formula, quality: o.quality, context });
    emit(res, () => {
      const list = res.data?.contents ?? [];
      list.forEach((c: Record<string, any>, i: number) => {
        line(`── Draft ${i + 1}/${list.length} (${c.formula_used ?? o.formula}, ${c.char_count ?? String(c.text ?? "").length} chars) ──`);
        line(block(c.text));
        if (c.rule_violations?.length) line(`  ⚠ content rules: ${JSON.stringify(c.rule_violations)}`);
        line();
      });
    });
  }));

program
  .command("post")
  .description("publish a post now, at a time, or at the next best slot (text, image, carousel or video)")
  .argument("[text]", "post text, or '-' to read stdin")
  .addOption(accountOpt())
  .option("--now", "publish immediately")
  .option("--at <time>", "publish at an ISO 8601 time with offset, or relative like +2h")
  .option("--best-time", "let MindThread pick the next best slot (text only, up to 500 chars)")
  .option("--media <url>", "public https image URL; repeat or comma-separate for a carousel (2-10)", collect, [])
  .option("--video <url>", "public https MP4/MOV")
  .option("--topic-tag <tag>", "Threads topic tag (plain words, no #)")
  .option("--no-auto-thread", "do not split text over 500 chars into a thread")
  .option("--file <path>", "read the text from a file ('-' for stdin)")
  .option("--idempotency-key <key>", "retrying with the same key returns the first result instead of posting twice")
  .action(run(async (textArg: string | undefined, o: { account?: string; now?: boolean; at?: string; bestTime?: boolean; media: string[]; video?: string; topicTag?: string; autoThread: boolean; file?: string; idempotencyKey?: string }) => {
    const modes = [o.now, o.at, o.bestTime].filter(Boolean).length;
    if (modes !== 1) throw new UsageError("Choose exactly one of --now, --at <time> or --best-time");
    const hasMedia = o.media.length > 0 || Boolean(o.video);
    if (o.media.length && o.video) throw new UsageError("--media and --video cannot be combined");
    if (o.bestTime && hasMedia) throw new UsageError("--best-time schedules text only; use --at for posts with media");
    const text = textArg === undefined && !o.file && hasMedia ? "" : await readText(textArg, o.file, "post text");
    if (!text && !hasMedia) throw new UsageError("The post is empty");
    const account_id = await resolveAccount(o.account);
    const res = o.bestTime
      ? await api.post("/content/schedule", { account_id, text, auto_optimize_time: true, idempotency_key: o.idempotencyKey })
      : await api.post("/content/publish", {
          account_id, text: text || undefined,
          media_urls: o.media.length ? o.media : undefined, video_url: o.video,
          publish_now: o.now ? true : undefined, publish_at: o.at ? parseWhen(o.at) : undefined,
          auto_thread: o.autoThread === false ? false : undefined, topic_tag: o.topicTag, idempotency_key: o.idempotencyKey,
        });
    emit(res, () => {
      const d = res.data ?? {};
      const p = d.post ?? d;
      const when = p.publish_at ?? d.publish_at;
      line(p.status === "published" || o.now ? "✓ Published" : `✓ Scheduled${when ? ` for ${when}` : ""}`);
      kv(p, ["id", "kind", "status", "threads_post_id", "publish_at", "topic_tag"]);
      if (p.topic_tag_dropped || d.topic_tag_dropped) line("  ⚠ Threads refused the topic tag; posted without it");
      const v = p.rule_violations ?? d.rule_violations;
      if (v?.length) line(`  ⚠ content rules: ${JSON.stringify(v)}`);
      if (res.test_mode) line("  (test key: simulated, nothing was posted)");
    });
  }));

const thread = program.command("thread").description("multi-part threads (串文)");

thread
  .command("generate")
  .description("draft a 2-10 part thread")
  .argument("<topic>", "what to write about")
  .addOption(accountOpt())
  .option("-n, --parts <n>", "number of parts (2-10)", int("--parts", 2, 10), 3)
  .option("-f, --formula <id>", "content formula", "auto")
  .option("--context <text>", "reference material; @file reads a file")
  .action(run(async (topic: string, o: { account?: string; parts: number; formula: string; context?: string }) => {
    const account_id = o.account || process.env.MINDTHREAD_ACCOUNT ? await resolveAccount(o.account) : undefined;
    const context = o.context?.startsWith("@") ? readFileSync(o.context.slice(1), "utf8") : o.context;
    const res = await api.post("/content/generate-thread", { topic, thread_count: o.parts, account_id, formula: o.formula, context });
    emit(res, () => {
      const parts = res.data?.thread_parts ?? [];
      parts.forEach((p: Record<string, any>, i: number) => { if (i) line("---"); line(String(p.text ?? p)); });
      // the hint goes to stderr so `mindthread thread generate … > thread.txt` saves only the parts
      process.stderr.write(`${parts.length} parts. Edit if needed, then: mindthread thread publish --file <file>
`);
    });
  }));

thread
  .command("publish")
  .description("publish a thread now; parts as arguments, or a file/stdin with parts separated by --- lines")
  .argument("[parts...]", "2-10 texts")
  .addOption(accountOpt())
  .option("--file <path>", "read parts from a file ('-' for stdin)")
  .option("--idempotency-key <key>", "retry-safe key")
  .action(run(async (args: string[], o: { account?: string; file?: string; idempotencyKey?: string }) => {
    const parts = args.length ? args : splitParts(await readText(undefined, o.file, "thread parts"));
    if (parts.length < 2 || parts.length > 10) throw new UsageError(`A thread needs 2-10 parts (got ${parts.length})`);
    const account_id = await resolveAccount(o.account);
    const res = await api.post("/content/publish-thread", { account_id, thread_parts: parts, idempotency_key: o.idempotencyKey });
    emit(res, () => { line(`✓ Thread published (${parts.length} parts)`); kv(res.data ?? {}, ["post_id", "parts_published", "thread_post_ids"]); });
  }));

// schedules ────────────────────────────────────────────────────────────────────

const schedules = program.command("schedules").description("scheduled posts");

schedules
  .command("list", { isDefault: true })
  .description("list scheduled posts")
  .addOption(accountOpt())
  .option("--status <status>", "scheduled | publishing | published | failed | draft")
  .action(run(async (o: { account?: string; status?: string }) => {
    const account_id = o.account ? await resolveAccount(o.account) : undefined;
    const res = await api.get("/schedules", { account_id, status: o.status });
    emit(res, () => table((res.data?.schedules ?? []).map((s: Record<string, any>) => ({ ...s, when: s.publish_at ?? s.scheduled_at })),
      [["id", "ID"], ["status", "STATUS"], ["when", "PUBLISH AT"], ["text", "TEXT"]]));
  }));

schedules
  .command("cancel")
  .description("cancel a scheduled post (it moves to drafts)")
  .argument("<id>", "schedule id")
  .action(run(async (id: string) => {
    const res = await api.del(`/schedules/${seg(id)}`);
    emit(res, () => line(`✓ Cancelled ${id}`));
  }));

// queue (library) ──────────────────────────────────────────────────────────────

const queue = program.command("queue").description("the publishing queue (library): queued items publish at the account's schedule times");

queue
  .command("list", { isDefault: true })
  .description("list queued, draft, published, failed or archived items")
  .addOption(accountOpt())
  .option("--status <status>", "queued | draft | published | failed | archived", "queued")
  .option("--limit <n>", "max items (1-200)", int("--limit", 1, 200))
  .action(run(async (o: { account?: string; status: string; limit?: number }) => {
    const account_id = await resolveAccount(o.account);
    const res = await api.get("/library", { account_id, status: o.status, limit: o.limit });
    emit(res, () => {
      if (res.data?.schedule_times) line(`  Schedule times: ${res.data.schedule_times}`);
      table(res.data?.items ?? [], [["position", "#"], ["id", "ID"], ["next_publish_at", "NEXT PUBLISH"], ["text", "TEXT"]]);
    });
  }));

queue
  .command("add")
  .description("add up to 20 items; in a file or stdin, separate items with --- lines")
  .argument("[text]", "item text, or '-' to read items from stdin")
  .addOption(accountOpt())
  .option("--draft", "add as drafts that wait for approval instead of queueing")
  .option("--media <url>", "public https image URL for the item (repeatable)", collect, [])
  .option("--file <path>", "read items from a file ('-' for stdin)")
  .option("--idempotency-key <key>", "retry-safe key")
  .action(run(async (textArg: string | undefined, o: { account?: string; draft?: boolean; media: string[]; file?: string; idempotencyKey?: string }) => {
    const texts = textArg !== undefined && textArg !== "-" ? [textArg] : splitParts(await readText(textArg, o.file, "item text"));
    if (!texts.length || texts.length > 20) throw new UsageError(`Add 1-20 items at a time (got ${texts.length})`);
    if (o.media.length && texts.length > 1) throw new UsageError("--media applies to a single item");
    const account_id = await resolveAccount(o.account);
    const items = texts.map((text) => (o.media.length ? { text, media_urls: o.media } : { text }));
    const res = await api.post("/library", { account_id, status: o.draft ? "draft" : "queued", items, idempotency_key: o.idempotencyKey });
    emit(res, () => {
      line(`✓ Added ${res.data?.added ?? items.length} ${o.draft ? "draft(s)" : "item(s) to the queue"}`);
      for (const it of res.data?.items ?? []) if (it.rule_violations?.length) line(`  ⚠ ${it.id}: ${JSON.stringify(it.rule_violations)}`);
      if (res.data?.ids) line(`  ids: ${res.data.ids.join(", ")}`);
    });
  }));

function bulkOr(single: (id: string) => Promise<unknown>, action: "approve" | "archive" | "delete" | "queue", verb: string) {
  return run(async (ids: string[]) => {
    if (ids.length > 50) throw new UsageError("At most 50 ids per call");
    const res = ids.length === 1 ? await single(ids[0]) : await api.post("/library/bulk", { action, ids });
    emit(res, () => line(`✓ ${verb} ${ids.length} item(s)`));
  });
}

queue.command("approve").description("move drafts into the queue").argument("<ids...>", "item ids")
  .action(bulkOr((id) => api.post(`/library/${seg(id)}/approve`), "approve", "Queued"));
queue.command("archive").description("archive items (they never publish; restore with `queue edit --status`)").argument("<ids...>", "item ids")
  .action(bulkOr((id) => api.patch(`/library/${seg(id)}`, { status: "archived" }), "archive", "Archived"));
queue.command("rm").description("delete queued, draft or archived items").argument("<ids...>", "item ids")
  .action(bulkOr((id) => api.del(`/library/${seg(id)}`), "delete", "Deleted"));

queue
  .command("edit")
  .description("change an item's text, status or place in the queue")
  .argument("<id>", "item id")
  .argument("[text]", "new text")
  .option("--file <path>", "read the new text from a file")
  .option("--status <status>", "archived | draft | queued")
  .option("--first", "move to the front of the queue")
  .option("--last", "move to the end of the queue")
  .action(run(async (id: string, textArg: string | undefined, o: { file?: string; status?: string; first?: boolean; last?: boolean }) => {
    const text = textArg !== undefined || o.file ? await readText(textArg, o.file) : undefined;
    const body = { text, status: o.status, position: o.first ? "first" : o.last ? "last" : undefined };
    if (Object.values(body).every((v) => v === undefined)) throw new UsageError("Nothing to change: give new text, --status, --first or --last");
    const res = await api.patch(`/library/${seg(id)}`, body);
    emit(res, () => line(`✓ Updated ${id}`));
  }));

// insights ─────────────────────────────────────────────────────────────────────

program
  .command("insights")
  .description("views, likes, replies and followers for an account (-a all for every account)")
  .addOption(accountOpt())
  .option("-p, --period <period>", "7d, 14d, 30d …", "7d")
  .action(run(async (o: { account?: string; period: string }) => {
    const account_id = await resolveAccount(o.account, true);
    const res = await api.get("/analytics/insights", { account_id, period: o.period });
    emit(res, () => {
      const d = res.data ?? {};
      kv(d, ["account_id", "scope", "period", "total_posts", "avg_engagement_rate", "best_formula"]);
      if (d.breakdown) { line("  breakdown"); kv(d.breakdown); }
      line(`  (total_views ${d.total_views ?? "?"} and total_interactions ${d.total_interactions ?? "?"} are lifetime totals, not for ${d.period})`);
      for (const s of d.optimization_suggestions ?? []) line(`  • ${s}`);
    });
  }));

// cloud patrol ─────────────────────────────────────────────────────────────────

const patrol = program.command("patrol").description("cloud patrol: keyword search on Threads and reply drafts you review");

patrol.command("status").description("patrol settings and today's numbers").addOption(accountOpt())
  .action(run(async (o: { account?: string }) => {
    const res = await api.get("/patrol/cloud", { account_id: await resolveAccount(o.account) });
    emit(res, () => kv(res.data ?? {}));
  }));

patrol
  .command("set")
  .description("change patrol keywords, cap, persona, mode or review (turning it on may need the owner)")
  .addOption(accountOpt())
  .option("--keywords <list>", "1-10 comma-separated keywords; \"#tag\" searches a topic tag", csv)
  .option("--persona <text>", "reply persona")
  .option("--daily-cap <n>", "max replies (or discovered posts) a day", int("--daily-cap", 1, 10000))
  .option("--mode <mode>", "reply (draft and send replies) | discover (only list matching posts)")
  .option("--enable", "turn patrol on")
  .option("--disable", "turn patrol off")
  .option("--review", "hold every drafted reply for approval")
  .option("--no-review", "send replies without review")
  .action(run(async (o: { account?: string; keywords?: string[]; persona?: string; dailyCap?: number; mode?: string; enable?: boolean; disable?: boolean; review?: boolean }) => {
    if (o.enable && o.disable) throw new UsageError("--enable and --disable cannot be combined");
    const body = {
      account_id: await resolveAccount(o.account), keywords: o.keywords, persona: o.persona, daily_cap: o.dailyCap, mode: o.mode,
      enabled: o.enable ? true : o.disable ? false : undefined, review_before_reply: o.review,
    };
    const res = await api.put("/patrol/cloud", body);
    emit(res, () => { line("✓ Patrol updated"); kv(res.data ?? {}); });
  }));

patrol.command("keywords").description("AI keyword suggestions for patrol (one AI generation; once per account per 24 h; suggests only)").addOption(accountOpt())
  .action(run(async (o: { account?: string }) => {
    const res = await api.get("/patrol/cloud/keyword-suggestions", { account_id: await resolveAccount(o.account) });
    emit(res, () => kv(res.data ?? {}));
  }));

patrol
  .command("pending")
  .description("drafted replies (and discovered posts) waiting for review")
  .addOption(accountOpt())
  .option("--status <status>", "pending | sent | rejected | expired", "pending")
  .option("--limit <n>", "1-100", int("--limit", 1, 100))
  .option("--cursor <cursor>", "next_cursor from the previous page")
  .action(run(async (o: { account?: string; status: string; limit?: number; cursor?: string }) => {
    const res = await api.get("/patrol/cloud/pending", { account_id: await resolveAccount(o.account), status: o.status, limit: o.limit, cursor: o.cursor });
    emit(res, () => {
      const items = res.data?.items ?? [];
      if (!items.length) line(`  No ${o.status} items.`);
      for (const it of items) {
        const post = it.post ?? it.target ?? {};
        line(`── ${it.id}  ${it.type ?? ""}${it.expires_at ? `  expires ${it.expires_at}` : ""}`);
        if (post.text || it.post_text) line(`  post:  ${clip(post.text ?? it.post_text, 140)}`);
        if (post.permalink || it.permalink) line(`  link:  ${post.permalink ?? it.permalink}`);
        if (it.draft ?? it.reply) line(`  reply: ${clip(it.draft ?? it.reply, 280)}`);
      }
      if (res.data?.has_more) line(`  More: --cursor ${res.data.next_cursor}`);
      if (items.length && o.status === "pending") line("  Send: mindthread patrol approve <id> [--reply \"edited\"]   Drop: mindthread patrol reject <id>");
    });
  }));

patrol.command("approve").description("send a drafted reply now (optionally edited)").argument("<id>", "pending id").option("--reply <text>", "edited reply text")
  .action(run(async (id: string, o: { reply?: string }) => {
    const res = await api.post(`/patrol/cloud/pending/${seg(id)}/approve`, { reply: o.reply });
    emit(res, () => line(`✓ Sent ${id}${res.data?.edited ? " (edited)" : ""}`));
  }));

patrol.command("reject").description("reject a drafted reply; the post is not proposed again").argument("<id>", "pending id").option("--reason <text>", "note")
  .action(run(async (id: string, o: { reason?: string }) => {
    const res = await api.post(`/patrol/cloud/pending/${seg(id)}/reject`, { reason: o.reason });
    emit(res, () => line(`✓ Rejected ${id}`));
  }));

patrol.command("log").description("replies sent by patrol (last 1-7 days)").addOption(accountOpt()).option("--days <n>", "1-7", int("--days", 1, 7))
  .action(run(async (o: { account?: string; days?: number }) => {
    const res = await api.get("/patrol/cloud/log", { account_id: await resolveAccount(o.account), days: o.days });
    emit(res, () => { const d = res.data ?? {}; const rows = d.replies ?? d.items ?? d.log; if (Array.isArray(rows)) table(rows, [["sent_at", "SENT"], ["reply", "REPLY"], ["post_text", "POST"]]); else kv(d); });
  }));

patrol.command("stats").description("views and likes earned by patrol replies (1-14 days)").addOption(accountOpt()).option("--days <n>", "1-14", int("--days", 1, 14))
  .action(run(async (o: { account?: string; days?: number }) => {
    const res = await api.get("/patrol/cloud/stats", { account_id: await resolveAccount(o.account), days: o.days });
    emit(res, () => kv(res.data ?? {}));
  }));

// events / webhooks ────────────────────────────────────────────────────────────

program
  .command("events")
  .description("event feed (post.published, post.failed, reply.sent, patrol.pending, approval.decided …), last 7 days")
  .option("--since <time>", "ISO 8601; only newer events")
  .option("--types <list>", "comma-separated event names")
  .option("--limit <n>", "1-200", int("--limit", 1, 200))
  .option("--follow", "keep polling and print new events (Ctrl-C to stop; each poll is one API call)")
  .option("--interval <seconds>", "poll interval with --follow (min 10)", int("--interval", 10, 3600), 60)
  .action(run(async (o: { since?: string; types?: string; limit?: number; follow?: boolean; interval: number }) => {
    const show = (evs: Array<Record<string, any>>) => {
      for (const ev of evs) {
        if (state.json) process.stdout.write(JSON.stringify(ev) + "\n");
        else line(`${ev.created_at ?? ev.at ?? ""}  ${ev.type ?? ev.event ?? ""}  ${clip(JSON.stringify(ev.data ?? ev.payload ?? {}), 120)}`);
      }
    };
    let since = o.since;
    if (!o.follow) {
      const res = await api.get("/events", { since, types: o.types, limit: o.limit });
      emit(res, () => { show(res.data?.events ?? []); if (!(res.data?.events ?? []).length) line("  No events."); });
      return;
    }
    for (;;) {
      let wait = o.interval;
      try {
        const res = await api.get("/events", { since, types: o.types, limit: o.limit });
        const evs = (res.data?.events ?? []) as Array<Record<string, any>>;
        show([...evs].reverse());
        if (res.data?.latest_at) since = res.data.latest_at;
      } catch (e) {
        // keep following through rate limits and network blips; anything else (bad key, bad args) stops
        if (!(e instanceof ApiError) || !["rate_limit_exceeded", "timeout", "network_error"].includes(e.code)) throw e;
        wait = Math.max(o.interval, Number(e.detail.retry_after_seconds) || 0);
        process.stderr.write(`${e.code}: retrying in ${wait} s
`);
      }
      await new Promise((r) => setTimeout(r, wait * 1000));
    }
  }));

const webhooks = program.command("webhooks").description("HTTPS webhooks for post and patrol events");
webhooks.command("list", { isDefault: true }).description("list webhooks")
  .action(run(async () => {
    const res = await api.get("/webhooks");
    emit(res, () => table((res.data?.webhooks ?? []).map((w: Record<string, any>) => ({ ...w, events: (w.events ?? []).join(",") })), [["id", "ID"], ["url", "URL"], ["events", "EVENTS"], ["active", "ACTIVE"]]));
  }));
webhooks.command("add").description("register a webhook").argument("<url>", "https endpoint")
  .requiredOption("-e, --events <list>", "comma-separated events, e.g. post.published,post.failed", csv)
  .option("-s, --secret <secret>", "HMAC-SHA256 signing secret")
  .action(run(async (url: string, o: { events: string[]; secret?: string }) => {
    const res = await api.post("/webhooks", { url, events: o.events, secret: o.secret });
    emit(res, () => { line("✓ Webhook created"); kv(res.data ?? {}, ["id", "url", "events"]); });
  }));
webhooks.command("rm").description("delete a webhook").argument("<id>", "webhook id")
  .action(run(async (id: string) => {
    const res = await api.del(`/webhooks/${seg(id)}`);
    emit(res, () => line(`✓ Deleted ${id}`));
  }));

// experiments ──────────────────────────────────────────────────────────────────

const experiments = program.command("experiments").description("A/B tests across content formulas (variants publish immediately)");
experiments.command("list", { isDefault: true }).description("list experiments")
  .action(run(async () => {
    const res = await api.get("/experiments");
    emit(res, () => table(res.data?.experiments ?? [], [["id", "ID"], ["status", "STATUS"], ["topic", "TOPIC"], ["winner", "WINNER"]]));
  }));
experiments.command("create").description("publish one variant per formula and measure the winner").argument("<topic>", "topic")
  .addOption(accountOpt()).option("--formulas <list>", "comma-separated formula ids (2-5)", csv)
  .action(run(async (topic: string, o: { account?: string; formulas?: string[] }) => {
    const res = await api.post("/experiments", { topic, account_id: await resolveAccount(o.account), formulas: o.formulas });
    emit(res, () => { line("✓ Experiment started"); kv(res.data ?? {}, ["id", "experiment_id", "status", "measure_at"]); });
  }));
experiments.command("get").description("one experiment with variants and the winner").argument("<id>", "experiment id")
  .action(run(async (id: string) => { const res = await api.get(`/experiments/${seg(id)}`); emit(res, () => kv(res.data ?? {})); }));
experiments.command("cancel").description("stop measuring (published variants stay on Threads)").argument("<id>", "experiment id")
  .action(run(async (id: string) => { const res = await api.post(`/experiments/${seg(id)}/cancel`); emit(res, () => line(`✓ Cancelled ${id}`)); }));

// settings ─────────────────────────────────────────────────────────────────────

const settings = program.command("settings").description("account persona, schedule times, review and content rules");
settings.command("get", { isDefault: true }).description("read an account's settings and guardrails").addOption(accountOpt())
  .action(run(async (o: { account?: string }) => {
    const res = await api.get(`/accounts/${seg(await resolveAccount(o.account))}/settings`);
    emit(res, () => kv(res.data ?? {}));
  }));
settings
  .command("set")
  .description("change settings (send only what changes; loosening a guardrail may need the owner)")
  .addOption(accountOpt())
  .option("--persona <text>", "brand persona (up to 4000 chars); @file reads a file")
  .option("--schedule-times <times>", "comma-separated HH:MM, up to 8, e.g. 09:00,12:30,21:00")
  .option("--review-before-publish <bool>", "AI drafts wait for approval", bool("--review-before-publish"))
  .option("--auto-reply <bool>", "AI replies to comments on own posts", bool("--auto-reply"))
  .option("--auto-thread <bool>", "split text over 500 chars into a thread", bool("--auto-thread"))
  .option("--enabled <bool>", "master automation switch for the account", bool("--enabled"))
  .option("--content-rules <json>", "full content_rules object as JSON, @file or - (replaces the current rules; null clears)")
  .option("--if-match <etag>", "guardrails etag from `settings get`; refuses if someone changed it meanwhile")
  .option("--reason <text>", "why (stored with the change)")
  .option("--dry-run", "preview: shows whether it would apply, ask the owner or be denied; writes nothing")
  .action(run(async (o: { account?: string; persona?: string; scheduleTimes?: string; reviewBeforePublish?: boolean; autoReply?: boolean; autoThread?: boolean; enabled?: boolean; contentRules?: string; ifMatch?: string; reason?: string; dryRun?: boolean }) => {
    const body: Record<string, unknown> = {
      persona: o.persona?.startsWith("@") ? readFileSync(o.persona.slice(1), "utf8") : o.persona,
      schedule_times: o.scheduleTimes, review_before_publish: o.reviewBeforePublish, auto_reply_enabled: o.autoReply,
      auto_thread: o.autoThread, enabled: o.enabled,
      content_rules: o.contentRules === undefined ? undefined : await readJson(o.contentRules, "--content-rules"),
      if_match: o.ifMatch, reason: o.reason, dry_run: o.dryRun || undefined,
    };
    const changes = ["persona", "schedule_times", "review_before_publish", "auto_reply_enabled", "auto_thread", "enabled", "content_rules"];
    if (changes.every((k) => body[k] === undefined)) throw new UsageError("Nothing to change; see `mindthread settings set --help`");
    const res = await api.patch(`/accounts/${seg(await resolveAccount(o.account))}/settings`, body);
    emit(res, () => { line(o.dryRun ? "Dry run (nothing written):" : "✓ Settings updated"); kv(res.data ?? {}); });
  }));

// key usage, approvals, formulas ───────────────────────────────────────────────

program
  .command("usage")
  .description("this key's own usage and recent calls")
  .option("--days <n>", "1-30", int("--days", 1, 30))
  .action(run(async (o: { days?: number }) => {
    const res = await api.get("/keys/current/usage", { days: o.days });
    emit(res, () => { const d = res.data ?? {}; kv(d.summary ?? d); if (Array.isArray(d.recent)) table(d.recent.slice(0, 20), [["at", "AT"], ["route", "ROUTE"], ["status", "STATUS"], ["units", "UNITS"]]); });
  }));

program
  .command("approval")
  .description("check a request that is waiting for the owner (or remind them)")
  .argument("<id>", "approval id (apr_…)")
  .option("--remind", "ask MindThread to remind the owner again")
  .action(run(async (id: string, o: { remind?: boolean }) => {
    const res = o.remind ? await api.post(`/approvals/${seg(id)}/remind`) : await api.get(`/approvals/${seg(id)}`);
    emit(res, () => { if (o.remind) line("✓ Reminder sent"); kv(res.data?.approval ?? res.data ?? {}, o.remind ? undefined : ["id", "status", "decision", "scope", "human_url", "expires_at", "decided_at", "result"]); });
  }));

program
  .command("formulas")
  .description("content formulas for generate (no key needed)")
  .action(run(async () => {
    const res = await request("GET", "/formulas", { auth: "optional" });
    emit(res, () => table(res.data?.formulas ?? [], [["id", "ID"], ["description", "DESCRIPTION"]]));
  }));

// raw API ──────────────────────────────────────────────────────────────────────

program
  .command("api")
  .description("call any endpoint of https://mindthread.tw/api/v1 and print the JSON (like `gh api`)")
  .argument("<method>", "GET | POST | PUT | PATCH | DELETE")
  .argument("<path>", "path such as /me or /accounts/{id}/material")
  .option("-d, --data <json>", "JSON body, @file or - for stdin")
  .option("-q, --query <key=value>", "query parameter (repeatable)", (v: string, prev: string[] = []) => prev.concat(v), [])
  .option("--no-auth", "do not send the API key")
  .action(run(async (method: string, path: string, o: { data?: string; query: string[]; auth: boolean }) => {
    const m = method.toUpperCase() as Method;
    if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(m)) throw new UsageError(`Unknown method ${method}`);
    const p = "/" + path.replace(/^https?:\/\/[^/]+/, "").replace(/^\/?(api\/v1)?\/?/, "");
    const query = Object.fromEntries(o.query.map((kvp) => { const i = kvp.indexOf("="); if (i < 1) throw new UsageError(`--query needs key=value (got ${kvp})`); return [kvp.slice(0, i), kvp.slice(i + 1)]; }));
    const body = o.data === undefined ? undefined : await readJson(o.data, "--data");
    printJson(await request(m, p, { query, body, auth: o.auth ? true : false }));
  }));

// ── main ─────────────────────────────────────────────────────────────────────

try {
  await program.parseAsync(process.argv);
} catch (e) {
  if (e instanceof CommanderError) {
    process.exitCode = ["commander.helpDisplayed", "commander.version", "commander.help"].includes(e.code) ? EXIT.ok : EXIT.usage;
  } else if (e instanceof ApiError || e instanceof UsageError) process.exitCode = renderError(e);
  else throw e;
}
