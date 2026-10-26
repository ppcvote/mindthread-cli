/**
 * MindThread REST client: key/config resolution and one request() for every command.
 * Spec: https://mindthread.tw/api/v1/openapi.json
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";

export const VERSION = (createRequire(import.meta.url)("../package.json") as { version: string }).version;
export const DEFAULT_API_URL = "https://mindthread.tw/api/v1";
export const KEY_PAGE = "https://mindthread.tw/settings (Settings → API keys)";

export interface Config { apiKey?: string; apiUrl?: string }

export const configDir = () => process.env.MINDTHREAD_CONFIG_DIR || join(homedir(), ".mindthread");
export const configFile = () => join(configDir(), "config.json");

export function readConfig(): Config {
  try { return existsSync(configFile()) ? (JSON.parse(readFileSync(configFile(), "utf8")) as Config) : {}; } catch { return {}; }
}

/** The config file holds a secret: owner-only permissions where the OS supports them */
export function writeConfig(patch: Config): void {
  mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  writeFileSync(configFile(), JSON.stringify({ ...readConfig(), ...patch }, null, 2) + "\n", { mode: 0o600 });
  try { chmodSync(configFile(), 0o600); } catch { /* Windows: ACLs, not modes */ }
}

export function deleteConfig(): boolean {
  if (!existsSync(configFile())) return false;
  rmSync(configFile());
  return true;
}

/** MINDTHREAD_API_KEY wins over the saved key, so agents and CI never depend on a file */
export function resolveKey(): { key?: string; source: "env" | "config" | "none" } {
  const env = (process.env.MINDTHREAD_API_KEY || "").trim();
  if (env) return { key: env, source: "env" };
  const saved = (readConfig().apiKey || "").trim();
  return saved ? { key: saved, source: "config" } : { source: "none" };
}

export const apiUrl = () => (process.env.MINDTHREAD_API_URL || readConfig().apiUrl || DEFAULT_API_URL).trim().replace(/\/+$/, "");

export const mask = (key: string) => (key.length > 12 ? `${key.slice(0, 8)}…${key.slice(-4)}` : "…");

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string, readonly body: unknown = null) {
    super(message);
  }
  /** The `error` object of the response envelope, or {} */
  get detail(): Record<string, unknown> {
    const e = (this.body as { error?: unknown } | null)?.error;
    return e && typeof e === "object" ? (e as Record<string, unknown>) : {};
  }
}

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type Query = Record<string, string | number | boolean | undefined | null>;
export interface Envelope { ok?: boolean; data?: any; request_id?: string; [k: string]: any }

export function qs(query?: Query): string {
  if (!query) return "";
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** auth: true (default) needs a key; "optional" sends one when configured (public endpoints); false never sends it */
export async function request(method: Method, path: string, opts: { query?: Query; body?: unknown; auth?: boolean | "optional" } = {}): Promise<Envelope> {
  const auth = opts.auth ?? true;
  const { key } = resolveKey();
  if (auth === true && !key) throw new ApiError("No API key", 0, "missing_key");
  const url = apiUrl() + path + qs(opts.query);
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": `mindthread-cli/${VERSION} (+https://github.com/ppcvote/mindthread-cli)`,
  };
  if (key && auth !== false) headers.Authorization = `Bearer ${key}`;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const timeoutMs = Number(process.env.MINDTHREAD_TIMEOUT_MS) || 310_000;
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body), signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    const reason = e instanceof Error ? (e.name === "TimeoutError" ? `no answer within ${Math.round(timeoutMs / 1000)} s` : (e as Error & { cause?: Error }).cause?.message || e.message) : String(e);
    throw new ApiError(`Cannot reach ${apiUrl()}: ${reason}`, 0, "network_error");
  }
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text.slice(0, 500) }; }
  if (!res.ok) {
    const err = body && typeof body.error === "object" ? body.error : {};
    const code = typeof err.code === "string" ? err.code : typeof body?.error === "string" ? body.error : `http_${res.status}`;
    const message = typeof err.message === "string" ? err.message : `HTTP ${res.status}`;
    throw new ApiError(message, res.status, code, body && typeof body.error === "object" ? body : { error: { code, message, http_status: res.status } });
  }
  return (body ?? { ok: true }) as Envelope;
}

export const api = {
  get: (path: string, query?: Query) => request("GET", path, { query }),
  post: (path: string, body?: unknown) => request("POST", path, { body: body ?? {} }),
  put: (path: string, body?: unknown) => request("PUT", path, { body: body ?? {} }),
  patch: (path: string, body?: unknown) => request("PATCH", path, { body: body ?? {} }),
  del: (path: string) => request("DELETE", path),
};

/** Path segments from user input (ids) are encoded so they cannot change the route */
export const seg = (s: string) => encodeURIComponent(String(s).trim());
