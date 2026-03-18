#!/usr/bin/env node
/**
 * MindThread CLI
 *
 * Usage:
 *   mt auth login <API_KEY>     — Save API key
 *   mt accounts                 — List connected Threads accounts
 *   mt post <topic>             — Generate and publish immediately
 *   mt generate <topic>         — Generate content (preview, don't publish)
 *   mt schedule <topic>         — Generate and schedule
 *   mt analytics                — View engagement insights
 *   mt formulas                 — List available formulas
 */

import { Command } from "commander";
import { api, saveConfig, loadConfig } from "./api.js";

const program = new Command();

program
  .name("mt")
  .description("MindThread CLI — AI-powered Threads automation")
  .version("0.1.0");

// ── auth ──────────────────────────────────────────────────────────────────────

const auth = program.command("auth").description("Authentication");

auth
  .command("login <apiKey>")
  .description("Save your MindThread API key")
  .action((apiKey: string) => {
    saveConfig({ apiKey });
    console.log("✓ API key saved to ~/.mindthread/config.json");
  });

auth
  .command("status")
  .description("Check authentication status")
  .action(() => {
    const config = loadConfig();
    if (config.apiKey) {
      const masked = config.apiKey.slice(0, 10) + "..." + config.apiKey.slice(-4);
      console.log(`✓ Authenticated (${masked})`);
      console.log(`  API: ${config.apiUrl}`);
    } else {
      console.log("✗ Not authenticated. Run: mt auth login <API_KEY>");
    }
  });

// ── accounts ──────────────────────────────────────────────────────────────────

program
  .command("accounts")
  .description("List connected Threads accounts")
  .action(async () => {
    try {
      const data = (await api("GET", "/accounts")) as {
        accounts: Array<{
          id: string;
          username: string;
          displayName: string;
          followersCount: number;
          statsViews: number;
          statsPostCount: number;
        }>;
      };

      if (!data.accounts.length) {
        console.log("No accounts connected. Add one at https://mindthread.tw/dashboard");
        return;
      }

      console.log(`\n  ${data.accounts.length} account(s):\n`);
      for (const a of data.accounts) {
        console.log(`  @${a.username} (${a.displayName})`);
        console.log(`    ID: ${a.id}`);
        console.log(`    Followers: ${a.followersCount} | Views: ${a.statsViews} | Posts: ${a.statsPostCount}`);
        console.log();
      }
    } catch (e: unknown) {
      console.error(`Error: ${(e as Error).message}`);
      process.exit(1);
    }
  });

// ── generate ──────────────────────────────────────────────────────────────────

program
  .command("generate <topic>")
  .description("Generate AI content (preview, don't publish)")
  .option("-f, --formula <formula>", "Content formula", "auto")
  .option("-n, --count <n>", "Number of variations", "1")
  .action(async (topic: string, opts: { formula: string; count: string }) => {
    try {
      const data = (await api("POST", "/content/generate", {
        topic,
        formula: opts.formula,
        count: parseInt(opts.count),
      })) as { texts: Array<{ text: string; formula: string; charCount: number }> };

      console.log();
      for (const [i, t] of data.texts.entries()) {
        if (data.texts.length > 1) {
          console.log(`  ── Variation ${i + 1} (${t.formula}, ${t.charCount} chars) ──\n`);
        } else {
          console.log(`  Formula: ${t.formula} | ${t.charCount} chars\n`);
        }
        console.log(`  ${t.text.split("\n").join("\n  ")}`);
        console.log();
      }
    } catch (e: unknown) {
      console.error(`Error: ${(e as Error).message}`);
      process.exit(1);
    }
  });

// ── post ──────────────────────────────────────────────────────────────────────

program
  .command("post <topic>")
  .description("Generate and publish immediately")
  .option("-a, --account <id>", "Account ID (required if multiple accounts)")
  .option("-f, --formula <formula>", "Content formula", "auto")
  .action(async (topic: string, opts: { account?: string; formula: string }) => {
    try {
      const accountId = await resolveAccountId(opts.account);

      const data = (await api("POST", "/content/generate-and-schedule", {
        topic,
        account_id: accountId,
        formula: opts.formula,
        publish_now: true,
      })) as { text: string; formula: string; postId: string; status: string };

      console.log(`\n  ✓ Published!\n`);
      console.log(`  Post ID: ${data.postId}`);
      console.log(`  Formula: ${data.formula}`);
      console.log(`  Status:  ${data.status}\n`);
      console.log(`  ${data.text.split("\n").join("\n  ")}`);
      console.log();
    } catch (e: unknown) {
      console.error(`Error: ${(e as Error).message}`);
      process.exit(1);
    }
  });

// ── schedule ──────────────────────────────────────────────────────────────────

