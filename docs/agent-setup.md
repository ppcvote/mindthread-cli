# Connecting MindThread to an agent

Three ways in, all on the same API key and the same permission rules:

| Path | Best for | What it needs |
|------|----------|---------------|
| Hosted MCP `https://mindthread.tw/api/mcp` | Claude Code, Claude Desktop, Cursor, VS Code, any MCP client | A key in a header, or OAuth sign-in (no key) |
| `mindthread-mcp` (stdio bridge, `npx -y mindthread-mcp`) | Clients that only run local MCP servers | Node.js 18.17+, `MINDTHREAD_API_KEY` |
| `mindthread-cli` (`npx mindthread-cli`) plus the skill | Agents that work through a shell: OpenClaw, Claude Code with Bash, Codex, scripts | Node.js 18.17+, `MINDTHREAD_API_KEY` |

The MCP tools are defined on the server, so a new API feature shows up without updating either npm package. The CLI wraps the REST API; anything it has no command for is one `mindthread api <METHOD> <path>` away.

Start with a **test key** (`mt_test_…`): reads return your real data, writes are simulated and nothing reaches Threads. Two reads are exceptions: `get_top_posts` (`GET /accounts/{id}/top-posts`) returns three sample posts marked `data_source: mock`, and brand documents (`get_brand_doc`, `save_brand_doc`) live in a sandbox copy that live keys never read, so a test key does not see documents saved with a live key. Create keys at mindthread.tw → Settings → API keys.

## Claude Code

Pick one.

```bash
# Hosted MCP with a key
claude mcp add --transport http mindthread https://mindthread.tw/api/mcp --header "Authorization: Bearer $MINDTHREAD_API_KEY"

# Hosted MCP, signing in with your MindThread account instead of a key (then run /mcp in Claude Code to log in)
claude mcp add --transport http mindthread https://mindthread.tw/api/mcp

# Local stdio bridge
claude mcp add mindthread --env MINDTHREAD_API_KEY=mt_test_your_key -- npx -y mindthread-mcp
```

Prefer the shell? Install the CLI and give Claude Code the skill, which tells it to use `--json`, read exit codes and show approval links instead of retrying:

```bash
npm install -g mindthread-cli
mkdir -p ~/.claude/skills/mindthread
curl -fsSL https://raw.githubusercontent.com/ppcvote/mindthread-cli/master/skills/mindthread/SKILL.md -o ~/.claude/skills/mindthread/SKILL.md
```

Then allow the command once in `.claude/settings.json` so Claude does not ask for every call:

```json
{ "permissions": { "allow": ["Bash(mindthread:*)"] } }
```

Keep `MINDTHREAD_API_KEY` in your shell or run `mindthread auth login` (hidden prompt, saved with owner-only permissions). Do not paste the key into the chat.

## Cursor

`~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` (one project). Ready-made file: [examples/cursor-mcp.json](../examples/cursor-mcp.json).

```json
{
  "mcpServers": {
    "mindthread": {
      "url": "https://mindthread.tw/api/mcp",
      "headers": { "Authorization": "Bearer mt_test_your_key" }
    }
  }
}
```

Stdio instead: [examples/cursor-mcp-stdio.json](../examples/cursor-mcp-stdio.json). A project file is often committed; if it is, keep the key out of it and use the stdio form with the key in your environment.

## OpenClaw

OpenClaw agents call the CLI through the `mindthread` skill (published on ClawHub as `mindthread`).

```bash
npm install -g mindthread-cli                                    # the skill needs the `mindthread` command on PATH
npx clawhub@latest install mindthread --workdir ~/.openclaw/workspace   # lands in ~/.openclaw/workspace/skills/mindthread
```

The skill declares `MINDTHREAD_API_KEY` (required) and `MINDTHREAD_ACCOUNT` (optional default account). Put them in the environment OpenClaw starts with; [examples/openclaw.env.example](../examples/openclaw.env.example) lists both. To use the copy from this repo instead of ClawHub, copy `skills/mindthread/SKILL.md` to `~/.openclaw/workspace/skills/mindthread/SKILL.md`.

## Check that it works

Ask the agent "list my MindThread accounts". Over MCP it calls `list_accounts`; with the CLI it runs `mindthread accounts --json`. Then try a safe write with a test key: "draft a post about our launch and schedule it for tomorrow 9am"; the response carries `test_mode: true` and nothing is posted.

## Recipe D: pull your best posts first, then draft (read only)

