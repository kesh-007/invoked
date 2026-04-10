/**
 * Shared helpers for mocking @anthropic-ai/claude-agent-sdk in tests.
 *
 * Usage in a test file:
 *
 *   import { makeSdkMock, makeTextEvent, makeResultEvent, makePlanResult } from "../mocks/sdk";
 *
 *   jest.mock("@anthropic-ai/claude-agent-sdk", () => makeSdkMock());
 *   import { query } from "@anthropic-ai/claude-agent-sdk";
 *   const mockQuery = query as jest.MockedFunction<typeof query>;
 */

// ── Event helpers ─────────────────────────────────────────────────────────────

/** Yields a text chunk event (what Agent.stream() reads) */
export function makeTextEvent(text: string) {
  return {
    type: "stream_event",
    event: {
      type: "content_block_delta",
      delta: { type: "text_delta", text },
    },
  };
}

/** Yields a session init event */
export function makeInitEvent(sessionId = "test-session-id") {
  return { type: "system", subtype: "init", session_id: sessionId };
}

/** Yields the final result event (what Agent.generate() reads) */
export function makeResultEvent(result: string) {
  return { result };
}

/** Builds a full mock query response for a plain text generation */
export function makeTextResponse(text: string) {
  return [makeInitEvent(), makeTextEvent(text), makeResultEvent(text)];
}

/** Builds a mock query response whose result is a JSON-serialised plan object */
export function makePlanResponse(plan: {
  reasoning: string;
  steps: Array<{ agent: string; task: string; runInParallel: boolean }>;
}) {
  const json = JSON.stringify(plan);
  return [makeInitEvent(), makeResultEvent(json)];
}

// ── Mock factory ──────────────────────────────────────────────────────────────

/**
 * Returns the mock module object — pass this to jest.mock() factory fn.
 * The returned `query` is a jest.fn() async generator you can configure per test.
 */
export function makeSdkMock() {
  const mockQuery = jest.fn(async function* (): AsyncGenerator<unknown> {
    yield makeInitEvent();
    yield makeTextEvent("mock response");
    yield makeResultEvent("mock response");
  });

  return {
    query: mockQuery,
    tool: jest.fn((name: string, _desc: string, _input: unknown, _run: unknown) => ({
      name,
    })),
    createSdkMcpServer: jest.fn(() => undefined),
  };
}

/**
 * Replaces the mock `query` implementation with one that yields the given events in order.
 * Accepts multiple response arrays — each call to `query` consumes the next array.
 */
export function setQueryResponses(
  mockQuery: jest.MockedFunction<(...args: unknown[]) => AsyncGenerator<unknown>>,
  ...responseSets: Array<unknown[]>
) {
  for (const events of responseSets) {
    mockQuery.mockImplementationOnce(async function* () {
      for (const event of events) yield event;
    });
  }
}
