import { isPuzzleUnlocked, PUZZLES } from "./puzzles";
import type { PuzzleId } from "./puzzles";
import type { AppScreen } from "./screen";

export interface AppRouteAccess {
  readonly completedPuzzleIds: ReadonlySet<PuzzleId>;
  readonly allPuzzlesUnlocked: boolean;
  readonly solutionExists: (puzzleId: PuzzleId, solutionId: string) => boolean;
  readonly sandboxExists: (sandboxId: string) => boolean;
}

export function appScreenPath(screen: AppScreen): string {
  switch (screen.kind) {
    case "main-menu":
      return "/";
    case "sandbox-info":
      return "/sandbox";
    case "sandbox":
      return `/sandbox/${encodeURIComponent(screen.sandboxId)}`;
    case "puzzle-info":
      return `/puzzles/${encodeURIComponent(screen.puzzleId)}`;
    case "puzzle":
      return `/puzzles/${encodeURIComponent(screen.puzzleId)}/solutions/${encodeURIComponent(screen.solutionId)}`;
  }
}

export function resolveAppScreen(screen: AppScreen, access: AppRouteAccess): AppScreen {
  if (screen.kind === "main-menu" || screen.kind === "sandbox-info") {
    return screen;
  }
  if (screen.kind === "sandbox") {
    return access.sandboxExists(screen.sandboxId) ? screen : { kind: "sandbox-info" };
  }

  const puzzle = PUZZLES.find((candidate) => candidate.id === screen.puzzleId);
  if (
    puzzle === undefined ||
    (!access.allPuzzlesUnlocked && !isPuzzleUnlocked(puzzle, access.completedPuzzleIds))
  ) {
    return { kind: "main-menu" };
  }
  if (
    screen.kind === "puzzle" &&
    !access.solutionExists(screen.puzzleId, screen.solutionId)
  ) {
    return { kind: "puzzle-info", puzzleId: screen.puzzleId };
  }
  return screen;
}

export function resolveAppPath(pathname: string, access: AppRouteAccess): AppScreen {
  const segments = pathSegments(pathname);
  if (segments === null) {
    return { kind: "main-menu" };
  }
  if (segments.length === 0) {
    return { kind: "main-menu" };
  }
  if (segments[0] === "sandbox") {
    if (segments.length === 1) {
      return { kind: "sandbox-info" };
    }
    if (segments.length === 2) {
      const sandboxId = segments[1];
      if (sandboxId === undefined || sandboxId.length === 0) {
        return { kind: "sandbox-info" };
      }
      return resolveAppScreen({ kind: "sandbox", sandboxId }, access);
    }
    return { kind: "main-menu" };
  }
  if (segments.length !== 2 && segments.length !== 4) {
    return { kind: "main-menu" };
  }
  if (segments[0] !== "puzzles") {
    return { kind: "main-menu" };
  }

  const puzzle = PUZZLES.find((candidate) => candidate.id === segments[1]);
  if (puzzle === undefined) {
    return { kind: "main-menu" };
  }
  if (segments.length === 2) {
    return resolveAppScreen({ kind: "puzzle-info", puzzleId: puzzle.id }, access);
  }
  if (segments[2] !== "solutions") {
    return { kind: "main-menu" };
  }

  const solutionId = segments[3];
  if (solutionId === undefined || solutionId.length === 0) {
    return resolveAppScreen({ kind: "puzzle-info", puzzleId: puzzle.id }, access);
  }
  return resolveAppScreen(
    { kind: "puzzle", puzzleId: puzzle.id, solutionId },
    access,
  );
}

function pathSegments(pathname: string): readonly string[] | null {
  if (!pathname.startsWith("/")) {
    return null;
  }
  const normalized = pathname.length > 1 && pathname.endsWith("/")
    ? pathname.slice(0, -1)
    : pathname;
  const encodedSegments = normalized.slice(1).split("/");
  if (encodedSegments.length === 1 && encodedSegments[0] === "") {
    return [];
  }
  if (encodedSegments.some((segment) => segment.length === 0)) {
    return null;
  }

  try {
    return encodedSegments.map((segment) => decodeURIComponent(segment));
  } catch {
    return null;
  }
}
