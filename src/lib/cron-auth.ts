import "server-only";

import { timingSafeEqual } from "node:crypto";

export type CronAuthorization =
  | { authorized: true }
  | {
      authorized: false;
      status: 401 | 503;
      body: { error: string; action: string };
    };

export function authorizeCron(request: Request): CronAuthorization {
  const configuredSecret = process.env.CRON_SECRET;
  if (!configuredSecret) {
    return {
      authorized: false,
      status: 503,
      body: {
        error: "Cron authentication is not configured",
        action: "Set CRON_SECRET before enabling scheduled ingestion.",
      },
    };
  }

  const authorization = request.headers.get("authorization");
  const suppliedSecret = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";
  const configured = Buffer.from(configuredSecret);
  const supplied = Buffer.from(suppliedSecret);
  const matches =
    configured.length === supplied.length &&
    timingSafeEqual(configured, supplied);

  if (!matches) {
    return {
      authorized: false,
      status: 401,
      body: {
        error: "Cron authorization is invalid",
        action: "Send Authorization: Bearer <CRON_SECRET> from the configured scheduler.",
      },
    };
  }

  return { authorized: true };
}
