/**
 * Short-term, in-session key-value store.
 *
 * - Lives only for the duration of an Agent.run() call (or as long as
 *   you keep the Agent instance alive between calls).
 * - Automatically injected into the system prompt so the agent is aware of it.
 * - Input / output middleware can read and write values here.
 */
export class WorkingMemory {
  private store = new Map<string, unknown>();

  set(key: string, value: unknown): this {
    this.store.set(key, value);
    return this;
  }

  get<T = unknown>(key: string): T | undefined {
    return this.store.get(key) as T | undefined;
  }

  has(key: string): boolean {
    return this.store.has(key);
  }

  delete(key: string): this {
    this.store.delete(key);
    return this;
  }

  clear(): this {
    this.store.clear();
    return this;
  }

  toObject(): Record<string, unknown> {
    return Object.fromEntries(this.store);
  }

  /** Returns a human-readable string for prompt injection, or null if empty */
  format(): string | null {
    if (this.store.size === 0) return null;
    return [...this.store.entries()]
      .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
      .join("\n");
  }
}
