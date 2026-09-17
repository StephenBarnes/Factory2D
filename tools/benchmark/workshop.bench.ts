import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpus, platform, release, arch } from "node:os";
import { readFile, writeFile, open } from "node:fs/promises";
import { test, expect, type Page, type CDPSession } from "@playwright/test";
import { benchmarkFixtures } from "./fixtures";
import { installMeasurements, startMeasurement, finishMeasurement } from "./measurements";
import type { ReplayOptions } from "./isolated";

function integerOption(name: string, fallback: number, minimum: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer >= ${minimum}`);
  }
  return value;
}

const samples = integerOption("BENCH_SAMPLES", 120, 2);
const warmup = integerOption("BENCH_WARMUP", 15, 0);
const replayTicks = integerOption("BENCH_TICKS", 50, 1);
const replayRuns = integerOption("BENCH_RUNS", 3, 1);
const speed = integerOption("BENCH_SPEED", 5, 1);
const throttle = integerOption("BENCH_THROTTLE", 1, 1);
if (speed !== 5 && speed !== 60) throw new Error("BENCH_SPEED must be 5 or 60");
if (throttle !== 1 && throttle !== 4) throw new Error("BENCH_THROTTLE must be 1 or 4");
const view = process.env.BENCH_VIEW ?? "fitted";
if (view !== "fitted" && view !== "zoomed") throw new Error("BENCH_VIEW must be fitted or zoomed");
const animate = process.env.BENCH_ANIMATE ?? "1";
if (animate !== "1" && animate !== "0") throw new Error("BENCH_ANIMATE must be 1 or 0");
const captureTrace = process.env.BENCH_TRACE === "1";
const fixtures = benchmarkFixtures();
const requested = process.env.BENCH_FIXTURES?.split(",");
if (requested?.some((id) => !fixtures.some((fixture) => fixture.id === id))) {
  throw new Error(`Unknown BENCH_FIXTURES; choose from ${fixtures.map((fixture) => fixture.id).join(",")}`);
}
const selected = fixtures.filter((fixture) => requested === undefined || requested.includes(fixture.id));

async function sourceIdentity() {
  const git = (...args: string[]) => execFileSync("git", args);
  const patch = git("diff", "--binary", "HEAD");
  const untrackedPaths = git("ls-files", "--others", "--exclude-standard", "-z")
    .toString().split("\0").filter(Boolean).sort();
  const untracked = await Promise.all(untrackedPaths.map(async (path) => ({
    path, sha256: createHash("sha256").update(await readFile(path)).digest("hex"),
  })));
  return {
    revision: git("rev-parse", "HEAD").toString().trim(),
    dirty: patch.length > 0 || untracked.length > 0,
    trackedDiffSha256: createHash("sha256").update(patch).digest("hex"),
    untracked,
  };
}

async function startWindow(page: Page, phase: string): Promise<void> {
  await page.evaluate((name) => performance.mark(`benchmark:${name}`), phase);
  await startMeasurement(page);
}

async function frames(page: Page, count: number): Promise<void> {
  await page.evaluate((remaining) => new Promise<void>((resolve) => {
    if (remaining === 0) { resolve(); return; }
    const frame = () => {
      remaining -= 1;
      if (remaining === 0) resolve();
      else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }), count);
}

async function tick(page: Page): Promise<number> {
  const text = await page.locator("#tick-counter").innerText();
  const match = /^TICK (\d+)$/.exec(text);
  if (match?.[1] === undefined) throw new Error(`Unexpected tick counter: ${text}`);
  return Number(match[1]);
}

async function stopTrace(cdp: CDPSession, path: string): Promise<void> {
  const complete = new Promise<string>((resolve, reject) => {
    cdp.once("Tracing.tracingComplete", (event) => {
      if (event.stream === undefined) reject(new Error("Chrome trace has no stream"));
      else resolve(event.stream);
    });
  });
  await cdp.send("Tracing.end");
  const handle = await complete;
  const file = await open(path, "w");
  try {
    for (;;) {
      const part = await cdp.send("IO.read", { handle });
      await file.write(Buffer.from(part.data, part.base64Encoded ? "base64" : "utf8"));
      if (part.eof) break;
    }
  } finally {
    await file.close();
    await cdp.send("IO.close", { handle });
  }
}

for (const fixture of selected) {
  test(fixture.id, async ({ page, browser }, testInfo) => {
    const source = await sourceIdentity();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("dialog", async (dialog) => {
      errors.push(`${dialog.type()}: ${dialog.message()}`);
      await dialog.dismiss();
    });
    await page.addInitScript(() => {
      localStorage.setItem("factory2d.sounds", "false");
    });
    const browserCdp = await browser.newBrowserCDPSession();
    const graphics = await browserCdp.send("SystemInfo.getInfo");
    await browserCdp.detach();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
    await page.goto("/#/sandbox");
    await page.locator("#new-sandbox-button").click();
    await expect(page).toHaveURL(/\/#\/sandbox\/sandbox-\d+$/);
    await installMeasurements(page);
    const windows: { phase: string; measurement: unknown; actionToTwoRafsMs?: number }[] = [];
    let tracing = false;
    try {
      if (captureTrace) {
        await cdp.send("Tracing.start", {
          categories: "devtools.timeline,v8,blink,blink.user_timing,cc,gpu,disabled-by-default-v8.cpu_profiler,disabled-by-default-devtools.timeline",
          transferMode: "ReturnAsStream",
        });
        tracing = true;
      }
      const storedBefore = await page.evaluate(() => localStorage.getItem("factory2d.saved-sandboxes"));
      await startWindow(page, "first-fixture-import");
      const importStart = performance.now();
      await page.locator("#import-file").setInputFiles({
        name: `${fixture.id}.json`, mimeType: "application/json", buffer: Buffer.from(fixture.scene),
      });
      await page.waitForFunction((before) => localStorage.getItem("factory2d.saved-sandboxes") !== before, storedBefore);
      await frames(page, 2);
      windows.push({ phase: "first-fixture-import", actionToTwoRafsMs: performance.now() - importStart,
        measurement: await finishMeasurement(page) });
      expect(errors).toEqual([]);
      expect(await tick(page)).toBe(0);
      await page.locator("#animation-toggle").setChecked(animate === "1");
      await page.locator("#speed-button").click();
      await page.locator(`[data-speed="${speed}"]`).click();
      if (view === "zoomed") {
        const bounds = await page.locator("#game-canvas").boundingBox();
        if (bounds === null) throw new Error("Canvas has no bounds");
        await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
        // Request 8x center zoom; the application's maximum cell size may clamp it.
        await page.mouse.wheel(0, -Math.log(8) / 0.0015);
        await frames(page, 2);
      }
      // Keep hover/cursor overlays out of both idle and active windows.
      await page.mouse.move(0, 0);
      await frames(page, warmup);
      await startWindow(page, "unchanged-idle");
      await frames(page, samples + 1);
      windows.push({ phase: "unchanged-idle", measurement: await finishMeasurement(page) });

      await startWindow(page, "first-manual-step");
      const stepStart = performance.now();
      await page.locator("#step-button").click();
      await expect(page.locator("#tick-counter")).toHaveText("TICK 0001");
      await frames(page, 2);
      windows.push({ phase: "first-manual-step", actionToTwoRafsMs: performance.now() - stepStart,
        measurement: await finishMeasurement(page) });
      await page.locator("#play-button").click();
      await page.mouse.move(0, 0);
      await frames(page, warmup);
      const initialTick = await tick(page);
      await startWindow(page, "retained-active");
      if (fixture.id === "geode") {
        await page.waitForFunction((target) => {
          const text = document.getElementById("tick-counter")?.textContent ?? "";
          const match = /^TICK (\d+)$/.exec(text);
          return match?.[1] !== undefined && Number(match[1]) >= target;
        }, initialTick + replayTicks, { polling: "raf", timeout: 120_000 });
      } else {
        await frames(page, samples + 1);
      }
      windows.push({ phase: "retained-active", measurement: await finishMeasurement(page) });
      const finalTick = await tick(page);
      await page.locator("#play-button").click();
      const invalidReasons = [...errors];
      if (finalTick <= initialTick) invalidReasons.push("No active simulation ticks advanced");
      if (fixture.id === "geode" && finalTick - initialTick < replayTicks) {
        invalidReasons.push("Geode workshop window did not advance the requested ticks");
      }
      if (fixture.metadata.continuousMotionTickLimit !== null &&
          finalTick >= fixture.metadata.continuousMotionTickLimit) {
        invalidReasons.push("Falling fixture settled: reduce sample/warmup counts");
      }
      await page.screenshot({ path: testInfo.outputPath("workshop.png") });
      let isolated;
      if (fixture.id === "geode") {
        const bounds = await page.locator("#game-canvas").boundingBox();
        if (bounds === null) throw new Error("Canvas has no bounds");
        await page.goto("/benchmark/");
        await page.waitForFunction(() => typeof window.runSceneBenchmark === "function");
        const options: ReplayOptions = {
          scene: fixture.scene, ticks: replayTicks, runs: replayRuns,
          cssWidth: bounds.width, cssHeight: bounds.height,
          speed, animate: animate === "1", zoomed: view === "zoomed",
        };
        isolated = await page.evaluate((options) => window.runSceneBenchmark(options), options);
        await page.screenshot({ path: testInfo.outputPath("isolated.png") });
        expect(errors, "Isolated replay browser errors").toEqual([]);
        for (const run of isolated.runs) {
          console.log(`${fixture.id} replay ${run.run}: ${run.finalTick} ticks; ` +
            `step-only total ${run.simulationOnly.step.totalMs.toFixed(1)} ms; ` +
            `render p50/p95 ${run.rendered.render.p50Ms.toFixed(1)}/${run.rendered.render.p95Ms.toFixed(1)} ms; ` +
            `RAF p95 ${run.rendered.rafCadence.p95Ms.toFixed(1)} ms`);
        }
      }
      const result = {
        schemaVersion: 1,
        recordedAt: new Date().toISOString(),
        validity: { valid: invalidReasons.length === 0, reasons: invalidReasons },
        source,
        environment: {
          buildMode: "production", browser: browser.version(), headless: process.env.BENCH_HEADED !== "1",
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? "playwright-managed",
          host: { platform: platform(), release: release(), arch: arch(), cpu: cpus()[0]?.model ?? null, logicalCpus: cpus().length },
          cpuThrottleRate: throttle, lowEndCertification: false,
          graphics: graphics.gpu, viewport: page.viewportSize(),
        },
        workload: { id: fixture.id, sceneSha256: createHash("sha256").update(fixture.scene).digest("hex"),
          ...fixture.metadata, metadataScope: "initial root board", view, requestedZoomFactor: view === "zoomed" ? 8 : 1,
          ticksPerSecond: speed, animations: animate === "1", initialTick, finalTick },
        method: {
          requestedFrameIntervals: samples, warmupRafs: warmup,
          activeWindow: fixture.id === "geode"
            ? { unit: "ticks", requested: replayTicks }
            : { unit: "frame-intervals", requested: samples },
          percentile: "nearest-rank: sorted[ceil(p*n)-1]", tracingEnabled: captureTrace,
          scope: "Real workshop RAF cadence, long tasks and Event Timing; not isolated calls or displayed FPS",
          coldScope: "First fixture import and simulation step in a fresh browser context, after shell/palette startup; not a cold browser/JIT distribution",
          retainedScope: "Same mounted session after first step and RAF warmup; no reload/reset/forced GC",
          latencyScope: "Host action start through automation, import persistence or tick-label observation, and two RAF callbacks; not input-to-photon latency",
          limitations: ["Workshop windows have no isolated tick/frame phase instrumentation; geode adds a separate replay",
            "No total retained-memory measurement",
            "No hardware-GPU or low-end guarantee; inspect graphics backend", "Tracing/profiling changes timings; compare untraced runs",
            "Small puzzle scene runs in sandbox, not automatic puzzle verification"],
        },
        windows,
        isolated,
      };
      await writeFile(testInfo.outputPath("result.json"), JSON.stringify(result, null, 2) + "\n");
      expect(invalidReasons, "Benchmark workload validity").toEqual([]);
    } finally {
      if (tracing) await stopTrace(cdp, testInfo.outputPath("chrome-trace.json"));
      await cdp.detach();
    }
  });
}
