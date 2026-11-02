// Polling that fits the daily quota (2026-11-02). Every call to the MindThread API counts against the key's daily
// quota, including GET /events polls that return nothing. Free keys get 50 calls a day, so polling every 60 s used
// the whole day in under an hour and then hit 429 until midnight Asia/Taipei. The tiers below match the server's
// suggestedPollSeconds (one polled endpoint per key).

export const POLL_INTERVAL_TIERS: ReadonlyArray<readonly [number, number]> = [[100, 1800], [200, 900], [500, 300], [1000, 120]];

/** Seconds between polls that keep one polled endpoint under the daily limit; unknown limit = the free plan's 1800 */
export function suggestedPollSeconds(dailyLimit: number | null | undefined): number {
  if (!dailyLimit || !Number.isFinite(dailyLimit) || dailyLimit <= 0) return 1800;
  for (const [max, sec] of POLL_INTERVAL_TIERS) if (dailyLimit <= max) return sec;
  return 60;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-11-03 00:00 Asia/Taipei" (the server resets the daily quota at Taipei midnight) */
export function taipeiTime(ms: number): string {
  const d = new Date(ms + 8 * 3600_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} Asia/Taipei`;
}

export function humanDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m`;
  return `${s}s`;
}

export interface PauseDecision { seconds: number; daily: boolean; message: string }

/**
 * After a 429: how long to stop and the one line to print. A daily 429 waits until reset_at (plus a few seconds so the
 * first call lands after the reset), never less than retry_after_seconds; other windows wait retry_after_seconds.
 * Polls made before then would only get 429 again and still count as calls in the server logs.
 */
export function rateLimitPause(detail: Record<string, unknown>, nowMs = Date.now()): PauseDecision {
  const retry = Math.max(1, Number(detail.retry_after_seconds) || 60);
  const resetMs = typeof detail.reset_at === "string" ? Date.parse(detail.reset_at) : NaN;
  if (detail.window === "daily") {
    const untilReset = Number.isFinite(resetMs) ? Math.ceil((resetMs - nowMs) / 1000) : retry;
    const seconds = Math.max(retry, untilReset) + 5;
    const used = detail.limit !== undefined ? ` (${detail.used ?? detail.limit}/${detail.limit} calls today)` : "";
    const until = Number.isFinite(resetMs) ? taipeiTime(resetMs) : `in ${humanDuration(seconds)}`;
    const poll = humanDuration(Number(detail.suggested_poll_interval_seconds) || suggestedPollSeconds(Number(detail.limit)));
    return {
      seconds,
      daily: true,
      message: `Daily API limit reached${used}. Pausing until ${until} (in ${humanDuration(seconds)}), when the quota resets; `
        + `every call before then would fail. Each poll uses 1 call: poll every ${poll} or slower, or use webhooks. Ctrl-C to stop.`,
    };
  }
  return { seconds: retry, daily: false, message: `Rate limited (${String(detail.window ?? "limit")}); retrying in ${humanDuration(retry)}.` };
}