program
  .command("schedule <topic>")
  .description("Generate and schedule a post")
  .option("-a, --account <id>", "Account ID")
  .option("-f, --formula <formula>", "Content formula", "auto")
  .option("--at <datetime>", "ISO 8601 datetime (e.g. 2026-04-01T09:00:00+08:00)")
  .option("--auto-time", "Let MindThread pick the best time")
  .action(
    async (
      topic: string,
      opts: { account?: string; formula: string; at?: string; autoTime?: boolean }
    ) => {
      try {
        const accountId = await resolveAccountId(opts.account);

        const body: Record<string, unknown> = {
          topic,
          account_id: accountId,
          formula: opts.formula,
        };
        if (opts.at) {
          body.schedule_at = opts.at;
        } else {
          body.auto_optimize_time = true;
        }

        const data = (await api("POST", "/content/generate-and-schedule", body)) as {
          text: string;
          formula: string;
          postId: string;
          status: string;
          scheduledAt?: string;
        };

        console.log(`\n  ✓ Scheduled!\n`);
        console.log(`  Post ID: ${data.postId}`);
        console.log(`  Formula: ${data.formula}`);
        if (data.scheduledAt) console.log(`  Time:    ${data.scheduledAt}`);
        console.log(`  Status:  ${data.status}\n`);
        console.log(`  ${data.text.split("\n").join("\n  ")}`);
        console.log();
      } catch (e: unknown) {
        console.error(`Error: ${(e as Error).message}`);
        process.exit(1);
      }
    }
  );

// ── analytics ─────────────────────────────────────────────────────────────────

program
  .command("analytics")
  .description("View engagement analytics")
  .option("-a, --account <id>", "Account ID")
  .option("-p, --period <period>", "Period: 7d, 14d, 30d", "7d")
  .action(async (opts: { account?: string; period: string }) => {
    try {
      const accountId = await resolveAccountId(opts.account);

      const data = (await api(
        "GET",
        `/analytics/insights?account_id=${accountId}&period=${opts.period}`
      )) as {
        period: string;
        totalPosts: number;
        totalViews: number;
        totalLikes: number;
        totalReplies: number;
        avgViews: number;
        bestFormulas: Array<{ formula: string; avgViews: number }>;
        bestTimeSlots: Array<{ hour: number; avgViews: number }>;
        suggestions: string[];
      };

      console.log(`\n  Analytics (${data.period}):\n`);
      console.log(`  Posts: ${data.totalPosts} | Views: ${data.totalViews} | Likes: ${data.totalLikes} | Replies: ${data.totalReplies}`);
      console.log(`  Avg views/post: ${data.avgViews}`);

      if (data.bestFormulas.length) {
        console.log(`\n  Best formulas:`);
        for (const f of data.bestFormulas) {
          console.log(`    ${f.formula}: ${f.avgViews} avg views`);
        }
      }

      if (data.bestTimeSlots.length) {
        console.log(`\n  Best time slots:`);
        for (const t of data.bestTimeSlots) {
          console.log(`    ${t.hour}:00 — ${t.avgViews} avg views`);
        }
      }

      if (data.suggestions.length) {
        console.log(`\n  Suggestions:`);
        for (const s of data.suggestions) {
          console.log(`    - ${s}`);
        }
      }
      console.log();
    } catch (e: unknown) {
      console.error(`Error: ${(e as Error).message}`);
      process.exit(1);
    }
  });

// ── formulas ──────────────────────────────────────────────────────────────────

program
  .command("formulas")
  .description("List available content formulas")
  .action(async () => {
    try {
      const data = (await api("GET", "/formulas")) as {
        formulas: Array<{ id: string; name: string; description: string; example: string }>;
      };

      console.log();
      for (const f of data.formulas) {
        console.log(`  ${f.name} (${f.id})`);
        console.log(`    ${f.description}`);
        console.log(`    Example: ${f.example}`);
        console.log();
      }
    } catch (e: unknown) {
      console.error(`Error: ${(e as Error).message}`);
      process.exit(1);
    }
  });

// ── thread ────────────────────────────────────────────────────────────────────

const thread = program.command("thread").description("Thread (串文) operations");

thread
  .command("generate <topic>")
  .description("Generate a multi-part thread")
  .option("-n, --parts <n>", "Number of thread parts (2-10)", "3")
  .option("-f, --formula <formula>", "Content formula", "auto")
  .option("-a, --account <id>", "Account ID for brand voice")
  .action(async (topic: string, opts: { parts: string; formula: string; account?: string }) => {
    try {
      const body: Record<string, unknown> = {
        topic,
        thread_count: parseInt(opts.parts),
        formula: opts.formula,
      };
      if (opts.account) body.account_id = opts.account;

      const data = (await api("POST", "/content/generate-thread", body)) as {
        ok: boolean;
        data: {
          thread_parts: Array<{ index: number; text: string; char_count: number }>;
          formula_used: string;
          total_parts: number;
        };
      };

      console.log(`\n  Thread: ${data.data.total_parts} parts (${data.data.formula_used})\n`);
      for (const p of data.data.thread_parts) {
        console.log(`  ── Part ${p.index}/${data.data.total_parts} (${p.char_count} chars) ──\n`);
        console.log(`  ${p.text.split("\n").join("\n  ")}`);
        console.log();
      }
    } catch (e: unknown) {
      console.error(`Error: ${(e as Error).message}`);
      process.exit(1);
    }
  });

