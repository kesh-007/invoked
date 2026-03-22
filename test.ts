import { Agent } from "./src/core/Agent";

const agent = new Agent({
  name: "test-agent",
  instructions: "You are a concise assistant. Keep all responses under 2 sentences.",
});

async function main() {
  const prompt = "What is 2 + 2?";

  // ── generate ────────────────────────────────────────────────────────────────
  console.log("Testing generate()...");
  const t1 = Date.now();
  const result = await agent.generate(prompt);
  const generateMs = Date.now() - t1;

  console.log("Result:", result);
  console.log(`generate() took: ${generateMs}ms\n`);

  // ── stream ──────────────────────────────────────────────────────────────────
  console.log("Testing stream()...");
  const t2 = Date.now();
  let firstChunkMs: number | null = null;
  let full = "";

  for await (const chunk of agent.stream(prompt)) {
    if (firstChunkMs === null) {
      firstChunkMs = Date.now() - t2;
      process.stdout.write(`  first chunk at ${firstChunkMs}ms → `);
    }
    process.stdout.write(chunk);
    full += chunk;
  }

  const streamMs = Date.now() - t2;
  console.log(`\nstream() total: ${streamMs}ms  |  first chunk: ${firstChunkMs}ms`);
}

main().catch(console.error);
