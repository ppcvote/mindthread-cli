# mindthread-cli: the Threads scheduler built for AI agents

Write, schedule and publish Threads posts, work a publishing queue, review drafted replies and read insights from the shell. Every command has `--json` output and stable exit codes, so Claude Code, Codex, OpenClaw or your own scripts can drive it. Posts go out through Meta's official Threads API.

```bash
npx mindthread-cli post "Shipping day. Here is what changed this week." --account @yourbrand --at +2h
```

[繁體中文說明在下方](#繁體中文)

## Three-minute start

**1. Get an API key.** Sign up at [mindthread.tw](https://mindthread.tw), connect your Threads account, then open **Settings → API keys** and create a key.
A **test key** (`mt_test_…`) is the safe way to try everything: reads show your real data, writes are simulated and nothing reaches Threads. Use a live key (`mt_live_…`) to post for real.
Every plan includes API access (October 2026: free plan 50 calls a day per live key; test keys share a 500-a-day sandbox). Current limits: [mindthread.tw/developers](https://mindthread.tw/developers).

**2. Install and set the key.**

```bash
npm install -g mindthread-cli        # or run any command with: npx mindthread-cli <command>
export MINDTHREAD_API_KEY=mt_test_your_key   # PowerShell: $env:MINDTHREAD_API_KEY="mt_test_your_key"
mindthread whoami                    # plan, permissions, calls left today
```

Prefer not to keep it in your shell? `mindthread auth login` asks for the key at a hidden prompt and saves it to `~/.mindthread/config.json` (owner-only permissions). `MINDTHREAD_API_KEY` always wins over the saved key.

**3. Schedule your first post.**

```bash
mindthread accounts                                   # find your @handle
mindthread post "Hello from my terminal" --account @yourbrand --at 2026-11-01T09:00:00+08:00
mindthread schedules --account @yourbrand             # check it is there
```

With one connected account you can drop `--account`; with several, set `MINDTHREAD_ACCOUNT=@yourbrand` once.

## For agents

- Add `--json` (or set `MINDTHREAD_JSON=1`) to get the API response unchanged: `{ "ok": true, "request_id", "data": … }`, or `{ "error": { "code", "message", "request_id", … } }` on failure, always on stdout.
- Exit codes:

  | Code | Meaning |
  |------|---------|
  | 0 | ok |
  | 1 | API error (read `error.code`) |
  | 2 | usage error, nothing was sent |
  | 3 | waiting for the account owner to confirm (`approval_required`): give the human the link, do not resend |
  | 4 | missing or rejected API key |
  | 5 | rate limited (`retry_after_seconds` in the error) |

- Retries: pass `--idempotency-key <id>` to `post`, `thread publish` and `queue add`; a retry with the same key returns the first result instead of posting twice.
- The CLI never reads stdin unless you pass `-` (or `--file -`), so it cannot hang waiting for input.
- An [OpenClaw / ClawHub skill](skills/mindthread/SKILL.md) that teaches an agent this workflow ships with the package.
- Prefer MCP? The same API is an MCP server: see [mindthread-mcp](https://github.com/ppcvote/mindthread-mcp), or run `claude mcp add --transport http mindthread https://mindthread.tw/api/mcp --header "Authorization: Bearer $MINDTHREAD_API_KEY"`.

## Commands

| Command | What it does |
|---------|--------------|
| `whoami` | Plan, key permissions, calls left today, connected accounts |
| `accounts` | Connected Threads accounts (`@handle` and id for `-a`) |
| `connect-link` | A link that connects another Threads account |
| `generate <topic> [-n 1-5] [-f formula]` | Drafts in the account's voice; publishes nothing |
| `post [text] --now \| --at <time> \| --best-time` | Publish now, at an ISO time with offset (or `+30m`, `+2h`, `+1d`), or at the next best slot. `--media <url>` (repeat for a carousel), `--video <url>`, `--topic-tag`, `--file` |
| `thread generate <topic> [-n 2-10]` / `thread publish [parts...]` | Multi-part threads; a file can hold parts separated by `---` lines |
| `schedules [list] [-a]` / `schedules cancel <id>` | Scheduled posts |
| `queue list\|add\|approve\|archive\|rm\|edit` | The publishing queue: queued items publish at the account's own schedule times; drafts wait for approval |
| `insights [-a @handle\|all] [-p 7d]` | Posts, engagement, followers |
| `patrol status\|set\|pending\|approve\|reject\|log\|stats\|keywords` | Cloud patrol: keyword search on Threads with reply drafts you review; `keywords` asks AI for keyword ideas |
| `events [--since] [--types] [--follow]` | Event feed for agents without a webhook endpoint |
| `webhooks list\|add\|rm` | HTTPS webhooks (`post.published`, `post.failed`, `reply.sent`, …) |
| `experiments list\|create\|get\|cancel` | A/B tests across content formulas |
| `settings get\|set` | Persona, schedule times, review before publish, content rules (`--dry-run` previews) |
| `usage` | This key's own usage and recent calls |
| `approval <id> [--remind]` | A request waiting for the owner |
| `formulas` | Content formulas (no key needed) |
| `api <METHOD> <path> [-d json] [-q k=v]` | Any endpoint of the [REST API](https://mindthread.tw/api/v1/openapi.json), like `gh api` |

`mindthread <command> --help` shows every option.

### Examples

```bash
# Draft three posts, then queue the one you like for the account's next slot
mindthread generate "why small shops should post daily" -a @yourbrand -n 3
mindthread queue add "the draft you picked" -a @yourbrand

# A carousel at a fixed time
mindthread post "Before and after" -a @yourbrand --at 2026-11-01T20:00:00+08:00 \
  --media https://example.com/before.jpg --media https://example.com/after.jpg

# Many posts from one file (separate them with lines containing ---), held as drafts
mindthread queue add - -a @yourbrand --draft < posts.txt

# Review replies that cloud patrol drafted
mindthread patrol pending -a @yourbrand
mindthread patrol approve <id> --reply "Thanks, that is exactly why we built it."

# Watch what happens
mindthread events --follow --types post.published,post.failed --json
```

## Safety

- **Permissions per key**: each permission is `allow`, `ask` or `deny` (Settings → API keys). With `ask`, the command exits with code 3 and prints a confirmation link for the account owner; the server runs the request once they confirm.
- **Content rules in code**: length limits, banned phrases, no hashtags, only numbers from your fact list. With `enforce: block` the server refuses a post that breaks them.
- **Keys stay local**: the key is read from `MINDTHREAD_API_KEY` or the config file and only sent to `mindthread.tw`. Output shows at most `mt_live_…abcd`.
- **Official API only**: MindThread never asks for your Threads password.

## Configuration

| Variable | Meaning |
|----------|---------|
| `MINDTHREAD_API_KEY` | API key; overrides the saved key |
| `MINDTHREAD_ACCOUNT` | Default account (`@handle` or id) |
| `MINDTHREAD_JSON` | `1` = always print JSON |
| `MINDTHREAD_API_URL` | API base URL (default `https://mindthread.tw/api/v1`) |
| `MINDTHREAD_TIMEOUT_MS` | Request timeout (default 310000) |
| `MINDTHREAD_CONFIG_DIR` | Where `auth login` saves the key (default `~/.mindthread`) |

Requires Node.js 18.17 or newer.

## 繁體中文

`mindthread` 是給 AI agent 用的 Threads 排程器指令列工具：寫文、排程、發文（文字、單圖、輪播、影片）、管理發文佇列、審核雲端海巡的回覆草稿、看成效。每個指令都有 `--json` 輸出與固定的結束碼，Claude Code、Codex、OpenClaw 或你自己的腳本都能直接呼叫。全程走 Meta 官方 Threads API。

三分鐘上手：

1. 到 [mindthread.tw](https://mindthread.tw) 註冊、連接 Threads 帳號，在「設定 → API 金鑰」建立金鑰。建議先用測試金鑰（`mt_test_` 開頭）：讀取是真資料，寫入只模擬、不會發到 Threads。
2. 安裝並設定金鑰：
   ```bash
   npm install -g mindthread-cli
   export MINDTHREAD_API_KEY=mt_test_你的金鑰
   mindthread whoami
   ```
3. 排第一篇：
   ```bash
   mindthread accounts
   mindthread post "從終端機發的第一篇" --account @你的帳號 --at 2026-11-01T09:00:00+08:00
   mindthread schedules --account @你的帳號
   ```

時間要帶時區（台灣是 `+08:00`），也可以寫 `+2h` 表示兩小時後。金鑰的每項權限可以設成「允許」「先問我」「拒絕」；設成「先問我」時，指令會以結束碼 3 結束並印出確認連結，帳號擁有者在 mindthread.tw 按下確認後才會執行。

## License

MIT © Ultra Lab
