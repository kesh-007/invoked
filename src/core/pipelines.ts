import type { InputContext, InputMiddleware, OutputContext, OutputMiddleware } from "./types";

// ─── Pipeline runners ────────────────────────────────────────────────────────

export async function runInputPipeline(
  ctx: InputContext,
  pipeline: InputMiddleware[]
): Promise<InputContext> {
  const run = (i: number, ctx: InputContext): Promise<InputContext> => {
    if (i >= pipeline.length) return Promise.resolve(ctx);
    return pipeline[i](ctx, (next) => run(i + 1, next));
  };
  return run(0, ctx);
}

export async function runOutputPipeline(
  ctx: OutputContext,
  pipeline: OutputMiddleware[]
): Promise<OutputContext> {
  const run = (i: number, ctx: OutputContext): Promise<OutputContext> => {
    if (i >= pipeline.length) return Promise.resolve(ctx);
    return pipeline[i](ctx, (next) => run(i + 1, next));
  };
  return run(0, ctx);
}

// ─── Simple processor helpers (no next() needed) ─────────────────────────────

/**
 * Create an input processor from a simple transform function.
 * No need to call next() — just return the modified context.
 *
 * @example
 * const addDate = createInputProcessor((ctx) => ({
 *   ...ctx,
 *   message: `Today is ${ctx.timestamp.slice(0, 10)}.\n\n${ctx.message}`,
 * }));
 */
export function createInputProcessor(
  fn: (ctx: InputContext) => InputContext | Promise<InputContext>
): InputMiddleware {
  return async (ctx, next) => next(await fn(ctx));
}

/**
 * Create an output processor from a simple transform function.
 * No need to call next() — just return the modified context.
 *
 * @example
 * const uppercase = createOutputProcessor((ctx) => ({
 *   ...ctx,
 *   result: ctx.result.toUpperCase(),
 * }));
 */
export function createOutputProcessor(
  fn: (ctx: OutputContext) => OutputContext | Promise<OutputContext>
): OutputMiddleware {
  return async (ctx, next) => next(await fn(ctx));
}
