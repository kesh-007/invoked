/**
 * Default stub for @anthropic-ai/claude-agent-sdk used by unit tests.
 * Makes the SDK importable without triggering the actual ESM module.
 *
 * Integration tests override this with jest.mock('@anthropic-ai/claude-agent-sdk', factory).
 */

export async function* query(): AsyncGenerator<unknown> {
  // no-op stub — unit tests don't call agent methods
}

export function tool(
  _name: string,
  _desc: string,
  _input: unknown,
  _run: unknown
): unknown {
  return {};
}

export function createSdkMcpServer(_opts: unknown): unknown {
  return undefined;
}
