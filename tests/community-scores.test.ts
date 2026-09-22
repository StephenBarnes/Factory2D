import type { D1Database } from "@cloudflare/workers-types";

import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { expect, it, vi } from "vitest";

import worker from "../backend/worker";
import { CommunityClient } from "../src/game/community-client";
import { puzzleById } from "../src/game/puzzles";
import { SavedSolutionController } from "../src/game/saved-solution-controller";
import { bestPuzzleScores } from "../src/game/score-histogram";
import { expectDefined } from "../src/util/assert";

it("uploads mixed saved-solution minima and retains actual combined scores in community histograms", async () => {
  const database = new DatabaseSync(":memory:");
  database.exec(readFileSync(new URL("../backend/migrations/0001_community.sql", import.meta.url), "utf8"));
  // Execute the Worker's real SQL against SQLite; only the D1 transport is adapted.
  const db = {
    prepare(sql: string) {
      const statement = database.prepare(sql);
      return {
        bind(...values: SQLInputValue[]) {
          return {
            async run() { return statement.run(...values); },
            async all() { return { results: statement.all(...values) }; },
          };
        },
      };
    },
  } as unknown as D1Database;
  vi.stubGlobal("fetch", (input: string, init?: RequestInit) => worker.fetch(new Request(input, init), { DB: db }));
  try {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    };
    const client = new CommunityClient("https://community.example", "00000000-0000-4000-8000-000000000001", storage);
    const puzzle = puzzleById("copperworks");
    const baseline = puzzle.createInitialWorld();
    const saved = new SavedSolutionController(storage);
    // Synthetic complete scores reproduce the reported 152/55 -> 151/50 minima.
    const old = { price: 152, cycles: 20.5, footprint: 55, combined: 227.5 };
    const active = saved.create(puzzle);
    saved.recordTestResult(active.id, baseline, old);
    await client.submitScores(puzzle.id, old);
    for (const scores of [
      { price: 151, cycles: 40.5, footprint: 60, combined: 251.5 },
      { price: 170, cycles: 30.5, footprint: 50, combined: 250.5 },
    ]) {
      const solution = saved.create(puzzle);
      saved.recordTestResult(solution.id, baseline, scores);
    }
    saved.create(puzzle); // An unconfirmed design contributes no scores.

    const restored = new SavedSolutionController(storage);
    const previousBest = bestPuzzleScores(restored.forPuzzle(puzzle.id).map((solution) => solution.scores));
    const current = { price: 160, cycles: 10.5, footprint: 60, combined: 230.5 };
    restored.recordTestResult(active.id, baseline, current);
    const submission = expectDefined(bestPuzzleScores([previousBest, current]) ?? undefined, "Missing submission scores");
    await client.submitScores(puzzle.id, submission);
    await client.submitScores(puzzle.id, current); // A later run must not regress saved minima or add a player.

    const histograms = await client.histograms(puzzle.id);
    expect(histograms.players).toBe(1);
    expect(histograms.metrics).toEqual({
      price: [{ value: 151, count: 1 }],
      cycles: [{ value: 10.5, count: 1 }],
      footprint: [{ value: 50, count: 1 }],
      combined: [{ value: 227.5, count: 1 }],
    });
    await expect(client.submitScores(puzzle.id, { ...submission, combined: 211 })).rejects.toThrow("HTTP 400");
    expect((await client.histograms(puzzle.id)).metrics).toEqual(histograms.metrics);
  } finally {
    vi.unstubAllGlobals();
    database.close();
  }
});
