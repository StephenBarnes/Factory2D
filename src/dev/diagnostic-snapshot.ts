import type { AppScreen } from "../game/screen";

export type DiagnosticDirection = "up" | "right" | "down" | "left";

export type DiagnosticSelectedTool =
  | { readonly kind: "weld" }
  | { readonly kind: "selection" }
  | { readonly kind: "editable-region" }
  | {
      readonly kind: "tile";
      readonly tileKind: string;
      readonly orientation: DiagnosticDirection;
    };

export interface DevelopmentDiagnosticSnapshot {
  readonly screen: AppScreen;
  readonly activePuzzleId: string | null;
  readonly activeSolutionId: string | null;
  readonly simulation: {
    readonly running: boolean;
    readonly tick: number;
    readonly editable: boolean;
    readonly puzzleResult: "in-progress" | "won" | "lost";
  };
  readonly selectedTool: DiagnosticSelectedTool;
  readonly hoveredCell: { readonly x: number; readonly y: number } | null;
  /** Displayed board: the root board at depth 0, or an entered rune array's inner board. */
  readonly view: {
    readonly depth: number;
    readonly width: number;
    readonly height: number;
    readonly editable: boolean;
  };
  readonly worldRevision: number;
  /** Root board, whichever rune array is currently displayed. */
  readonly serializedBoard: string;
}

export interface Factory2dDiagnostics {
  readonly snapshot: () => DevelopmentDiagnosticSnapshot;
}

declare global {
  interface Window {
    readonly factory2dDiagnostics?: Factory2dDiagnostics;
  }
}

function frozenSnapshot(
  snapshot: DevelopmentDiagnosticSnapshot,
): DevelopmentDiagnosticSnapshot {
  Object.freeze(snapshot.screen);
  Object.freeze(snapshot.simulation);
  Object.freeze(snapshot.selectedTool);
  Object.freeze(snapshot.view);
  if (snapshot.hoveredCell !== null) {
    Object.freeze(snapshot.hoveredCell);
  }
  return Object.freeze(snapshot);
}

export function installDevelopmentDiagnostics(
  getSnapshot: () => DevelopmentDiagnosticSnapshot,
): void {
  const diagnostics: Factory2dDiagnostics = Object.freeze({
    snapshot: () => frozenSnapshot(getSnapshot()),
  });
  Object.defineProperty(window, "factory2dDiagnostics", {
    configurable: true,
    enumerable: false,
    value: diagnostics,
    writable: false,
  });
}