Needs the `read` permission only (MCP tools `list_accounts` and `get_top_posts`, API 1.22.0). Create a live key in Settings → API keys, click "Edit permissions and name", open "Advanced: set each permission", set "Read data" to Allow and the other nine permissions to "Don't allow". Do not use an `mt_test_` key here: `get_top_posts` then returns three sandbox demo posts (`data_source: mock`). Paste the two prompts below into the same conversation, one after the other. The Traditional Chinese original is 範本 D in the [README](../README.md#research-plan-and-schedule-in-claude).

```text
Use MindThread to make me a "content document":
1. Use list_accounts to list my accounts. The one I want is @your_account.
2. Use get_top_posts to fetch this account's 20 best posts by engagement (metric engagement, limit 20).
3. Read all 20 and write a document with four sections:
- Core ideas: 3 to 5 claims that keep coming back and get strong engagement, each with 1 original post as an example
- Voice: sentence length, how posts open, common words, person, and which styles get especially good engagement
- Worldview: why readers identify with this account and follow it
- Data scope: how many posts, the posting period, and which day MindThread fetched the metrics
4. Do not invent numbers or experiences that are not in the posts. Do not save anything yet; just show me.

(after reading the document, in the same conversation)
Based on the content document above, draft 3 new Threads posts:
- Each one uses a different core idea and follows the voice in the document
- Each under 500 characters, with a first line that makes people stop
- Do not reuse sentences from old posts, and do not invent numbers or experiences; mark any place that needs a number with [TBD]
- After each post, add one line saying which part of the document you used
Just show me. Do not post, schedule or save.
```

Common mistakes:

- **Zero posts back**: the same Threads account was connected twice, and `list_accounts` shows an older entry with no metrics yet. Pick the newer one by `connected_at`.
- **Another member's account**: 404 `account_not_found` or 403 `forbidden`, because Threads only exposes your own metrics.
- **Newest posts missing**: a background job reads each account in rotation every 30 minutes; posts it has not reached yet are left out. Check `metrics_fetched_at`.
- **One viral off-topic post skews the document**: ask Claude to flag posts unrelated to the account's topics and not use them as core ideas.
- **403 `insufficient_scope`**: "Read data" is not set to Allow on this key.

## Common errors

Every error is `{ "error": { "code", "message", "request_id", … } }`. The CLI turns the code into an exit code and one line on stderr; MCP returns the same object in the tool result's `structuredContent`.

| HTTP / code | CLI exit | What it means | What the agent should do |
|-------------|----------|---------------|--------------------------|
| 401 `unauthorized` | 4 | Key missing, wrong or revoked | Stop and ask the human for a key; never guess one |
| 401 `key_disabled` | 4 | The key was disabled (by itself or in Settings) | Stop; the human creates a new key. Do not try another key |
| 401 `session_required` | 1 | A web-app-only route (`GET /keys`, `GET /usage`, `POST /views`) | Use the key routes instead: `GET /me`, `GET /keys/current/usage` |
| 403 `approval_required` | 3 | This permission is set to "ask" | Give the human `approval.human_url`, do not resend; poll `mindthread approval <id>` / `get_approval`. The server runs the stored request once they confirm |
| 403 `insufficient_scope` | 1 | This permission is set to "deny" | Tell the human; `error.fix` names the setting |
| 400 `missing_schedule` | 1 | No time intent on a scheduling call | Send `publish_at` (ISO 8601 with offset) or `publish_now: true`; some routes also take `auto_optimize_time`. `error.expected_one_of` lists what that route accepts |
| 409 `account_unavailable` | 1 | MindThread is not publishing through that account right now: it is blocked, or its Threads connection broke and must be reconnected (the message says which) | Tell the human; the owner reconnects it in the web app. Do not retry |
| 422 content rules | 1 | The text breaks the account's content rules (`enforce: block`) | Read `rule_violations`, rewrite, send again |
| 429 `rate_limit_exceeded`, `window: daily` | 5 | The key's daily calls are used up | Stop until `reset_at` (00:00 Asia/Taipei); every call counts, polls included. Poll no faster than `suggested_poll_interval_seconds`, or use a webhook |
| 429 `rate_limit_exceeded`, `window: minute` | 5 | 120 calls a minute per key | Wait `retry_after_seconds` (same as `Retry-After`) |
| `test_mode_unsupported` | 1 | That endpoint has no sandbox yet | Use a live key for it, or skip it |

Bridge-only messages from `mindthread-mcp`: "MINDTHREAD_API_KEY is not set" (add it to the server's `env` and restart the client) and `held_locally: true` after a daily 429 (the bridge answers by itself until the reset so a loop cannot keep spending calls).

## Newer fields agents should read (API 1.17.0 to 1.21.0)

- **`warnings[]`** (1.17.0) on publish, schedule and library: `off_hours` and `stale_time_reference`. Never blocks; show them to the human.
- **`changed_since_last_viewed`** (1.18.0) in the same `warnings[]`: the content changed since the owner (on the web) or this key (`GET /library`, `GET /schedules`) last saw it. `detail` has `removed[]`, `added[]`, `media_changed`, `time_changed`. Show the difference before releasing. Reading through a live key records a view; `mt_test_` keys do not. Writing content is not viewing it.
- **Views are recorded by MindThread itself.** `POST /views` exists for the web app only (API keys get 401 `session_required`); an agent never needs to call it.
- **Daily 429 body** (2026-11-02): `limit`, `used`, `reset_at`, `retry_after_seconds` and `suggested_poll_interval_seconds` (free plan, 50 calls a day: 1800). `mindthread events --follow` already polls at that pace.
- **`permalink`**: cloud patrol items (`GET /patrol/cloud/pending`, with `post_author` and `posted_at`) and executed approvals (`result.permalink`) carry the post's Threads URL as Threads returned it. Use it as is; do not build URLs from media ids.
- **Batch approve** (1.19.0): `POST /patrol/cloud/pending/approve` (CLI `patrol approve --all`), within the account's daily cap; flagged drafts (`needs_individual`) stay for one-by-one approval.
- **Reply library** (1.20.0: `POST /patrol/cloud/library/import`, `GET /patrol/cloud/library/export`, `reply_mode` through `PUT /patrol/cloud`) and **random posting times** (1.21.0: `random_schedule`, `random_per_day`, `random_window`, `random_exclude` through `PATCH /accounts/{id}/settings`): no dedicated CLI command yet, use `mindthread api` (example in the README).

The full contract is [mindthread.tw/api/v1/openapi.json](https://mindthread.tw/api/v1/openapi.json) and the agent guide is [mindthread.tw/llms.txt](https://mindthread.tw/llms.txt).
