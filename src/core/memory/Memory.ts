import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";

const DIR = join(process.cwd(), ".memory");

// ─── Long-term Memory ─────────────────────────────────────────────────────────

interface LTMEntry {
  ts: string;
  user: string;
  assistant: string;
}

/**
 * File-backed long-term memory.
 * Persists across sessions. Each agent gets its own JSON file.
 */
export class Memory {
  private path: string;
  private max: number;

  constructor(agentName: string, max = 50) {
    mkdirSync(DIR, { recursive: true });
    this.path = join(DIR, `${agentName}.ltm.json`);
    this.max = max;
  }

  read(): LTMEntry[] {
    if (!existsSync(this.path)) return [];
    return JSON.parse(readFileSync(this.path, "utf-8")) as LTMEntry[];
  }

  append(user: string, assistant: string) {
    const entries = this.read();
    entries.push({ ts: new Date().toISOString(), user, assistant });
    writeFileSync(this.path, JSON.stringify(entries.slice(-this.max), null, 2));
  }

  format(): string | null {
    const entries = this.read();
    if (!entries.length) return null;
    return entries
      .map((e) => `[${e.ts.slice(0, 10)}] User: ${e.user}\nAssistant: ${e.assistant}`)
      .join("\n\n");
  }

  clear() {
    if (existsSync(this.path)) unlinkSync(this.path);
  }
}

// ─── Conversation Memory ──────────────────────────────────────────────────────

interface Turn {
  role: "user" | "assistant";
  content: string;
}

/**
 * In-session conversation memory.
 * Stores recent turns and injects them into every prompt so the agent
 * always has immediate context — even in a fresh session.
 */
export class ConversationMemory {
  private turns: Turn[] = [];
  private max: number; // max number of PAIRS (user + assistant = 1 pair)

  constructor(maxPairs = 10) {
    this.max = maxPairs;
  }

  add(role: "user" | "assistant", content: string) {
    this.turns.push({ role, content });
    // Keep only the last maxPairs * 2 turns
    if (this.turns.length > this.max * 2) {
      this.turns = this.turns.slice(-this.max * 2);
    }
  }

  format(): string | null {
    if (!this.turns.length) return null;
    return this.turns
      .map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.content}`)
      .join("\n");
  }

  clear() {
    this.turns = [];
  }
}
