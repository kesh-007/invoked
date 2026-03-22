import * as http from "http";
import { getRegistry } from "./builder";
import type {
  CronAutomationDef,
  CronContext,
  WebhookAutomationDef,
  WebhookContext,
  WebhookRequest,
} from "./types";

// ─── Options ──────────────────────────────────────────────────────────────────

export interface RunnerOptions {
  /**
   * Port for the webhook HTTP server.
   * **Only used when webhook automations are registered** — ignored for cron-only setups.
   * Default: 5000
   */
  port?: number;
  /**
   * Called when any automation throws an error.
   * Defaults to `console.error`.
   */
  onError?: (automationName: string, err: unknown) => void;
  /**
   * Override the base URL shown in startup logs.
   * **Only relevant when webhook automations are registered.**
   */
  baseUrl?: string;
}

// ─── startAutomations ─────────────────────────────────────────────────────────

/**
 * Start all registered automations.
 *
 * - **Cron** automations are scheduled immediately via `node-cron`.
 *   No HTTP server is started — `port` is irrelevant and ignored.
 * - **Webhook** automations are served on an HTTP server on `port` (default 3000).
 * - **Mixed** setups do both.
 *
 * Call this once after all `.start()` / `.run()` calls.
 *
 * @example — cron only (no port needed)
 * createAutomation("daily-report")
 *   .cron("0 9 * * *")
 *   .agent(myAgent)
 *   .prompt("Summarise the day")
 *   .start();
 *
 * await startAutomations();
 *
 * @example — webhooks (port needed)
 * createAutomation("github")
 *   .webhook("/github")
 *   .agent(codeReviewer)
 *   .prompt((req) => `Review: ${JSON.stringify(req.body)}`)
 *   .start();
 *
 * await startAutomations({ port: 5000 });
 */
export async function startAutomations(
  options: RunnerOptions = {}
): Promise<http.Server | undefined> {
  const { port = 5000, onError, baseUrl } = options;

  const registry = getRegistry();

  if (registry.length === 0) {
    console.warn(
      "[automations] Nothing registered. Did you forget .start() or .run()?"
    );
    return undefined;
  }

  const cronDefs = registry.filter(
    (a): a is CronAutomationDef => a.kind === "cron"
  );
  const webhookDefs = registry.filter(
    (a): a is WebhookAutomationDef => a.kind === "webhook"
  );

  // ── Cron ──────────────────────────────────────────────────────────────────

  if (cronDefs.length > 0) {
    let nodeCron: typeof import("node-cron");

    try {
      nodeCron = await import("node-cron");
    } catch {
      throw new Error(
        "[automations] node-cron is required for cron automations.\n" +
          "  Install it:  pnpm add node-cron"
      );
    }

    for (const def of cronDefs) {
      nodeCron.schedule(def.schedule, async () => {
        const ctx: CronContext = {
          automation: def.name,
          triggeredAt: new Date().toISOString(),
        };

        try {
          if (def.run) {
            await def.run(ctx);
          } else if (def.agent) {
            const prompt =
              typeof def.prompt === "function"
                ? def.prompt(ctx)
                : def.prompt ??
                  `Cron automation "${def.name}" triggered at ${ctx.triggeredAt}.`;
            await def.agent.generate(prompt);
          }
        } catch (err) {
          const handle = onError ?? defaultError;
          handle(def.name, err);
        }
      });

      console.log(
        `[automations] cron  "${def.name}"  →  ${def.schedule}`
      );
    }
  }

  // ── Webhooks ──────────────────────────────────────────────────────────────

  if (webhookDefs.length === 0) return undefined;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);
    const method = (req.method ?? "GET").toUpperCase();

    const def = webhookDefs.find(
      (d) => d.path === url.pathname && d.method === method
    );

    if (!def) {
      send(res, 404, { error: "No automation for this route" });
      return;
    }

    let body: unknown;
    if (["POST", "PUT", "PATCH"].includes(method)) {
      try {
        body = await readBody(req);
      } catch (err) {
        const status = String(err instanceof Error ? err.message : "").includes("too large") ? 413 : 400;
        send(res, status, { ok: false, error: String(err instanceof Error ? err.message : "Bad request") });
        return;
      }
    }

    const webhookReq: WebhookRequest = {
      method,
      path: url.pathname,
      headers: req.headers as Record<string, string | string[] | undefined>,
      body,
      query: Object.fromEntries(url.searchParams.entries()),
    };

    const webhookCtx: WebhookContext = {
      automation: def.name,
      triggeredAt: new Date().toISOString(),
    };

    try {
      let result: unknown;

      if (def.run) {
        result = await def.run(webhookReq, webhookCtx);
      } else if (def.agent) {
        const prompt =
          typeof def.prompt === "function"
            ? def.prompt(webhookReq)
            : def.prompt ??
              `Webhook "${def.name}" received ${method} at ${def.path}.\n` +
                `Body: ${JSON.stringify(body, null, 2)}`;
        result = await def.agent.generate(prompt);
      }

      send(res, 200, { ok: true, result: result ?? null });
    } catch (err) {
      const handle = onError ?? defaultError;
      handle(def.name, err);
      send(res, 500, { ok: false, error: "Automation failed" });
    }
  });

  await new Promise<void>((resolve) => server.listen(port, resolve));

  const base = baseUrl ?? `http://localhost:${port}`;
  console.log(`[automations] webhook server → ${base}`);

  for (const def of webhookDefs) {
    console.log(
      `[automations]   ${def.method.padEnd(7)} ${base}${def.path}  →  "${def.name}"`
    );
  }

  return server;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function send(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

const MAX_BODY_BYTES = 1 * 1024 * 1024; // 1 MB

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;

    req.on("data", (c: Buffer) => {
      received += c.byteLength;
      if (received > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error("Request body too large (limit: 1 MB)"));
        return;
      }
      chunks.push(c);
    });

    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf-8");
      if (!raw) { resolve({}); return; }
      try { resolve(JSON.parse(raw)); }
      catch { resolve(raw); }
    });

    req.on("error", (err) => reject(err));
  });
}

function defaultError(name: string, err: unknown) {
  console.error(`[automations] "${name}" failed:`, err);
}
