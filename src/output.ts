/**
 * Output: --json prints the API envelope untouched (stdout, one document), otherwise short human text.
 * Errors: one actionable line on stderr (or the error envelope on stdout with --json) and a stable exit code.
 */
import { ApiError, KEY_PAGE, apiUrl, resolveKey } from "./client.js";

export const EXIT = { ok: 0, error: 1, usage: 2, approval: 3, auth: 4, rateLimit: 5 } as const;

export const state = { json: false };

export function printJson(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

export const line = (s = "") => process.stdout.write(s + "\n");

/** Shorten free text for one-line listings */
export function clip(s: unknown, n = 80): string {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

/** Indent a multi-line text block */
export const block = (s: unknown, pad = "  ") => String(s ?? "").split("\n").map((l) => pad + l).join("\n");

/** Fixed-width table without dependencies; columns are picked by the caller */
export function table(rows: Array<Record<string, unknown>>, cols: Array<[key: string, title: string]>): void {
  if (!rows.length) { line("  (none)"); return; }
  const cells = rows.map((r) => cols.map(([k]) => clip(r[k] ?? "", 60)));
  const widths = cols.map(([, t], i) => Math.max(t.length, ...cells.map((c) => [...c[i]].length)));
  const fmt = (vals: string[]) => "  " + vals.map((v, i) => v + " ".repeat(Math.max(0, widths[i] - [...v].length))).join("  ").trimEnd();
  line(fmt(cols.map(([, t]) => t)));
  for (const c of cells) line(fmt(c));
}

/** Print a flat key: value summary of an object (nested objects as compact JSON) */
export function kv(obj: Record<string, unknown>, keys?: string[]): void {
  const entries = (keys ?? Object.keys(obj)).filter((k) => obj[k] !== undefined && obj[k] !== null && obj[k] !== "");
  const w = Math.max(0, ...entries.map((k) => k.length));
  for (const k of entries) {
    const v = obj[k];
    line(`  ${k.padEnd(w)}  ${typeof v === "object" ? JSON.stringify(v) : String(v)}`);
  }
}

/**
 * Warnings (API 1.17.0): reminders that never block, e.g. off_hours (the time is outside the account's usual posting hours)
 * and stale_time_reference (the text says "yesterday" or "last week" and publishes on a later day). One line each.
 * changed_since_last_viewed (API 1.18.0): the content changed since it was last viewed; the removed (-) and added (+)
 * sentences follow the warning line, up to DIFF_LINES each.
 */
const DIFF_LINES = 5;
export function printWarnings(list: unknown, prefix = ""): void {
  if (!Array.isArray(list)) return;
  for (const w of list) {
    if (!w || typeof w !== "object") continue;
    const { code, message, detail } = w as { code?: unknown; message?: unknown; detail?: unknown };
    if (typeof message === "string" && message) line(`  ⚠ ${prefix}${typeof code === "string" ? `${code}: ` : ""}${message}`);
    if (code === "changed_since_last_viewed" && detail && typeof detail === "object") printDiff(detail as Record<string, unknown>);
  }
}

function printDiff(d: Record<string, unknown>): void {
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const removed = list(d.removed);
  const added = list(d.added);
  for (const s of removed.slice(0, DIFF_LINES)) line(`      - ${clip(s, 120)}`);
  if (Number(d.removed_count) > Math.min(removed.length, DIFF_LINES)) line(`      - … ${Number(d.removed_count) - Math.min(removed.length, DIFF_LINES)} more removed`);
  for (const s of added.slice(0, DIFF_LINES)) line(`      + ${clip(s, 120)}`);
  if (Number(d.added_count) > Math.min(added.length, DIFF_LINES)) line(`      + … ${Number(d.added_count) - Math.min(added.length, DIFF_LINES)} more added`);
  if (d.media_changed === true) line("      ~ media changed");
  if (d.time_changed === true) line(`      ~ publish time: ${String(d.previous_scheduled_at ?? "unset")} → ${String(d.scheduled_at ?? "unset")}`);
}

/** Output a successful response: the envelope with --json, otherwise whatever `human` prints */
export function emit(res: unknown, human: () => void): void {
  if (state.json) printJson(res);
  else human();
}

export class UsageError extends Error {}

/** Map any failure to stderr text (or JSON on stdout) and return the exit code */
export function renderError(e: unknown): number {
  if (e instanceof UsageError) {
    if (state.json) printJson({ error: { code: "usage_error", message: e.message } });
    else process.stderr.write(`Error: ${e.message}\n`);
    return EXIT.usage;
  }
  if (!(e instanceof ApiError)) {
    const msg = e instanceof Error ? e.message : String(e);
    if (state.json) printJson({ error: { code: "cli_error", message: msg } });
    else process.stderr.write(`Error: ${msg}\n`);
    return EXIT.error;
  }

  const d = e.detail;
  const rid = typeof d.request_id === "string" ? ` (request_id ${d.request_id})` : "";
  const src = resolveKey().source === "config" ? "the key saved by `mindthread auth login`" : "MINDTHREAD_API_KEY";
  let msg: string;
  let code: number = EXIT.error;

  switch (e.code) {
    case "missing_key":
      msg = `No API key. Set MINDTHREAD_API_KEY or run \`mindthread auth login\`.\nCreate a key at ${KEY_PAGE}. A test key (mt_test_…) is a free sandbox: reads are real, writes are simulated.`;
      code = EXIT.auth;
      break;
    case "unauthorized":
      msg = `MindThread rejected ${src}: ${e.message}. Check the key or create a new one at ${KEY_PAGE}.`;
      code = EXIT.auth;
      break;
    case "key_disabled":
      msg = `This API key was disabled${d.disabled_at ? ` at ${d.disabled_at}` : ""}. Keys cannot be re-enabled: create a new one at ${KEY_PAGE}.`;
      code = EXIT.auth;
      break;
    case "session_required":
      msg = "Only the signed-in owner can do this, in the MindThread web app. An API key cannot.";
      break;
    case "insufficient_scope": {
      const fix = typeof d.fix === "string" ? d.fix : d.fix ? JSON.stringify(d.fix) : "";
      const req = Array.isArray(d.required) ? d.required.join(", ") : d.required;
      msg = `Permission denied for this key${req ? ` (needs ${req})` : ""}: ${e.message}${fix ? `\nFix: ${fix}` : ""}`;
      break;
    }
    case "approval_required": {
      const a = (d.approval ?? {}) as Record<string, unknown>;
      const id = (a.id ?? d.approval_id) as string | undefined;
      msg = [
        "Waiting for the account owner to confirm. Nothing has run yet; do not resend.",
        a.human_message ? `Message for the owner: ${a.human_message}` : "",
        a.human_url ? `Confirm here: ${a.human_url}` : "",
        id ? `Check later: mindthread approval ${id}` : "",
      ].filter(Boolean).join("\n");
      code = EXIT.approval;
      break;
    }
    case "rate_limit_exceeded": {
      const used = d.limit !== undefined ? ` ${d.used ?? "?"}/${d.limit}` : "";
      msg = `Rate limit reached (${d.window ?? "limit"}${used}). Retry after ${d.retry_after_seconds ?? "a few"} s${d.reset_at ? `; the daily pool resets at ${d.reset_at}` : ""}.`;
      code = EXIT.rateLimit;
      break;
    }
    case "content_rules_violated": {
      const v = d.violations ?? d.rule_violations;
      msg = `Blocked by this account's content rules: ${e.message}${v ? `\nViolations: ${JSON.stringify(v)}` : ""}`;
      break;
    }
    case "timeout":
      msg = `${e.message} Nothing was changed; retry in ${d.retry_after_seconds ?? 30} s.`;
      break;
    case "network_error":
      msg = `${e.message}${process.env.MINDTHREAD_API_URL ? " (MINDTHREAD_API_URL is set)" : ""}`;
      break;
    default:
      msg = `${e.message} [${e.code}${e.status ? `, HTTP ${e.status}` : ""}]`;
  }

  if (state.json) {
    printJson(e.body && typeof e.body === "object" && "error" in (e.body as object) ? e.body : { error: { code: e.code, message: e.message, api_url: apiUrl() } });
  } else process.stderr.write(`Error: ${msg}${rid}\n`);
  return code;
}