thread
  .command("publish")
  .description("Publish thread parts (pipe from 'thread generate' or provide inline)")
  .requiredOption("-a, --account <id>", "Account ID")
  .argument("<parts...>", "Thread parts as separate arguments (wrap each in quotes)")
  .action(async (parts: string[], opts: { account: string }) => {
    try {
      if (parts.length < 2) {
        console.error("Error: At least 2 thread parts required");
        process.exit(1);
      }

      const data = (await api("POST", "/content/publish-thread", {
        account_id: opts.account,
        thread_parts: parts,
      })) as {
        ok: boolean;
        data: { post_id: string; thread_post_ids: string[]; parts_published: number };
      };

      console.log(`\n  ✓ Thread published! ${data.data.parts_published} parts\n`);
      console.log(`  Post ID: ${data.data.post_id}`);
      for (const [i, id] of data.data.thread_post_ids.entries()) {
        console.log(`  Part ${i + 1}: ${id}`);
      }
      console.log();
    } catch (e: unknown) {
      console.error(`Error: ${(e as Error).message}`);
      process.exit(1);
    }
  });

// ── webhook ───────────────────────────────────────────────────────────────────

const webhook = program.command("webhook").description("Webhook management");

webhook
  .command("add <url>")
  .description("Register a webhook endpoint")
  .option(
    "-e, --events <events>",
    "Comma-separated events (post.published,post.failed,reply.sent,token.expiring,usage.threshold)",
    "post.published,post.failed"
  )
  .option("-s, --secret <secret>", "HMAC-SHA256 signing secret")
  .action(async (url: string, opts: { events: string; secret?: string }) => {
    try {
      const events = opts.events.split(",").map((e) => e.trim());
      const body: Record<string, unknown> = { url, events };
      if (opts.secret) body.secret = opts.secret;

      const data = (await api("POST", "/webhooks", body)) as {
        ok: boolean;
        data: { id: string; url: string; events: string[] };
      };

      console.log(`\n  ✓ Webhook created\n`);
      console.log(`  ID:     ${data.data.id}`);
      console.log(`  URL:    ${data.data.url}`);
      console.log(`  Events: ${data.data.events.join(", ")}`);
      console.log();
    } catch (e: unknown) {
      console.error(`Error: ${(e as Error).message}`);
      process.exit(1);
    }
  });

webhook
  .command("list")
  .description("List registered webhooks")
  .action(async () => {
    try {
      const data = (await api("GET", "/webhooks")) as {
        ok: boolean;
        data: {
          webhooks: Array<{
            id: string;
            url: string;
            events: string[];
            active: boolean;
            fail_count: number;
          }>;
        };
      };

      if (!data.data.webhooks.length) {
        console.log("\n  No webhooks registered.\n");
        return;
      }

      console.log(`\n  ${data.data.webhooks.length} webhook(s):\n`);
      for (const w of data.data.webhooks) {
        console.log(`  ${w.active ? "✓" : "✗"} ${w.url}`);
        console.log(`    ID: ${w.id}`);
        console.log(`    Events: ${w.events.join(", ")}`);
        if (w.fail_count > 0) console.log(`    Failures: ${w.fail_count}`);
        console.log();
      }
    } catch (e: unknown) {
      console.error(`Error: ${(e as Error).message}`);
      process.exit(1);
    }
  });

webhook
  .command("rm <id>")
  .description("Delete a webhook")
  .action(async (id: string) => {
    try {
      await api("DELETE", `/webhooks/${id}`);
      console.log(`\n  ✓ Webhook ${id} deleted.\n`);
    } catch (e: unknown) {
      console.error(`Error: ${(e as Error).message}`);
      process.exit(1);
    }
  });

// ── Helper: resolve account ID ────────────────────────────────────────────────

async function resolveAccountId(explicit?: string): Promise<string> {
  if (explicit) return explicit;

  // If only one account, use it automatically
  const data = (await api("GET", "/accounts")) as {
    accounts: Array<{ id: string; username: string }>;
  };

  if (data.accounts.length === 0) {
    throw new Error("No accounts connected. Add one at https://mindthread.tw/dashboard");
  }

  if (data.accounts.length === 1) {
    return data.accounts[0].id;
  }

  // Multiple accounts — must specify
  const list = data.accounts.map((a) => `  ${a.id}  @${a.username}`).join("\n");
  throw new Error(
    `Multiple accounts found. Specify one with -a <id>:\n\n${list}`
  );
}

// ── Run ───────────────────────────────────────────────────────────────────────

program.parse();
