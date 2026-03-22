import type { Agent } from "../core";

// ─── HTTP ─────────────────────────────────────────────────────────────────────

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface WebhookRequest {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  query: Record<string, string | string[] | undefined>;
}

export interface WebhookContext {
  automation: string;
  triggeredAt: string;
}

export type WebhookHandler = (
  req: WebhookRequest,
  ctx: WebhookContext
) => Promise<unknown> | unknown;

// ─── Cron ─────────────────────────────────────────────────────────────────────

export interface CronContext {
  automation: string;
  triggeredAt: string;
}

export type CronHandler = (ctx: CronContext) => Promise<void> | void;

// ─── Automation definitions ───────────────────────────────────────────────────

export interface CronAutomationDef {
  kind: "cron";
  name: string;
  schedule: string;
  agent?: Agent;
  prompt?: string | ((ctx: CronContext) => string);
  run?: CronHandler;
}

export interface WebhookAutomationDef {
  kind: "webhook";
  name: string;
  path: string;
  method: HttpMethod;
  agent?: Agent;
  prompt?: string | ((req: WebhookRequest) => string);
  run?: WebhookHandler;
}

export type AutomationDef = CronAutomationDef | WebhookAutomationDef;
