#!/usr/bin/env sh
# MindThread in Claude Code: pick ONE of the three MCP options, or the CLI + skill at the bottom.
# Start with a test key (mt_test_...): writes are simulated, nothing reaches Threads.

# 1. Hosted MCP with a key
claude mcp add --transport http mindthread https://mindthread.tw/api/mcp --header "Authorization: Bearer $MINDTHREAD_API_KEY"

# 2. Hosted MCP with OAuth sign-in (no key; run /mcp inside Claude Code to log in)
# claude mcp add --transport http mindthread https://mindthread.tw/api/mcp

# 3. Local stdio bridge
# claude mcp add mindthread --env MINDTHREAD_API_KEY="$MINDTHREAD_API_KEY" -- npx -y mindthread-mcp

# CLI + skill (Claude Code drives the `mindthread` command through Bash)
# npm install -g mindthread-cli
# mkdir -p ~/.claude/skills/mindthread
# curl -fsSL https://raw.githubusercontent.com/ppcvote/mindthread-cli/master/skills/mindthread/SKILL.md -o ~/.claude/skills/mindthread/SKILL.md
# and allow it in .claude/settings.json: { "permissions": { "allow": ["Bash(mindthread:*)"] } }
