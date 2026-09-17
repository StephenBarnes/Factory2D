import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("aligns browser clocks, clips spans, and separates nested coverage from other threads/processes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "factory2d-trace-"));
  try {
    const resultPath = join(directory, "result.json");
    await writeFile(resultPath, JSON.stringify({
      schemaVersion: 1,
      method: { tracingEnabled: true },
      windows: [{ phase: "active", measurement: { startedAtMs: 12, durationMs: 10 } }],
    }));
    // Trace clock 100 ms == browser clock 10 ms: the measured window is [102, 112] ms.
    const slice = (ts: number, dur: number, tid = 1, pid = 1) => ({
      ph: "X", cat: "blink", name: "work", pid, tid, ts: ts * 1000, dur: dur * 1000,
    });
    await writeFile(join(directory, "chrome-trace.json"), JSON.stringify({ traceEvents: [
      { ph: "I", cat: "blink.user_timing", name: "benchmark:active", pid: 1, tid: 1,
        ts: 100_000, args: { data: { startTime: 10 } } },
      slice(108, 10), // Clipped to [108,112], deliberately out of time order.
      slice(99, 5), // Clipped to [102,104].
      slice(103, 2), // Overlaps the preceding interval: union extends only to 105.
      slice(103, 0.5), // Nested slice contributes to count, not covered time.
      slice(101, 1), // Ends exactly at the window start: excluded.
      slice(112, 2), // Starts exactly at the window end: excluded.
      slice(102, 10, 2), // Same event on another thread must not inflate main-thread time.
      slice(102, 10, 1, 2), // Other process is outside the renderer scope.
      { ...slice(102, 10), ph: "B" }, // Non-complete slices are not fabricated durations.
    ] }));
    execFileSync(process.execPath, [fileURLToPath(new URL("../tools/benchmark/summarize-trace.ts", import.meta.url)), resultPath]);
    const report = JSON.parse(await readFile(join(directory, "trace-summary.json"), "utf8"));
    expect(report.windows[0].events).toEqual([
      { threadId: 2, threadName: null, mainThread: false, name: "work", category: "blink",
        count: 1, coveredMs: 10, p50Ms: 10, p95Ms: 10, maxMs: 10 },
      { threadId: 1, threadName: null, mainThread: true, name: "work", category: "blink",
        count: 4, coveredMs: 7, p50Ms: 2, p95Ms: 4, maxMs: 4 },
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
