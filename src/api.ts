/**
 * MindThread API Client
 * Thin wrapper over the Agent-Ready REST API.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const CONFIG_DIR = join(homedir(), ".mindthread");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

interface Config {
  apiKey: string;
  apiUrl: string;
}

export function loadConfig(): Config {
  const defaults: Config = {
    apiKey: process.env.MINDTHREAD_API_KEY || "",
    apiUrl: process.env.MINDTHREAD_API_URL || "https://mindthread.tw/api/v1",
  };

  if (existsSync(CONFIG_FILE)) {
    try {
      const saved = JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
      return {
        apiKey: saved.apiKey || defaults.apiKey,
        apiUrl: saved.apiUrl || defaults.apiUrl,
      };
    } catch {
      return defaults;
    }
  }

  return defaults;
}

export function saveConfig(config: Partial<Config>): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  const current = loadConfig();
  const merged = { ...current, ...config };
  writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2));
}

export async function api(
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: Record<string, unknown>
): Promise<unknown> {
  const config = loadConfig();

  if (!config.apiKey) {
    throw new Error(
      "Not authenticated. Run: mt auth login <API_KEY>\n" +
      "Get your key at https://mindthread.tw/settings"
    );
  }

  const url = `${config.apiUrl}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json();

  if (!res.ok) {
    const errMsg =
      typeof data?.error === "string"
        ? data.error
        : data?.error?.message || `HTTP ${res.status}`;
    throw new Error(errMsg);
  }

  return data;
}
