import { z } from "zod";
import { Agent } from "./Agent";
import type {
  ModelRoute,
  ModelRouter,
  OrchestratorConfig,
  OrchestratorEvent,
  PlannedStep,
} from "./types";

// ─── defineModelRouter ────────────────────────────────────────────────────────

/**
 * Create a model router that maps task descriptions to the best model.
 * Rules are evaluated in order — first match wins.
 *
 * @example
 * const router = defineModelRouter([
 *   { match: /review|architect|analyze/i, model: "claude-opus-4-6"           },
 *   { match: /write|draft|summarize/i,    model: "claude-sonnet-4-6"         },
 *   { match: /lookup|search|find/i,       model: "claude-haiku-4-5-20251001" },
 * ]);
 */
export function defineModelRouter(
  routes: ModelRoute[],
  defaultModel = "claude-sonnet-4-6"
): ModelRouter {
  return async (task: string): Promise<string> => {
    for (const route of routes) {
      const { match } = route;
      let matched: boolean;
      if (typeof match === "string") {
        matched = task.toLowerCase().includes(match.toLowerCase());
      } else if (match instanceof RegExp) {
        matched = match.test(task);
      } else {
        matched = await match(task);
      }
      if (matched) return route.model;
    }
    return defaultModel;
  };
}

// ─── Internal: merge async generators ────────────────────────────────────────

/**
 * Merge N async generators into one, yielding values as they arrive (race).
 * Preserves all values; order reflects arrival time not insertion order.
 */
