import type { Page } from "@playwright/test";

interface SampleSummary {
  readonly count: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly maxMs: number;
}

interface ObserverSupport {
  readonly supported: boolean;
  readonly unavailableReason: string | null;
}

interface WorkshopSnapshot {
  readonly canvas: {
    readonly cssWidth: number;
    readonly cssHeight: number;
    readonly backingWidth: number;
    readonly backingHeight: number;
  };
  readonly devicePixelRatio: number;
  readonly tickCounterText: string;
  readonly visibilityState: DocumentVisibilityState;
}

interface TimedEntry {
  readonly name: string;
  readonly startTimeMs: number;
  readonly durationMs: number;
}

interface BrowserEventEntry extends TimedEntry {
  readonly interactionId: number | null;
  readonly processingStartMs: number | null;
  readonly processingEndMs: number | null;
  readonly cancelable: boolean | null;
}

interface MeasurementResult {
  readonly startedAtMs: number;
  readonly finishedAtMs: number;
  readonly durationMs: number;
  readonly percentileMethod: "nearest-rank";
  readonly observerWindowPolicy: string;
  readonly initial: WorkshopSnapshot;
  readonly final: WorkshopSnapshot;
  readonly rafCadence: {
    readonly interpretation: string;
    readonly timestampsMs: readonly number[];
    readonly intervalsMs: readonly number[];
    readonly count: number;
    readonly summary: SampleSummary | null;
  };
  readonly longTasks: {
    readonly support: ObserverSupport;
    readonly entries: readonly TimedEntry[] | null;
    readonly count: number | null;
    readonly summary: SampleSummary | null;
    readonly totalDurationMs: number | null;
  };
  readonly browserEventTiming: {
    readonly interpretation: string;
    readonly support: ObserverSupport;
    readonly durationThresholdMs: number;
    readonly entries: readonly BrowserEventEntry[] | null;
    readonly count: number | null;
    readonly summary: SampleSummary | null;
  };
}

interface MeasurementCollector {
  start(): void;
  finish(): MeasurementResult;
  dispose(): void;
}

declare global {
  interface Window {
    __factory2dBenchmarkMeasurements?: MeasurementCollector;
  }
}

