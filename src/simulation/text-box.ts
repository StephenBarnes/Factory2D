/** A board-space annotation, independent of tile identity and simulation state. */
export interface TextBox {
  readonly id: string;
  readonly centerX: number;
  readonly centerY: number;
  readonly text: string;
  readonly owner: "author" | "player";
}

export const MAX_TEXT_BOXES = 256;
export const MAX_TEXT_BOX_TEXT_LENGTH = 4_096;
export const MAX_TEXT_BOX_ID_LENGTH = 128;

const TEXT_BOX_FIELDS: Readonly<Record<string, true>> = {
  id: true, centerX: true, centerY: true, text: true, owner: true,
};

/** Validates untrusted scene data before any world state is changed. */
export function validateTextBoxes(
  value: unknown,
  boardWidth: number,
  boardHeight: number,
  label = "Text boxes",
): asserts value is readonly TextBox[] {
  if (!Array.isArray(value) || value.length > MAX_TEXT_BOXES) {
    throw new Error(`${label} must be an array of at most ${MAX_TEXT_BOXES} entries`);
  }
  const ids = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const box: unknown = value[index];
    const entryLabel = `${label}[${index}]`;
    if (typeof box !== "object" || box === null || Array.isArray(box)) {
      throw new Error(`${entryLabel} must be an object`);
    }
    const entry = box as Record<string, unknown>;
    for (const field of Object.keys(entry)) {
      if (!Object.hasOwn(TEXT_BOX_FIELDS, field)) {
        throw new Error(`${entryLabel} has unknown field "${field}"`);
      }
    }
    if (typeof entry.id !== "string" || entry.id.trim().length === 0 || entry.id.length > MAX_TEXT_BOX_ID_LENGTH) {
      throw new Error(`${entryLabel} id must be a nonblank string of at most ${MAX_TEXT_BOX_ID_LENGTH} characters`);
    }
    if (ids.has(entry.id)) {
      throw new Error(`${label} contains duplicate id "${entry.id}"`);
    }
    ids.add(entry.id);
    if (typeof entry.text !== "string" || entry.text.trim().length === 0 || entry.text.length > MAX_TEXT_BOX_TEXT_LENGTH) {
      throw new Error(`${entryLabel} text must be a nonblank string of at most ${MAX_TEXT_BOX_TEXT_LENGTH} characters`);
    }
    if (entry.owner !== "author" && entry.owner !== "player") {
      throw new Error(`${entryLabel} owner must be "author" or "player"`);
    }
    for (const field of ["centerX", "centerY"] as const) {
      if (typeof entry[field] !== "number" || !Number.isFinite(entry[field])) {
        throw new Error(`${entryLabel} ${field} must be a finite number`);
      }
    }
    const { centerX, centerY } = entry as unknown as TextBox;
    if (centerX < 0 || centerY < 0 || centerX > boardWidth || centerY > boardHeight) {
      throw new Error(`${entryLabel} center must fit within the board`);
    }
  }
}