async function* mergeGenerators<T>(
  factories: Array<() => AsyncGenerator<T>>
): AsyncGenerator<T> {
  if (factories.length === 0) return;
  if (factories.length === 1) { yield* factories[0](); return; }

  interface Slot {
    index: number;
    gen: AsyncGenerator<T>;
    promise: Promise<{ index: number; result: IteratorResult<T> }>;
  }

  const slots = new Map<number, Slot>();
  for (let i = 0; i < factories.length; i++) {
    const gen = factories[i]();
    const index = i;
    slots.set(i, {
      index,
      gen,
      promise: gen.next().then((result) => ({ index, result })),
    });
  }

  while (slots.size > 0) {
    const { index, result } = await Promise.race(
      [...slots.values()].map((s) => s.promise)
    );
    const slot = slots.get(index)!;
    if (result.done) {
      slots.delete(index);
    } else {
      yield result.value;
      slot.promise = slot.gen.next().then((r) => ({ index, result: r }));
    }
  }
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

/**
 * Multi-agent orchestrator that coordinates a team of specialised agents to
 * complete a task, then synthesizes their outputs into one conclusive answer.
 *
 * ## How it works
 *
 * When you call `orchestrator.stream(task)` (or `orchestrator.generate(task)`),
 * three phases run automatically:
 *
 * ### Phase 1 — Plan
 * A built-in planner agent analyses the task and the available agents, then
 * produces a typed **workflow**: an ordered list of agent invocations, each
 * marked as sequential or parallel.
 *
 * ### Phase 2 — Execute
 * The workflow is executed step by step:
 * - Steps marked `runInParallel: true` run **concurrently** — their streaming
 *   chunks are merged and emitted in arrival order.
 * - Steps marked `runInParallel: false` run **sequentially** — each step
 *   automatically receives the results of all prior steps as context.
 *
 * ### Phase 3 — Synthesize
 * A built-in synthesizer agent combines every agent's output into a single,
 * coherent conclusion — not a concatenation, but a true synthesis.
 *
 * ## Event stream
 *
 * | Event type          | When emitted                                    |
 * |---------------------|-------------------------------------------------|
 * | `"planning"`        | Orchestration starts                            |
 * | `"plan"`            | Planner produces the workflow                   |
 * | `"agent_start"`     | An agent begins its task                        |
 * | `"agent_chunk"`     | Streaming text from a running agent             |
 * | `"agent_done"`      | An agent finishes; full result attached         |
 * | `"synthesizing"`    | All agents done; synthesizer starting           |
 * | `"conclusion_chunk"`| Streaming text from the synthesizer             |
 * | `"conclusion"`      | Final synthesized answer                        |
 * | `"done"`            | Everything complete; all results + conclusion   |
 *
 * @example
 * ```typescript
 * import { Agent, Orchestrator } from "invoked";
 *
 * const researcher = new Agent({
 *   name: "researcher",
 *   description: "Searches the web and gathers facts",
 *   instructions: "You are a research specialist. Return key facts about the given topic.",
 *   allowedTools: ["WebSearch"],
 * });
 *
 * const analyst = new Agent({
 *   name: "analyst",
 *   description: "Analyses information and identifies insights",
 *   instructions: "You are a data analyst. Identify the most important patterns and insights.",
 * });
 *
 * const writer = new Agent({
 *   name: "writer",
 *   description: "Writes clear, engaging explanations",
 *   instructions: "You are a writer. Turn facts and insights into a polished explanation.",
 * });
 *
 * const orchestrator = new Orchestrator({
 *   name: "content-pipeline",
 *   agents: [researcher, analyst, writer],
 *   plannerModel:     "claude-sonnet-4-6",
 *   synthesizerModel: "claude-sonnet-4-6",
 * });
 *
 * for await (const event of orchestrator.stream("Write a blog post about AI agents")) {
 *   if (event.type === "plan") {
 *     console.log("Workflow:", event.steps);
 *   }
 *   if (event.type === "agent_start") {
 *     console.log(`\n▶ [${event.agent}]`, event.task);
 *   }
 *   if (event.type === "agent_chunk") {
 *     process.stdout.write(event.chunk);
 *   }
 *   if (event.type === "synthesizing") {
 *     console.log("\n\n— Synthesizing…");
 *   }
 *   if (event.type === "conclusion_chunk") {
 *     process.stdout.write(event.chunk);
 *   }
 *   if (event.type === "done") {
 *     console.log("\n\nDone!", event.conclusion);
 *   }
 * }
 * ```
 *
 * @example Using `generate()` for a simple one-shot call
 * ```typescript
 * const { results, conclusion } = await orchestrator.generate(
 *   "Compare React and Vue for a large-scale app"
 * );
 * console.log(conclusion);
 * ```
 */
export class Orchestrator {
  readonly name: string;
  private cfg: OrchestratorConfig;
  private planner: Agent;
  private synthesizer: Agent;

  constructor(config: OrchestratorConfig) {
    this.cfg = config;
    this.name = config.name;

    if (!config.agents || config.agents.length === 0) {
      throw new Error(`Orchestrator "${config.name}" requires at least one agent.`);
    }

    // Describe agents to the planner
    const agentLines = config.agents
      .map((a) => {
        const desc = a.description
          ?? (typeof (a as unknown as { cfg: { instructions: unknown } }).cfg?.instructions === "string"
            ? String((a as unknown as { cfg: { instructions: unknown } }).cfg.instructions).slice(0, 120)
            : a.name);
        return `  • ${a.name}: ${desc}`;
      })
      .join("\n");

    const plannerInstructions = [
      `You are the workflow planner for the "${config.name}" orchestrator.`,
      `Your job: decompose the given task into a precise workflow of agent invocations.`,
      ``,
      `Rules:`,
      `- Use ONLY the agents listed below — no others.`,
      `- Set runInParallel=true for independent sub-tasks that can run simultaneously.`,
      `- Set runInParallel=false for steps that need results from a prior step.`,
      `- Write a clear, specific task prompt for each agent invocation.`,
      ``,
      `Available agents:`,
      agentLines,
      config.instructions ? `\nAdditional guidance:\n${config.instructions}` : "",
    ].filter(Boolean).join("\n");

    this.planner = new Agent({
      name: `${config.name}-planner`,
      description: "Plans the workflow by deciding which agents to invoke, in what order, and with what tasks.",
      ...(config.plannerModel ? { model: config.plannerModel } : {}),
      memory: false,
      instructions: plannerInstructions,
    });

    this.synthesizer = new Agent({
      name: `${config.name}-synthesizer`,
      description: "Synthesizes all agent results into one coherent conclusive answer.",
      ...(config.synthesizerModel
        ? { model: config.synthesizerModel }
        : config.plannerModel
          ? { model: config.plannerModel }
          : {}),
      memory: false,
      instructions: [
        `You are the synthesizer for the "${config.name}" orchestrator.`,
        `You receive the original task and the output from every agent that worked on it.`,
        `Your job: combine those outputs into a single, coherent, conclusive answer.`,
        `- Do NOT just concatenate or list the outputs — synthesize them.`,
        `- Resolve contradictions, highlight the most important insights, and produce one unified response.`,
        `- Write as if you are directly answering the original task — the user should not need to read the individual agent outputs.`,
      ].join("\n"),
    });
  }

  // ── stream ────────────────────────────────────────────────────────────────

  /**
   * Stream the full orchestration as typed events.
   *
   * Runs three phases in sequence:
   * 1. **Plan** — planner LLM decides which agents to call, in what order.
   * 2. **Execute** — runs the workflow; parallel steps stream concurrently,
   *    sequential steps receive prior results as context.
   * 3. **Synthesize** — combines all agent results into one final conclusion.
   *
   * @param task - The task description for the orchestrator to complete.
   * @yields `OrchestratorEvent` objects describing each phase of the run.
   */
  async *stream(task: string): AsyncGenerator<OrchestratorEvent> {
    yield { type: "planning", message: "Analysing task and building workflow…" };

    // ── Phase 1: Plan ─────────────────────────────────────────────────────
    const agentNames = this.cfg.agents.map((a) => a.name) as [string, ...string[]];

    const planSchema = z.object({
      reasoning: z.string().describe("Why you chose these agents in this order"),
      steps: z.array(
        z.object({
          agent: z.enum(agentNames).describe("Exact agent name to invoke"),
          task: z.string().describe("Specific task/prompt to send to this agent"),
          runInParallel: z.boolean().describe(
            "true = run concurrently with the next parallel step(s); false = wait for all prior steps first"
          ),
        })
      ).min(1).describe("Ordered workflow steps"),
    });

    let plan: z.infer<typeof planSchema>;
    try {
      plan = await this.planner.generateObject(task, planSchema);
    } catch (err) {
      console.error(`[${this.name}] Planning failed — falling back to first agent:`, err);
      plan = {
        reasoning: "Planning failed — falling back to single-agent execution.",
        steps: [{ agent: agentNames[0], task, runInParallel: false }],
      };
    }

    yield {
      type: "plan",
      reasoning: plan.reasoning,
      steps: plan.steps as PlannedStep[],
    };

    // ── Phase 2: Execute workflow ──────────────────────────────────────────
    // Group consecutive parallel steps into batches; each sequential step is its own batch.
    const batches: PlannedStep[][] = [];
    let parBatch: PlannedStep[] = [];

    for (const step of plan.steps as PlannedStep[]) {
      if (step.runInParallel) {
        parBatch.push(step);
      } else {
        if (parBatch.length) { batches.push(parBatch); parBatch = []; }
        batches.push([step]);
      }
    }
    if (parBatch.length) batches.push(parBatch);

    const results: Record<string, string> = {};

    for (const batch of batches) {
      if (batch.length === 1) {
        yield* this._runStep(batch[0], results);
      } else {
        // Parallel — merge streaming output from all agents in this batch
        yield* mergeGenerators(batch.map((step) => () => this._runStep(step, results)));
      }
    }

    // ── Phase 3: Synthesize conclusion ────────────────────────────────────
    yield { type: "synthesizing", message: "Synthesizing agent results into final conclusion…" };

    const synthPrompt = this._buildSynthesisPrompt(task, results);
    let conclusion = "";

    for await (const chunk of this.synthesizer.stream(synthPrompt)) {
      yield { type: "conclusion_chunk", chunk };
      conclusion += chunk;
    }

    yield { type: "conclusion", result: conclusion };
    yield { type: "done", results, conclusion };
  }

  // ── generate ──────────────────────────────────────────────────────────────

  /**
   * Run the full orchestration and return a single resolved value.
   *
   * Identical to `stream()` but collects all events internally and resolves
   * when the orchestration is complete. Use this when you only need the final
   * answer and don't need to react to intermediate streaming events.
   *
   * @param task - The task description for the orchestrator to complete.
   * @returns An object with:
   *   - `results` — each agent's raw output, keyed by agent name.
   *   - `conclusion` — the synthesized final answer.
   */
  async generate(task: string): Promise<{ results: Record<string, string>; conclusion: string }> {
    const results: Record<string, string> = {};
    let conclusion = "";
    for await (const event of this.stream(task)) {
      if (event.type === "agent_done")  results[event.agent] = event.result;
      if (event.type === "conclusion")  conclusion = event.result;
    }
    return { results, conclusion };
  }

  // ── private ───────────────────────────────────────────────────────────────

  /**
   * Builds the prompt sent to the synthesizer agent.
   * Includes the original task and every agent's full output as labelled sections.
   */
  private _buildSynthesisPrompt(task: string, results: Record<string, string>): string {
    const sections = Object.entries(results)
      .map(([name, result]) => `### [${name}]\n${result}`)
      .join("\n\n");

    return [
      `Original task: ${task}`,
      ``,
      `Results from the agents that worked on this task:`,
      ``,
      sections,
      ``,
      `Now synthesize all of the above into one comprehensive, conclusive answer to the original task.`,
    ].join("\n");
  }

  /**
   * Executes a single workflow step against its assigned agent.
   *
   * For sequential steps, all results collected so far are injected into the
   * task prompt as context so the agent can build on prior work.
   * If a `modelRouter` is configured, the task string is passed through it to
   * select the best model for this particular invocation.
   */
  private async *_runStep(
    step: PlannedStep,
    results: Record<string, string>
  ): AsyncGenerator<OrchestratorEvent> {
    const agent = this.cfg.agents.find((a) => a.name === step.agent);
    if (!agent) {
      const msg = `[Error: agent "${step.agent}" not found]`;
      results[step.agent] = msg;
      yield { type: "agent_done", agent: step.agent, result: msg };
      return;
    }

    // Inject prior results as context for sequential steps
    let taskPrompt = step.task;
    const priorEntries = Object.entries(results);
    if (priorEntries.length > 0) {
      const context = priorEntries
        .map(([name, res]) => `[${name}]:\n${res}`)
        .join("\n\n");
      taskPrompt = `${step.task}\n\n--- Context from prior agents ---\n${context}`;
    }

    // Resolve model via router if configured
    const routedModel = this.cfg.modelRouter
      ? await this.cfg.modelRouter(step.task)
      : undefined;

    const runAgent = routedModel ? agent.withModel(routedModel) : agent;

    yield { type: "agent_start", agent: step.agent, task: step.task };

    let full = "";
    for await (const chunk of runAgent.stream(taskPrompt)) {
      yield { type: "agent_chunk", agent: step.agent, chunk };
      full += chunk;
    }

    results[step.agent] = full;
    yield { type: "agent_done", agent: step.agent, result: full };
  }
}