/** Install only after navigation; this namespace never exists in the production bundle. */
export async function installMeasurements(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__factory2dBenchmarkMeasurements?.dispose();
    delete window.__factory2dBenchmarkMeasurements;

    function snapshot(): WorkshopSnapshot {
      const canvas = document.getElementById("game-canvas");
      const tickCounter = document.getElementById("tick-counter");
      if (!(canvas instanceof HTMLCanvasElement)) {
        throw new Error("Workshop benchmark requires #game-canvas to be a canvas");
      }
      if (!(tickCounter instanceof HTMLElement) || !tickCounter.textContent?.trim()) {
        throw new Error("Workshop benchmark requires a nonempty #tick-counter label");
      }
      const bounds = canvas.getBoundingClientRect();
      return {
        canvas: {
          cssWidth: bounds.width,
          cssHeight: bounds.height,
          backingWidth: canvas.width,
          backingHeight: canvas.height,
        },
        devicePixelRatio: window.devicePixelRatio,
        tickCounterText: tickCounter.textContent,
        visibilityState: document.visibilityState,
      };
    }

    // Validate the actual workshop DOM before claiming that collection is installed.
    snapshot();
    let active = false;
    let startedAtMs = 0;
    let initial: WorkshopSnapshot | null = null;
    let rafRequest: number | null = null;
    let timestampsMs: number[] = [];
    let longTaskEntries: PerformanceEntry[] = [];
    let eventEntries: PerformanceEntry[] = [];

    function observerSupport(type: string): ObserverSupport {
      if (typeof PerformanceObserver === "undefined") {
        return { supported: false, unavailableReason: "PerformanceObserver is unavailable" };
      }
      if (!PerformanceObserver.supportedEntryTypes.includes(type)) {
        return { supported: false, unavailableReason: `${type} entries are unsupported` };
      }
      return { supported: true, unavailableReason: null };
    }

    let longTaskSupport = observerSupport("longtask");
    let eventSupport = observerSupport("event");
    const longTaskObserver = longTaskSupport.supported
      ? new PerformanceObserver((list) => {
          if (active) {
            for (const entry of list.getEntries()) longTaskEntries.push(entry);
          }
        })
      : null;
    const eventObserver = eventSupport.supported
      ? new PerformanceObserver((list) => {
          if (active) {
            for (const entry of list.getEntries()) eventEntries.push(entry);
          }
        })
      : null;

    function connectObserver(
      observer: PerformanceObserver | null,
      support: ObserverSupport,
      options: PerformanceObserverInit & { durationThreshold?: number },
    ): ObserverSupport {
      if (observer === null) return support;
      try {
        // Never use buffered:true: each window observes only newly generated entries.
        observer.observe(options);
        return { supported: true, unavailableReason: null };
      } catch (error) {
        observer.disconnect();
        return {
          supported: false,
          unavailableReason: `Observation failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    // One callback is reused for every frame and every window. Summarize only after stopping.
    function onFrame(timestamp: number): void {
      if (!active) return;
      // A RAF timestamp can precede performance.now() from a start within the same frame.
      if (timestamp >= startedAtMs) timestampsMs.push(timestamp);
      rafRequest = requestAnimationFrame(onFrame);
    }

    function stop(): void {
      active = false;
      if (rafRequest !== null) cancelAnimationFrame(rafRequest);
      rafRequest = null;
      longTaskObserver?.disconnect();
      eventObserver?.disconnect();
    }

    function summarize(values: readonly number[]): SampleSummary | null {
      if (values.length === 0) return null;
      const sorted = [...values].sort((left, right) => left - right);
      const p50Ms = sorted[Math.ceil(sorted.length * 0.5) - 1];
      const p95Ms = sorted[Math.ceil(sorted.length * 0.95) - 1];
      const maxMs = sorted[sorted.length - 1];
      if (p50Ms === undefined || p95Ms === undefined || maxMs === undefined) {
        throw new Error("Nonempty measurement samples must have percentile values");
      }
      return { count: sorted.length, p50Ms, p95Ms, maxMs };
    }

    function timedEntry(entry: PerformanceEntry): TimedEntry {
      return { name: entry.name, startTimeMs: entry.startTime, durationMs: entry.duration };
    }

    function browserEvent(entry: PerformanceEntry): BrowserEventEntry {
      // Some engines expose Event Timing but not every optional timing/interaction field.
      const event = entry as PerformanceEntry & {
        interactionId?: number;
        processingStart?: number;
        processingEnd?: number;
        cancelable?: boolean;
      };
      return {
        ...timedEntry(entry),
        interactionId: event.interactionId ?? null,
        processingStartMs: event.processingStart ?? null,
        processingEndMs: event.processingEnd ?? null,
        cancelable: event.cancelable ?? null,
      };
    }

    window.__factory2dBenchmarkMeasurements = {
      start(): void {
        if (active) throw new Error("A workshop measurement is already running");
        initial = snapshot();
        timestampsMs = [];
        longTaskEntries = [];
        eventEntries = [];
        longTaskSupport = connectObserver(longTaskObserver, longTaskSupport, { type: "longtask" });
        eventSupport = connectObserver(eventObserver, eventSupport, {
          type: "event",
          durationThreshold: 16,
        });
        startedAtMs = performance.now();
        active = true;
        rafRequest = requestAnimationFrame(onFrame);
      },
      finish(): MeasurementResult {
        if (!active || initial === null) {
          throw new Error("No workshop measurement is running");
        }
        const finishedAtMs = performance.now();
        // takeRecords must precede disconnect, which discards undelivered entries.
        if (longTaskObserver !== null) {
          for (const entry of longTaskObserver.takeRecords()) longTaskEntries.push(entry);
        }
        if (eventObserver !== null) {
          for (const entry of eventObserver.takeRecords()) eventEntries.push(entry);
        }
        stop();
        const final = snapshot();
        const inWindow = (entry: PerformanceEntry): boolean =>
          entry.startTime >= startedAtMs && entry.startTime < finishedAtMs;
        const longTasks = longTaskSupport.supported
          ? longTaskEntries.filter(inWindow).map(timedEntry)
          : null;
        const browserEvents = eventSupport.supported
          ? eventEntries.filter(inWindow).map(browserEvent)
          : null;
        const intervalsMs: number[] = [];
        let previousTimestamp: number | null = null;
        for (const timestamp of timestampsMs) {
          if (previousTimestamp !== null) intervalsMs.push(timestamp - previousTimestamp);
          previousTimestamp = timestamp;
        }
        return {
          startedAtMs,
          finishedAtMs,
          durationMs: finishedAtMs - startedAtMs,
          percentileMethod: "nearest-rank",
          observerWindowPolicy:
            "Entries whose startTime is in [startedAtMs, finishedAtMs), delivered or queued by finish. Durations are not clipped. Entries not yet queued at finish are unavailable, including events awaiting presentation.",
          initial,
          final,
          rafCadence: {
            interpretation: "Consecutive browser RAF timestamp intervals, not displayed FPS or isolated render duration.",
            timestampsMs,
            intervalsMs,
            count: intervalsMs.length,
            summary: summarize(intervalsMs),
          },
          longTasks: {
            support: longTaskSupport,
            entries: longTasks,
            count: longTasks === null ? null : longTasks.length,
            summary: longTasks === null ? null : summarize(longTasks.map((entry) => entry.durationMs)),
            totalDurationMs: longTasks === null ? null : longTasks.reduce((sum, entry) => sum + entry.durationMs, 0),
          },
          browserEventTiming: {
            interpretation: "Browser Event Timing above the requested threshold, not end-to-end Playwright action latency or a full INP measurement. Durations may be quantized; zero interaction IDs are non-interaction entries.",
            support: eventSupport,
            durationThresholdMs: 16,
            entries: browserEvents,
            count: browserEvents === null ? null : browserEvents.length,
            summary: browserEvents === null ? null : summarize(browserEvents.map((entry) => entry.durationMs)),
          },
        };
      },
      dispose(): void {
        stop();
        timestampsMs = [];
        longTaskEntries = [];
        eventEntries = [];
        initial = null;
      },
    };
  });
}

export async function startMeasurement(page: Page): Promise<void> {
  await page.evaluate(() => {
    const collector = window.__factory2dBenchmarkMeasurements;
    if (collector === undefined) throw new Error("Workshop measurements are not installed");
    collector.start();
  });
}

export async function finishMeasurement(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    const collector = window.__factory2dBenchmarkMeasurements;
    if (collector === undefined) throw new Error("Workshop measurements are not installed");
    return collector.finish();
  });
}
