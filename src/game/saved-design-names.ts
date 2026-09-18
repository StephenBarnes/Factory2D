import { expectDefined } from "../util/assert";

export function nextDesignName(names: readonly string[], label: string): string {
  let number = 1;
  while (names.some((name) => {
    const candidate = `${label} ${number}`;
    return name === candidate
      || (name.startsWith(candidate)
        && /^[a-z]*\.\d+(?:[a-z]+\.\d+)*$/.test(name.slice(candidate.length)));
  })) {
    number += 1;
  }
  return `${label} ${number}`;
}

export function duplicateDesignName(names: readonly string[], source: string): string {
  const suffix = /\.(\d+)$/.exec(source);
  const baseName = suffix === null ? source : source.slice(0, suffix.index);
  const copyNumber = suffix === null
    ? 1n
    : BigInt(expectDefined(suffix[1], "Design revision suffix is missing")) + 1n;
  if (!hasRevision(names, baseName, copyNumber)) return `${baseName}.${copyNumber}`;

  let branchIndex = 0;
  let branchName = `${source}${branchLetters(branchIndex)}`;
  while (hasRevision(names, branchName, 1n)) {
    branchIndex += 1;
    branchName = `${source}${branchLetters(branchIndex)}`;
  }
  return `${branchName}.1`;
}

// A later revision or a nested branch also reserves its missing ancestors.
function hasRevision(names: readonly string[], baseName: string, minimum: bigint): boolean {
  const prefix = `${baseName}.`;
  return names.some((name) => {
    if (!name.startsWith(prefix)) return false;
    const suffix = /^(\d+)(?:[a-z]+\.\d+)*$/.exec(name.slice(prefix.length));
    return suffix !== null
      && BigInt(expectDefined(suffix[1], "Design revision suffix is missing")) >= minimum;
  });
}

function branchLetters(index: number): string {
  let letters = "";
  do {
    letters = String.fromCharCode(97 + index % 26) + letters;
    index = Math.floor(index / 26) - 1;
  } while (index >= 0);
  return letters;
}
