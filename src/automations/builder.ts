import type { Agent } from "../core";
import type {
  AutomationDef,
  CronAutomationDef,
  CronContext,
  CronHandler,
  HttpMethod,
  WebhookAutomationDef,
  WebhookHandler,
  WebhookRequest,
} from "./types";

// ─── Registry ─────────────────────────────────────────────────────────────────

const _registry: AutomationDef[] = [];

/** All registered automations (read-only). */
export function getRegistry(): readonly AutomationDef[] {
  return _registry;
}

/** Clear all registered automations — useful in tests. */
export function clearRegistry(): void {
  _registry.length = 0;
}

// ─── Builder ──────────────────────────────────────────────────────────────────

export class AutomationBuilder {
  private readonly _name: string;
  private _kind?: "cron" | "webhook";

  // cron state
  private _schedule?: string;

  // webhook state
  private _path?: string;
  private _method: HttpMethod = "POST";

  // shared
  private _agent?: Agent;
  private _prompt?: string | ((ctx: any) => string);

  constructor(name: string) {
    this._name = name;
  }

  // ── Triggers ───────────────────────────────────────────────────────────────

  /**
   * Schedule this automation on a cron expression.
   *
   * @example
   * .cron("0 9 * * *")   // every day at 9 am
   * .cron("* * * * *")   // every minute
   */
  cron(schedule: string): this {
    this._kind = "cron";
    this._schedule = schedule;
    return this;
  }

  /**
   * Trigger this automation via an HTTP webhook endpoint.
   *
   * @example
   * .webhook("/github", { method: "POST" })
   * .webhook("/ping")                        // defaults to POST
   */
  webhook(path: string, options?: { method?: HttpMethod }): this {
    this._kind = "webhook";
    this._path = path.startsWith("/") ? path : `/${path}`;
    this._method = options?.method ?? "POST";
    return this;
  }

  // ── Configuration ──────────────────────────────────────────────────────────

  /**
   * The agent to invoke when this automation triggers.
   * Must also call `.prompt()` so the agent knows what to do.
   */
  agent(agent: Agent): this {
    this._agent = agent;
    return this;
  }

  /**
   * The prompt sent to the agent on each trigger.
   *
   * - Pass a string for a fixed prompt.
   * - Pass a function to build the prompt from the runtime context:
   *   - Cron:    `(ctx: CronContext) => string`
   *   - Webhook: `(req: WebhookRequest) => string`
   *
   * @example — fixed
   * .prompt("Summarise today's activity")
   *
   * @example — dynamic (webhook)
   * .prompt((req) => `Handle this event: ${JSON.stringify(req.body)}`)
   */
  prompt(value: string | ((ctx: CronContext | WebhookRequest) => string)): this {
    this._prompt = value;
    return this;
  }

  // ── Terminators ────────────────────────────────────────────────────────────

  /**
   * Register the automation using agent + prompt.
   * Use this when you don't need custom handler logic.
   *
   * @example
   * createAutomation("daily-report")
   *   .cron("0 9 * * *")
   *   .agent(myAgent)
   *   .prompt("Summarise the day")
   *   .start();
   */
  start(): void {
    this._register(undefined);
  }

  /**
   * Register the automation, optionally with a fully custom handler.
   *
   * - No handler → uses `.agent()` + `.prompt()` (same as `.start()`)
   * - Cron handler:    `(ctx: CronContext) => Promise<void>`
   * - Webhook handler: `(req: WebhookRequest, ctx: WebhookContext) => Promise<unknown>`
   *
   * @example — cron with custom logic
   * createAutomation("cleanup")
   *   .cron("0 0 * * *")
   *   .run(async (ctx) => {
   *     console.log("Running cleanup at", ctx.triggeredAt);
   *   });
   *
   * @example — webhook with custom logic
   * createAutomation("stripe")
   *   .webhook("/stripe", { method: "POST" })
   *   .run(async (req, ctx) => {
   *     const event = req.body as StripeEvent;
   *     return { received: true };
   *   });
   *
   * @example — webhook delegating to agent
   * createAutomation("github")
   *   .webhook("/github")
   *   .agent(codeReviewer)
   *   .run();
   */
  run(handler?: CronHandler | WebhookHandler): void {
    this._register(handler);
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private _register(handler: CronHandler | WebhookHandler | undefined): void {
    const { _name: name, _kind: kind } = this;

    if (!kind) {
      throw new Error(
        `[${name}] Call .cron() or .webhook() before .run() / .start()`
      );
    }

    if (!this._agent && !handler) {
      throw new Error(
        `[${name}] Must provide .agent() or a handler to .run()`
      );
    }

    if (kind === "cron") {
      if (!this._schedule) {
        throw new Error(`[${name}] Missing cron schedule — call .cron("* * * * *")`);
      }

      const def: CronAutomationDef = {
        kind: "cron",
        name,
        schedule: this._schedule,
        agent: this._agent,
        prompt: this._prompt as CronAutomationDef["prompt"],
        run: handler as CronHandler | undefined,
      };

      _registry.push(def);

    } else {
      if (!this._path) {
        throw new Error(`[${name}] Missing webhook path — call .webhook("/path")`);
      }

      const def: WebhookAutomationDef = {
        kind: "webhook",
        name,
        path: this._path,
        method: this._method,
        agent: this._agent,
        prompt: this._prompt as WebhookAutomationDef["prompt"],
        run: handler as WebhookHandler | undefined,
      };

      _registry.push(def);
    }

    const trigger =
      kind === "cron"
        ? `cron(${this._schedule})`
        : `${this._method} ${this._path}`;

    console.log(`[automations] registered "${name}"  →  ${trigger}`);
  }
}

// ─── Public factory ───────────────────────────────────────────────────────────

/**
 * Create a new automation using a fluent builder chain.
 *
 * Every automation needs:
 *   1. A trigger  — `.cron(schedule)` or `.webhook(path)`
 *   2. An action  — `.agent(a).prompt(p)` or a custom `.run(handler)`
 *   3. A terminal — `.start()` or `.run()`
 *
 * @example — cron + agent
 * createAutomation("daily-report")
 *   .cron("0 9 * * *")
 *   .agent(researchAgent)
 *   .prompt("Compile today's summary report")
 *   .start();
 *
 * @example — webhook + agent with dynamic prompt
 * createAutomation("pr-review")
 *   .webhook("/github")
 *   .agent(codeReviewer)
 *   .prompt((req) => `Review this PR: ${JSON.stringify(req.body)}`)
 *   .start();
 *
 * @example — webhook with fully custom handler
 * createAutomation("stripe")
 *   .webhook("/stripe", { method: "POST" })
 *   .run(async (req, ctx) => {
 *     return { received: true };
 *   });
 */
export function createAutomation(name: string): AutomationBuilder {
  return new AutomationBuilder(name);
}
