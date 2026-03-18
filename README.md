# MindThread CLI

Command-line interface for [MindThread](https://mindthread.tw) — AI-powered Threads automation.

## Install

```bash
npm install -g @ultralab/mindthread-cli
```

## Setup

```bash
# Save your API key (get one at https://mindthread.tw/settings)
mt auth login mt_live_your_key_here

# Verify
mt auth status
```

## Commands

```bash
# List connected accounts
mt accounts

# Generate content (preview only)
mt generate "AI replacing developers"
mt generate "remote work trends" -f controversial -n 3

# Publish immediately
mt post "Taiwan tech scene"
mt post "AI news" -a <account_id> -f curiosity

# Schedule a post
mt schedule "morning motivation" --at 2026-04-01T09:00:00+08:00
mt schedule "weekend thoughts" --auto-time

# View analytics
mt analytics
mt analytics -p 30d -a <account_id>

# List content formulas
mt formulas
```

## Options

| Flag | Commands | Description |
|------|----------|-------------|
| `-a, --account <id>` | post, schedule, analytics | Account ID (auto-detected if only one) |
| `-f, --formula <name>` | generate, post, schedule | Formula: auto, controversial, curiosity, binary_choice, personal, list |
| `-n, --count <n>` | generate | Number of variations (1-5) |
| `--at <datetime>` | schedule | ISO 8601 publish time |
| `--auto-time` | schedule | Let MindThread pick optimal time |
| `-p, --period <period>` | analytics | 7d, 14d, or 30d |

## Config

API key is stored at `~/.mindthread/config.json`. You can also use the `MINDTHREAD_API_KEY` environment variable.

## License
MIT
