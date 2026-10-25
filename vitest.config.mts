import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/setup/global-mongo.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Integration tests share one MongoDB instance; each file uses its own database.
    fileParallelism: false,
  },
});
