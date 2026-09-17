import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

interface TraceEvent {
  readonly name: string;
  readonly cat?: string;
  readonly ph: string;
  readonly pid: number;
  readonly tid: number;
  readonly ts: number;
  readonly args?: { readonly name?: string; readonly data?: { readonly startTime?: number } };
  readonly dur?: number;
}

interface BenchmarkResult {
  readonly schemaVersion: number;
  readonly source: unknown;
  readonly environment: unknown;
  readonly workload: unknown;
  readonly validity: unknown;
  readonly method: { readonly tracingEnabled: boolean };
  readonly windows: readonly {
    readonly phase: string;
    readonly measurement: { readonly startedAtMs: number; readonly durationMs: number };
  }[];
}

interface Span {
  readonly start: number;
  readonly end: number;
}

function summarize(spans: Span[]) {
  spans.sort((left, right) => left.start - right.start);
  let coveredUs = 0;
  let coveredUntil = -Infinity;
  const durations: number[] = [];
  for (const span of spans) {
    coveredUs += Math.max(0, span.end - Math.max(span.start, coveredUntil));
    coveredUntil = Math.max(coveredUntil, span.end);
    durations.push((span.end - span.start) / 1000);
  }
  durations.sort((left, right) => left - right);
  const p50Ms = durations[Math.ceil(durations.length * 0.5) - 1];
  const p95Ms = durations[Math.ceil(durations.length * 0.95) - 1];
  const maxMs = durations[durations.length - 1];
  if (p50Ms === undefined || p95Ms === undefined || maxMs === undefined) {
    throw new Error("Cannot summarize an empty trace event group");
  }
  return { count: spans.length, coveredMs: coveredUs / 1000, p50Ms, p95Ms, maxMs };
}

const resultPath = process.argv[2];
if (resultPath === undefined || process.argv.length !== 3) {
  throw new Error("Usage: npm run benchmark:trace -- <fixture-directory>/result.json");
}
const tracePath = join(dirname(resultPath), "chrome-trace.json");
const result = JSON.parse(await readFile(resultPath, "utf8")) as BenchmarkResult;
if (result.schemaVersion !== 1 || result.method.tracingEnabled !== true) {
  throw new Error("Expected a schemaVersion 1 result recorded with BENCH_TRACE=1");
}
const trace = JSON.parse(await readFile(tracePath, "utf8")) as { traceEvents: TraceEvent[] };
const threads = new Map<string, string>();
const marks = new Map<string, TraceEvent>();
for (const event of trace.traceEvents) {
  if (event.ph === "M" && event.name === "thread_name" && event.args?.name !== undefined) {
    threads.set(`${event.pid}:${event.tid}`, event.args.name);
  }
  if (event.name.startsWith("benchmark:") && event.cat?.split(",").includes("blink.user_timing")) {
    if (marks.has(event.name)) throw new Error(`Duplicate phase mark: ${event.name}`);
    marks.set(event.name, event);
  }
}

const windows = result.windows.map(({ phase, measurement }) => {
  const mark = marks.get(`benchmark:${phase}`);
  if (mark === undefined) throw new Error(`Missing trace mark for ${phase}`);
  if (!Number.isFinite(measurement.durationMs) || measurement.durationMs <= 0) {
    throw new Error(`Invalid measurement duration for ${phase}`);
  }
  const markStartTime = mark.args?.data?.startTime;
  if (markStartTime === undefined || !Number.isFinite(markStartTime) ||
      !Number.isFinite(measurement.startedAtMs)) {
    throw new Error(`Missing browser clock alignment for ${phase}`);
  }
  const start = mark.ts + (measurement.startedAtMs - markStartTime) * 1000;
  const end = start + measurement.durationMs * 1000;
  const groups = new Map<string, { threadId: number; name: string; category: string; spans: Span[] }>();
  for (const event of trace.traceEvents) {
    // Complete slices only. Async begin/end records and CPU samples are not durations.
    if (event.ph !== "X" || event.pid !== mark.pid || event.dur === undefined || event.dur <= 0 ||
        event.ts >= end || event.ts + event.dur <= start) continue;
    const category = event.cat ?? "";
    const key = JSON.stringify([event.tid, category, event.name]);
    let group = groups.get(key);
    if (group === undefined) {
      group = { threadId: event.tid, name: event.name, category, spans: [] };
      groups.set(key, group);
    }
    group.spans.push({ start: Math.max(start, event.ts), end: Math.min(end, event.ts + event.dur) });
  }
  const events = [...groups.values()].map(({ threadId, name, category, spans }) => ({
    threadId,
    threadName: threads.get(`${mark.pid}:${threadId}`) ?? null,
    mainThread: threadId === mark.tid,
    name,
    category,
    ...summarize(spans),
  })).sort((left, right) => right.coveredMs - left.coveredMs);
  if (!events.some(event => event.mainThread)) throw new Error(`No main-thread complete slices for ${phase}`);
  return { phase, durationMs: measurement.durationMs, rendererProcessId: mark.pid, mainThreadId: mark.tid, events };
});

const outputPath = join(dirname(resultPath), "trace-summary.json");
await writeFile(outputPath, JSON.stringify({
  schemaVersion: 1,
  input: { resultPath, tracePath },
  source: result.source,
  environment: result.environment,
  workload: result.workload,
  validity: result.validity,
  method: {
    scope: "Renderer-process complete (X) trace slices, grouped by thread/category/name. Not an isolated JS profile, displayed FPS, or GPU-process execution time.",
    boundaries: "Phase mark's trace ts and browser startTime align the result's startedAtMs to the trace clock. Intersecting slices are clipped to the measurement window.",
    coverage: "coveredMs is the union of each group's clipped spans, avoiding nested same-name double counting. Different groups nest/overlap: NEVER add their times or treat them as exclusive CPU costs.",
    percentiles: "Nearest-rank durations of clipped slices, including nested slices; not per-frame totals. Missing event names mean no recorded slices, not proven zero work.",
    limitations: "Tracing perturbs timings. Canvas resource production may include deferred rasterization or backpressure; its name alone does not identify the native hotspot. Inspect the raw trace before optimizing.",
  },
  windows,
}, null, 2) + "\n");
console.log(outputPath);
for (const window of windows) {
  console.log(`\n${window.phase}: ${window.durationMs.toFixed(1)} ms window`);
  console.table(window.events.filter(event => event.mainThread).slice(0, 12).map(event => ({
    event: event.name, count: event.count,
    coveredMs: Number(event.coveredMs.toFixed(1)), p95Ms: Number(event.p95Ms.toFixed(1)),
    maxMs: Number(event.maxMs.toFixed(1)),
  })));
}
