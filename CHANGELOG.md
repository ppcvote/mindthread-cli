# Changelog

## 0.4.1 (2026-11-02)

- Every call counts against the key's daily quota, including `events` polls that return nothing (free keys: 50 calls a day). `events --follow` used to poll every 60 s by default, which spends a free key's day in under an hour. The default interval now follows the key's daily quota from `X-RateLimit-Limit`: every 30 min up to 100/day, 15 min up to 200, 5 min up to 500, 2 min up to 1,000, 1 min above. It prints the interval once, and warns when an explicit `--interval` makes more calls a day than the quota.
- A daily 429 during `--follow` pauses until `reset_at` (00:00 Asia/Taipei) with one clear line, instead of polling again; other rate limits wait `retry_after_seconds`.
- A daily 429 on any other command says when the quota resets, to stop until then, and the suggested poll interval (API `suggested_poll_interval_seconds`).

## 0.4.0 (2026-10-27)

- `patrol approve` takes several ids (up to 50) or `--all -a <account>` and calls the API 1.19.0 batch approve. A batch sends at most the account's replies left today; flagged drafts (`needs_individual`: political, self_harm, pii, promo, flagged) are never sent in a batch and are listed as left pending, to approve one id at a time. One id still uses the single route and accepts `--reply`. Batch approve needs `patrol:reply_send` set to allow.
- `patrol pending` marks drafts that need individual approval and prints the daily cap and how many replies are left today.

## 0.3.0 (2026-10-27)

- Prints API 1.18.0 `changed_since_last_viewed` with the removed (`-`) and added (`+`) sentences, up to 5 each, plus `~ media changed` or `~ publish time: old → new`. Shown after `queue approve` (one id or many), `queue edit`, and per item in `schedules list` and `queue list`; never blocks and never changes the exit code. The skill tells agents to show the difference to the user before releasing.
- Prints API 1.17.0 warnings, one line each and without changing the exit code: `off_hours` when a scheduled time is outside the account's usual posting hours, `stale_time_reference` when the text says "yesterday" or "last week" and publishes on a later day. Shown after `post` and per item in `queue list`; `--json` keeps the envelope untouched.

## 0.2.0 (2026-10-26)

First npm release.

- Renamed the package to `mindthread-cli`; the command is `mindthread`.
- Rebuilt against MindThread API 1.16.1: `post` (now, at a time, relative `+2h`, best slot; images, carousels, video, topic tags), `queue` (publishing library), `schedules`, `thread`, `insights`, `patrol` (pending reply review, approve, reject, keyword suggestions, log, stats), `events --follow`, `webhooks`, `experiments`, `settings`, `usage`, `approval`, `connect-link`, and a raw `api` command for any endpoint.
- `--json` on every command prints the API envelope unchanged; stable exit codes (3 = waiting for the owner's approval, 4 = key problem, 5 = rate limited).
- Errors explain what to do: approval links, permission fixes, rate-limit retry times, content-rule violations, request ids.
- The API key comes from `MINDTHREAD_API_KEY` or `mindthread auth login` (hidden prompt, saved with owner-only permissions); it is never printed in full.
- Accounts can be picked by `@handle`, id or `MINDTHREAD_ACCOUNT`.
- Stdin is only read when asked for (`-`), so agents never hang.
- Ships an OpenClaw / ClawHub skill (`skills/mindthread/SKILL.md`).
- Contract tests against a mock server and against the live OpenAPI document.

## 0.1.0 (2026-03-18)

Unreleased prototype (`mt` command).
