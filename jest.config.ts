import type { Config } from "jest";

const config: Config = {
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  testMatch: ["**/*.test.ts"],
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: "tsconfig.test.json" }],
  },
  // Redirect the ESM SDK to a CJS-compatible stub.
  // Integration tests override this per-file via jest.mock().
  moduleNameMapper: {
    "^@anthropic-ai/claude-agent-sdk$": "<rootDir>/tests/mocks/sdk-stub.ts",
  },
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,
};

export default config;
