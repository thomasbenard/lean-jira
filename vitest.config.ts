import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // better-sqlite3 est un addon natif : incompatible avec worker_threads.
    // pool "forks" utilise des child_process qui peuvent charger les .node files.
    pool: "forks",
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 10_000,
  },
});
