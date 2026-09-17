import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// Built only by the benchmark runner, never imported by the workshop entry point.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "/benchmark/",
  build: {
    outDir: fileURLToPath(new URL("../../dist/benchmark", import.meta.url)),
    emptyOutDir: true,
    sourcemap: true,
  },
});
