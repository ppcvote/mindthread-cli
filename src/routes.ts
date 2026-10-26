/**
 * Every REST route a built-in command calls (the raw `mindthread api` command is the only exception).
 * test/contract.test.mjs checks each one against the live OpenAPI document, and the mock tests
 * check that commands only call routes listed here, so a renamed endpoint fails the build, not a user.
 */
export const ROUTES = [
  ["GET", "/me"],
  ["GET", "/accounts"],
  ["POST", "/accounts/connect-link"],
  ["GET", "/accounts/{account_id}/settings"],
  ["PATCH", "/accounts/{account_id}/settings"],
  ["POST", "/content/generate"],
  ["POST", "/content/generate-thread"],
  ["POST", "/content/publish"],
  ["POST", "/content/publish-thread"],
  ["POST", "/content/schedule"],
  ["GET", "/schedules"],
  ["DELETE", "/schedules/{id}"],
  ["GET", "/library"],
  ["POST", "/library"],
  ["PATCH", "/library/{id}"],
  ["DELETE", "/library/{id}"],
  ["POST", "/library/{id}/approve"],
  ["POST", "/library/bulk"],
  ["GET", "/analytics/insights"],
  ["GET", "/patrol/cloud"],
  ["PUT", "/patrol/cloud"],
  ["GET", "/patrol/cloud/log"],
  ["GET", "/patrol/cloud/stats"],
  ["GET", "/patrol/cloud/keyword-suggestions"],
  ["GET", "/patrol/cloud/pending"],
  ["POST", "/patrol/cloud/pending/{id}/approve"],
  ["POST", "/patrol/cloud/pending/approve"],
  ["POST", "/patrol/cloud/pending/{id}/reject"],
  ["GET", "/events"],
  ["GET", "/webhooks"],
  ["POST", "/webhooks"],
  ["DELETE", "/webhooks/{id}"],
  ["GET", "/experiments"],
  ["POST", "/experiments"],
  ["GET", "/experiments/{id}"],
  ["POST", "/experiments/{id}/cancel"],
  ["GET", "/keys/current/usage"],
  ["GET", "/approvals/{id}"],
  ["POST", "/approvals/{id}/remind"],
  ["GET", "/formulas"],
] as const;

/** Does a concrete request (method + path without query) match one of ROUTES? */
export function matchRoute(method: string, path: string): boolean {
  return ROUTES.some(([m, tpl]) => {
    if (m !== method) return false;
    const re = new RegExp("^" + tpl.replace(/\{[^}]+\}/g, "[^/]+") + "$");
    return re.test(path);
  });
}
