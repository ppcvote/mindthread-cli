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
  | 5 | rate limited (`retry_after_seconds` in the error; a daily limit resets at 00:00 Asia/Taipei, so stop until `reset_at`; every call counts, polls included) |

- Retries: pass `--idempotency-key <id>` to `post`, `thread publish` and `queue add`; a retry with the same key returns the first result instead of posting twice.
- The CLI never reads stdin unless you pass `-` (or `--file -`), so it cannot hang waiting for input.
- An [OpenClaw / ClawHub skill](skills/mindthread/SKILL.md) that teaches an agent this workflow ships with the package.
- Prefer MCP? The same API is an MCP server: see [mindthread-mcp](https://github.com/ppcvote/mindthread-mcp), or run `claude mcp add --transport http mindthread https://mindthread.tw/api/mcp --header "Authorization: Bearer $MINDTHREAD_API_KEY"`.
- Read `warnings[]` on writes and lists: `off_hours`, `stale_time_reference` and `changed_since_last_viewed` (the content changed since the owner or this key last saw it; the CLI prints the removed and added sentences). Show them to the human before releasing.
- Links to posts come from Threads (`permalink` on patrol items and executed approvals); never build a post URL from a media id.

## Connect it to your agent

| Client | Setup |
|--------|-------|
| Claude Code | `claude mcp add --transport http mindthread https://mindthread.tw/api/mcp --header "Authorization: Bearer $MINDTHREAD_API_KEY"`, or the CLI plus the skill in `~/.claude/skills/mindthread/` |
| Cursor | `~/.cursor/mcp.json`: [examples/cursor-mcp.json](examples/cursor-mcp.json) (hosted) or [examples/cursor-mcp-stdio.json](examples/cursor-mcp-stdio.json) |
| OpenClaw | `npm install -g mindthread-cli`, then `npx clawhub@latest install mindthread --workdir ~/.openclaw/workspace`, and set `MINDTHREAD_API_KEY` |
| Claude Desktop | [examples/claude-desktop-config.json](examples/claude-desktop-config.json) |

Step-by-step setup, a first test, and a table of common errors with what the agent should do: **[docs/agent-setup.md](docs/agent-setup.md)**.

## Research, plan and schedule in Claude

With MindThread API 1.22.0 the MCP server (hosted, or this package's stdio bridge `mindthread-mcp`) adds three tools: `get_top_posts` ranks the best posts of an account you connected (the Threads API only returns insights for the authorized user's own posts, so other people's accounts cannot be read), and `save_brand_doc` / `get_brand_doc` keep brand, content and content-map documents on MindThread (up to 50,000 characters each, last 20 versions kept). Paste one of the prompts below into Claude or ChatGPT after connecting MindThread. The tools are defined on the server, so no package update is needed.

在 Claude 裡直接研究、規劃、排程你的 Threads：把 MindThread MCP 接上 Claude 或 ChatGPT 之後，get_top_posts 會從你自己連結的帳號抓出互動最好的貼文（Threads 官方 API 只開放讀授權者本人的成效，讀不到別人的帳號），save_brand_doc 和 get_brand_doc 幫你把品牌文件、內容文件、內容地圖存在 MindThread（保留最近 20 版），generate_posts 照你的人設起草，schedule_text 或 add_library 排進發文時段。整理、規劃、起草、排程，都在同一段對話裡完成；每一步要不要存、要不要排，由你決定。

### 範本 A：整理我的最佳貼文

```text
請用 MindThread 幫我整理最佳貼文：
1. 先用 list_accounts 列出我的帳號，問我要整理哪一個。
2. 用 get_top_posts 抓這個帳號表現最好的 20 則貼文（metric 用 engagement；我說只看最近，就加 days: 90）。
3. 讀完這些貼文，整理成「內容文件」：
・核心觀點：反覆出現、互動又最好的 3 到 5 個主張，每個附 1 則原文當例子
・表達風格：句子長短、開頭方式、常用詞、語氣，哪些寫法互動特別好
・價值觀：讀者會因為什麼認同我、留下來
・資料範圍：寫明這份整理根據幾則貼文、成效是 MindThread 抓到的數字
4. 先給我看草稿，我說可以之後，用 save_brand_doc 存成 doc_id「content」，language 用 zh-TW。
不要編造貼文裡沒有的數字或經歷。
```

### 範本 B：品牌訪談

```text
請當我的品牌策略夥伴，用訪談的方式幫我寫品牌文件。一次只問一題，等我回答再問下一題；我答得太短，就追問一次。
1. 你幫助的是誰？他們現在卡在哪裡？
2. 你的故事：你是怎麼走到今天的？
3. 影響你最深的人或作品是什麼？
4. 你的內容支柱有哪些？你的獨特視角是什麼？
5. 你相信什麼？
6. 你反對什麼？
7. 為什麼是現在？
8. 你想帶受眾去哪裡？
9. 你寫作的規則與用語：哪些詞一定用、哪些絕對不用？
問完之後整理成品牌文件（Markdown，每題一節，盡量用我的原話，不要加我沒說過的事），先給我確認。
開始前先用 get_brand_doc 看 doc_id「brand」有沒有舊版；有的話存檔時帶上它的 version 當 base_version，沒有就帶 0。
確認後用 save_brand_doc 存成 doc_id「brand」。
```

### 範本 C：內容地圖

```text
請幫我做 Threads 內容地圖：
1. 用 get_brand_doc 讀 doc_id「brand」和「content」。缺哪一份就先告訴我，建議我先跑範本 A 或範本 B。
2. 依這兩份文件規劃：3 到 4 個內容支柱，每個支柱 5 到 7 個主題，每個主題 5 到 10 個創意，每個創意 4 到 5 個切角（例如故事、反直覺觀點、步驟、清單、常見錯誤），每個切角寫成一句話。
3. 用巢狀清單呈現，先給我確認，再用 save_brand_doc 存成 doc_id「content_map」。
4. 我挑出想先寫的創意後，用 list_accounts 確認帳號，用 generate_posts 起草（account_id 帶我的帳號，context 貼上相關的品牌文件段落）；給我看過以後，用 schedule_text 排程，或用 add_library 放進文案庫。
沒有我同意，不要發文、不要排程。
```
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
| `events [--since] [--types] [--follow]` | Event feed for agents without a webhook endpoint; `--follow` polls at an interval that fits your daily quota (every 30 min on the free plan) and pauses until midnight Asia/Taipei after a daily 429 |
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
# Or approve a batch: up to 50, within the account's daily cap; flagged drafts stay for one-by-one approval
mindthread patrol approve --all -a @yourbrand

# Watch what happens
mindthread events --follow --types post.published,post.failed --json

# Endpoints without a dedicated command: random posting times that skip 17:00-18:00 (API 1.21.0)
mindthread api PATCH /accounts/<account_id>/settings -d '{"random_schedule":true,"random_per_day":3,"random_window":"09:00-22:00","random_exclude":["17:00-18:00"]}'
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

接到 agent：Claude Code 用 `claude mcp add --transport http mindthread https://mindthread.tw/api/mcp --header "Authorization: Bearer $MINDTHREAD_API_KEY"`；Cursor 用 [examples/cursor-mcp.json](examples/cursor-mcp.json)；OpenClaw 先 `npm install -g mindthread-cli`，再 `npx clawhub@latest install mindthread --workdir ~/.openclaw/workspace`。完整步驟與常見錯誤怎麼處理見 [docs/agent-setup.md](docs/agent-setup.md)。

時間要帶時區（台灣是 `+08:00`），也可以寫 `+2h` 表示兩小時後。金鑰的每項權限可以設成「允許」「先問我」「拒絕」；設成「先問我」時，指令會以結束碼 3 結束並印出確認連結，帳號擁有者在 mindthread.tw 按下確認後才會執行。

## License

MIT © Ultra Lab
