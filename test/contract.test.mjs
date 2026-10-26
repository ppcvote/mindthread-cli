// Every route the CLI calls must exist, with the same method, in the live OpenAPI document,
// and the request fields the CLI sends must be documented there. Network: fetches the public spec only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ROUTES } from "../dist/routes.js";

const SPEC_URL = (process.env.MINDTHREAD_API_URL || "https://mindthread.tw/api/v1").replace(/\/+$/, "") + "/openapi.json";

/** Body fields each command sends (keep in sync with src/index.ts; the mock tests pin the exact bodies) */
const BODY_FIELDS = {
  "POST /content/generate": ["topic", "account_id", "count", "formula", "quality", "context"],
  "POST /content/publish": ["account_id", "text", "media_urls", "video_url", "publish_now", "publish_at", "auto_thread", "topic_tag", "idempotency_key"],
  "POST /content/schedule": ["account_id", "text", "auto_optimize_time", "idempotency_key"],
  "POST /content/generate-thread": ["topic", "thread_count", "account_id", "formula", "context"],
  "POST /content/publish-thread": ["account_id", "thread_parts", "idempotency_key"],
  "POST /library": ["account_id", "status", "items", "idempotency_key"],
  "PATCH /library/{id}": ["text", "status", "position"],
  "POST /library/bulk": ["action", "ids"],
  "PUT /patrol/cloud": ["account_id", "keywords", "persona", "daily_cap", "mode", "enabled", "review_before_reply"],
  "POST /patrol/cloud/pending/{id}/approve": ["reply"],
  "POST /patrol/cloud/pending/approve": ["ids", "account_id", "all"],
  "POST /patrol/cloud/pending/{id}/reject": ["reason"],
  "POST /webhooks": ["url", "events", "secret"],
  "POST /experiments": ["topic", "account_id", "formulas"],
  "PATCH /accounts/{account_id}/settings": ["persona", "schedule_times", "review_before_publish", "auto_reply_enabled", "auto_thread", "enabled", "content_rules"],
};
/** Query parameters each command sends */
const QUERY_FIELDS = {
  "GET /schedules": ["account_id"],
  "GET /library": ["account_id", "status", "limit"],
  "GET /analytics/insights": ["account_id", "period"],
  "GET /patrol/cloud": ["account_id"],
  "GET /patrol/cloud/log": ["account_id", "days"],
  "GET /patrol/cloud/stats": ["account_id", "days"],
  "GET /patrol/cloud/keyword-suggestions": ["account_id"],
  "GET /patrol/cloud/pending": ["account_id", "status", "limit", "cursor"],
  "GET /events": ["since", "types", "limit"],
  "GET /keys/current/usage": ["days"],
};

const spec = await (await fetch(SPEC_URL)).json();

test(`every CLI route exists in the live OpenAPI (${spec.info?.version})`, () => {
  const missing = ROUTES.filter(([m, p]) => !spec.paths?.[p]?.[m.toLowerCase()]).map(([m, p]) => `${m} ${p}`);
  assert.deepEqual(missing, [], `routes missing from ${SPEC_URL}`);
});

test("request body fields the CLI sends are documented", () => {
  const undocumented = [];
  for (const [route, fields] of Object.entries(BODY_FIELDS)) {
    const [m, p] = route.split(" ");
    const props = spec.paths[p][m.toLowerCase()].requestBody?.content?.["application/json"]?.schema?.properties ?? {};
    for (const f of fields) if (!(f in props)) undocumented.push(`${route} ${f}`);
  }
  assert.deepEqual(undocumented, []);
});

test("query parameters the CLI sends are documented", () => {
  const undocumented = [];
  for (const [route, fields] of Object.entries(QUERY_FIELDS)) {
    const [m, p] = route.split(" ");
    const names = (spec.paths[p][m.toLowerCase()].parameters ?? []).filter((x) => x.in === "query").map((x) => x.name);
    for (const f of fields) if (!names.includes(f)) undocumented.push(`${route} ${f}`);
  }
  assert.deepEqual(undocumented, []);
});
