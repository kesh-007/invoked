// ─── Core ─────────────────────────────────────────────────────────────────────
export { Agent } from "./core/Agent";
export { defineTool } from "./core/Tool";
export { defineSkill } from "./core/Skill";
export { createInputProcessor, createOutputProcessor } from "./core/pipelines";

export type {
  AgentConfig,
  InputContext,
  InputMiddleware,
  OutputContext,
  OutputMiddleware,
  SkillDef,
  ToolDef,
} from "./core/types";

// ─── Automations ─────────────────────────────────────────────────────────────
export { createAutomation, getRegistry, clearRegistry } from "./automations/builder";
export { startAutomations } from "./automations/runner";

export type {
  AutomationDef,
  CronAutomationDef,
  CronContext,
  CronHandler,
  HttpMethod,
  RunnerOptions,
  WebhookAutomationDef,
  WebhookContext,
  WebhookHandler,
  WebhookRequest,
} from "./automations";
