import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "./",
  build: {
    // Keep the game eagerly bundled; revisit loading strategy above this size (kB).
    chunkSizeWarningLimit: 750,
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
