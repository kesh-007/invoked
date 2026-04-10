import {
  createInputProcessor,
  createOutputProcessor,
  runInputPipeline,
  runOutputPipeline,
} from "../../src/core/pipelines";
import type { InputContext, OutputContext } from "../../src/core/types";

function makeInputCtx(message: string): InputContext {
  return { message, agentName: "test", timestamp: "2024-01-01T00:00:00Z", metadata: {} };
}

function makeOutputCtx(result: string): OutputContext {
  return {
    result,
    agentName: "test",
    input: makeInputCtx("original"),
    metadata: {},
  };
}

// ── createInputProcessor ───────────────────────────────────────────────────────

describe("createInputProcessor", () => {
  it("transforms the context", async () => {
    const processor = createInputProcessor((ctx) => ({
      ...ctx,
      message: ctx.message.toUpperCase(),
    }));

    const ctx = makeInputCtx("hello");
    const result = await runInputPipeline(ctx, [processor]);
    expect(result.message).toBe("HELLO");
  });

  it("supports async transforms", async () => {
    const processor = createInputProcessor(async (ctx) => ({
      ...ctx,
      message: `[async] ${ctx.message}`,
    }));

    const result = await runInputPipeline(makeInputCtx("test"), [processor]);
    expect(result.message).toBe("[async] test");
  });

  it("does not mutate the original context", async () => {
    const processor = createInputProcessor((ctx) => ({ ...ctx, message: "changed" }));
    const ctx = makeInputCtx("original");
    await runInputPipeline(ctx, [processor]);
    expect(ctx.message).toBe("original");
  });
});

// ── createOutputProcessor ─────────────────────────────────────────────────────

describe("createOutputProcessor", () => {
  it("transforms the output result", async () => {
    const processor = createOutputProcessor((ctx) => ({
      ...ctx,
      result: ctx.result.trim(),
    }));

    const result = await runOutputPipeline(makeOutputCtx("  hello  "), [processor]);
    expect(result.result).toBe("hello");
  });
});

// ── runInputPipeline ──────────────────────────────────────────────────────────

describe("runInputPipeline", () => {
  it("returns the context unchanged when pipeline is empty", async () => {
    const ctx = makeInputCtx("hello");
    const result = await runInputPipeline(ctx, []);
    expect(result).toEqual(ctx);
  });

  it("chains multiple processors in order", async () => {
    const steps: string[] = [];

    const a = createInputProcessor((ctx) => { steps.push("a"); return { ...ctx, message: ctx.message + "-a" }; });
    const b = createInputProcessor((ctx) => { steps.push("b"); return { ...ctx, message: ctx.message + "-b" }; });
    const c = createInputProcessor((ctx) => { steps.push("c"); return { ...ctx, message: ctx.message + "-c" }; });

    const result = await runInputPipeline(makeInputCtx("x"), [a, b, c]);
    expect(steps).toEqual(["a", "b", "c"]);
    expect(result.message).toBe("x-a-b-c");
  });

  it("supports full middleware with manual next() calls", async () => {
    const log: string[] = [];

    const middleware: Parameters<typeof runInputPipeline>[1][0] = async (ctx, next) => {
      log.push("before");
      const out = await next({ ...ctx, message: "intercepted" });
      log.push("after");
      return out;
    };

    const result = await runInputPipeline(makeInputCtx("original"), [middleware]);
    expect(log).toEqual(["before", "after"]);
    expect(result.message).toBe("intercepted");
  });
});

// ── runOutputPipeline ─────────────────────────────────────────────────────────

describe("runOutputPipeline", () => {
  it("returns the context unchanged when pipeline is empty", async () => {
    const ctx = makeOutputCtx("hello");
    const result = await runOutputPipeline(ctx, []);
    expect(result).toEqual(ctx);
  });

  it("chains multiple output processors in order", async () => {
    const a = createOutputProcessor((ctx) => ({ ...ctx, result: ctx.result + "-a" }));
    const b = createOutputProcessor((ctx) => ({ ...ctx, result: ctx.result + "-b" }));

    const result = await runOutputPipeline(makeOutputCtx("x"), [a, b]);
    expect(result.result).toBe("x-a-b");
  });
});
