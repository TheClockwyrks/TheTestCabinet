// Orrery — the two JSON documents the game speaks, as types and as builders.
// CASE-PROVIDED, and the SAME FILE in all three engine projects.
//
// `specs/formats.md` fixes both: a CHALLENGE states a puzzle and a SOLUTION
// states a machine, and `specs/instrumentation.md`'s `loadChallenge`,
// `loadSolution`, `readSolution` and `referenceSolution` all speak them. So a
// check needs three things of this module, and they are its three sections:
//
//   - the SHAPES, so a document a suite hands the build and a document the build
//     hands back are the same type;
//   - the BUILDERS, so a fixture reads as the shape it poses rather than as a
//     wall of braces;
//   - the WELL-FORMEDNESS RULES, so a check that asks a build to refuse a
//     malformed document knows what makes one malformed, and a check that reads
//     `readSolution` back can say whether the document is legal for the challenge
//     it belongs to.
//
// The rules are `specs/formats.md`'s, restated once here and nowhere else.
// Nothing in this module reads a build.

import {
  CONSTELLATION_TARGET,
  INSTRUCTIONS,
  MOTES,
  NAME_MAX,
  PARTS,
  TRAY_MAX,
  type InstructionName,
  type MoteName,
  type PartName,
} from "./constants";
import { adjacent, at, sameHex, type Hex } from "./field";

/* -------------------------------------------------------------------------- */
/* The shapes                                                                 */
/* -------------------------------------------------------------------------- */

/** One mote of a molecule pattern, on a relative hex. */
export interface PatternMote {
  q: number;
  r: number;
  type: MoteName;
}

/** One filament of a molecule pattern, between two of its pattern hexes. */
export interface PatternFilament {
  a: Hex;
  b: Hex;
  weight: number;
}

/** How a repeating product chains one copy of its pattern to the next. */
export interface Repeat {
  vector: Hex;
  link: PatternFilament;
}

/** A molecule pattern: motes on relative hexes, and the filaments between them. */
export interface Molecule {
  motes: PatternMote[];
  filaments: PatternFilament[];
  /** Repeating products alone; absent otherwise, and `null` reads as absent. */
  repeat?: Repeat | null;
}

/** A challenge document, exactly as `specs/formats.md` writes one. */
export interface Challenge {
  name: string;
  reagents: Molecule[];
  products: Molecule[];
  permitted: PartName[];
  target: number;
}

/**
 * One part of a solution document. Which keys a part carries varies by class
 * (`specs/formats.md`, the table under Solutions), so every key but `kind` is
 * optional here and the checker below is what says which are required for which
 * kind.
 */
export interface SolutionPart {
  kind: PartName;
  q?: number;
  r?: number;
  rotation?: number;
  length?: number;
  cells?: Hex[];
  closed?: boolean;
  index?: number;
  tape?: (InstructionName | null)[];
}

/** A solution document: a machine for a challenge. */
export interface Solution {
  parts: SolutionPart[];
}

/* -------------------------------------------------------------------------- */
/* The builders                                                               */
/* -------------------------------------------------------------------------- */

/** One pattern mote. */
export function mote(q: number, r: number, type: MoteName): PatternMote {
  return { q, r, type };
}

/** One pattern filament, of `weight` `1` unless another is named. */
export function link(a: Hex, b: Hex, weight = 1): PatternFilament {
  return { a, b, weight };
}

/** A molecule pattern. */
export function molecule(
  motes: readonly PatternMote[],
  filaments: readonly PatternFilament[] = [],
  repeat: Repeat | null = null,
): Molecule {
  const built: Molecule = {
    motes: motes.map((entry) => ({ ...entry })),
    filaments: filaments.map((entry) => ({
      a: { ...entry.a },
      b: { ...entry.b },
      weight: entry.weight,
    })),
  };
  if (repeat !== null) built.repeat = repeat;
  return built;
}

/** The one-mote molecule most scenarios pose a rise or a set with. */
export function loneMote(type: MoteName): Molecule {
  return molecule([mote(0, 0, type)]);
}

/** A two-mote molecule joined east by one filament of `weight`. */
export function pair(a: MoteName, b: MoteName, weight = 1): Molecule {
  return molecule(
    [mote(0, 0, a), mote(1, 0, b)],
    [link(at(0, 0), at(1, 0), weight)],
  );
}

/** A challenge document. `target` defaults to `CONSTELLATION_TARGET` (`6`). */
export function challenge(fields: {
  name: string;
  reagents: readonly Molecule[];
  products: readonly Molecule[];
  permitted: readonly PartName[];
  target?: number;
}): Challenge {
  return {
    name: fields.name,
    reagents: fields.reagents.map((entry) => structuredClone(entry)),
    products: fields.products.map((entry) => structuredClone(entry)),
    permitted: [...fields.permitted],
    target: fields.target ?? CONSTELLATION_TARGET,
  };
}

/** A solution document. */
export function solution(parts: readonly SolutionPart[]): Solution {
  return { parts: parts.map((part) => structuredClone(part)) };
}

/** An arm, a piston, or a wheel: an anchor, a rotation, a length, and a tape. */
export function armPart(
  kind: PartName,
  q: number,
  r: number,
  rotation = 0,
  length = 1,
  tape: readonly (InstructionName | null)[] = [],
): SolutionPart {
  return { kind, q, r, rotation, length, tape: [...tape] };
}

/** A transforming sigil: an anchor and a rotation. */
export function sigilPart(
  kind: PartName,
  q: number,
  r: number,
  rotation = 0,
): SolutionPart {
  return { kind, q, r, rotation };
}

/** A track: its path in order, and whether the editor joined it into a loop. */
export function trackPart(cells: readonly Hex[], closed = false): SolutionPart {
  return { kind: "track", cells: cells.map((cell) => ({ ...cell })), closed };
}

/** The rise for reagent `index`. */
export function risePart(
  index: number,
  q: number,
  r: number,
  rotation = 0,
): SolutionPart {
  return { kind: "rise", index, q, r, rotation };
}

/** The set for product `index`. */
export function setPart(
  index: number,
  q: number,
  r: number,
  rotation = 0,
): SolutionPart {
  return { kind: "set", index, q, r, rotation };
}

/* -------------------------------------------------------------------------- */
/* Well-formedness                                                            */
/* -------------------------------------------------------------------------- */

/** The kinds a challenge's `permitted` may name: `PARTS` up to and including `void`. */
export const PERMITTED_KINDS: readonly PartName[] = PARTS.slice(
  0,
  PARTS.indexOf("void") + 1,
);

function faultIn(list: readonly (string | null)[]): string | null {
  return list.find((entry) => entry !== null) ?? null;
}

/**
 * Why a molecule pattern is not well formed, or `null` when it is
 * (`specs/formats.md`, Molecules).
 *
 * `repeating` says whether a `repeat` is permitted: it "appears on repeating
 * products alone, and is absent otherwise".
 */
export function moleculeFault(
  value: Molecule,
  repeating: boolean,
): string | null {
  if (value.motes.length === 0) return "`motes` is non-empty";
  for (const entry of value.motes) {
    if (!(MOTES as readonly string[]).includes(entry.type)) {
      return `each mote's \`type\` is a member of MOTES, not ${JSON.stringify(entry.type)}`;
    }
  }
  for (let a = 0; a < value.motes.length; a += 1) {
    for (let b = a + 1; b < value.motes.length; b += 1) {
      const left = value.motes[a] as PatternMote;
      const right = value.motes[b] as PatternMote;
      if (left.q === right.q && left.r === right.r) {
        return "no two mote entries share a hex";
      }
    }
  }

  const holds = (hex: Hex): boolean =>
    value.motes.some((entry) => entry.q === hex.q && entry.r === hex.r);
  for (const filament of value.filaments) {
    if (!holds(filament.a) || !holds(filament.b)) {
      return "each filament joins two mote hexes of this molecule";
    }
    if (sameHex(filament.a, filament.b))
      return "a filament joins two DISTINCT hexes";
    if (!adjacent(filament.a, filament.b)) {
      return "a filament's two hexes are adjacent";
    }
    if (filament.weight !== 1 && filament.weight !== 3) {
      return "a filament's `weight` is 1 or 3";
    }
  }
  for (let a = 0; a < value.filaments.length; a += 1) {
    for (let b = a + 1; b < value.filaments.length; b += 1) {
      const left = value.filaments[a] as PatternFilament;
      const right = value.filaments[b] as PatternFilament;
      const same =
        (sameHex(left.a, right.a) && sameHex(left.b, right.b)) ||
        (sameHex(left.a, right.b) && sameHex(left.b, right.a));
      if (same) return "no pair of motes appears twice in `filaments`";
    }
  }
  if (!connected(value)) {
    return "every molecule pattern is connected: one constellation";
  }

  const repeat = value.repeat ?? null;
  if (repeat === null) return null;
  if (!repeating) return "`repeat` appears on repeating products alone";
  if (repeat.vector.q === 0 && repeat.vector.r === 0) {
    return "a repeat's `vector` is a non-zero hex offset";
  }
  if (!holds(repeat.link.a))
    return "a repeat link's `a` is a mote hex of the pattern";
  if (
    !holds({
      q: repeat.link.b.q - repeat.vector.q,
      r: repeat.link.b.r - repeat.vector.r,
    })
  ) {
    return "a repeat link's `b` minus `vector` is a mote hex of the pattern";
  }
  if (!adjacent(repeat.link.a, repeat.link.b)) {
    return "a repeat link's `a` and `b` are adjacent";
  }
  if (repeat.link.weight !== 1 && repeat.link.weight !== 3) {
    return "a repeat link's `weight` is 1 or 3";
  }
  const shifted = value.motes.map((entry) => ({
    q: entry.q + repeat.vector.q,
    r: entry.r + repeat.vector.r,
  }));
  if (shifted.some((hex) => holds(hex))) {
    return "the pattern and the pattern translated once by `vector` share no hex";
  }
  return null;
}

/** Whether a pattern's motes and filaments form one constellation. */
function connected(value: Molecule): boolean {
  const keys = value.motes.map((entry) => `${entry.q},${entry.r}`);
  const first = keys[0];
  if (first === undefined) return false;
  const seen = new Set<string>([first]);
  const queue = [first];
  while (queue.length > 0) {
    const here = queue.shift() as string;
    for (const filament of value.filaments) {
      const a = `${filament.a.q},${filament.a.r}`;
      const b = `${filament.b.q},${filament.b.r}`;
      const other = a === here ? b : b === here ? a : null;
      if (other !== null && !seen.has(other)) {
        seen.add(other);
        queue.push(other);
      }
    }
  }
  return seen.size === keys.length;
}

/**
 * Why a challenge document is not well formed, or `null` when it is
 * (`specs/formats.md`, Challenges).
 *
 * Deliberately a REASON rather than a boolean: a check that hands a build a
 * malformed document asserts that the build refused it, and the reason is what
 * says which rule the document was authored to break.
 */
export function challengeFault(value: Challenge): string | null {
  if (
    typeof value.name !== "string" ||
    value.name.length < 1 ||
    value.name.length > NAME_MAX
  ) {
    return `\`name\` is 1 to NAME_MAX (${NAME_MAX}) characters`;
  }
  if (value.reagents.length === 0) return "`reagents` is non-empty";
  if (value.products.length === 0) return "`products` is non-empty";
  const reagentFault = faultIn(
    value.reagents.map((entry) => moleculeFault(entry, false)),
  );
  if (reagentFault !== null) return `a reagent: ${reagentFault}`;
  const productFault = faultIn(
    value.products.map((entry) => moleculeFault(entry, true)),
  );
  if (productFault !== null) return `a product: ${productFault}`;

  if (value.permitted.length === 0) return "`permitted` is non-empty";
  for (const kind of value.permitted) {
    if (!PERMITTED_KINDS.includes(kind)) {
      return `each \`permitted\` entry is a kind of PARTS up to and including \`void\`, not ${JSON.stringify(kind)}`;
    }
  }
  if (new Set(value.permitted).size !== value.permitted.length) {
    return "`permitted` holds no duplicates";
  }
  const tray =
    value.permitted.length + value.reagents.length + value.products.length;
  if (tray > TRAY_MAX) {
    return `the derived tray holds at most TRAY_MAX (${TRAY_MAX}) entries, not ${tray}`;
  }
  if (!Number.isInteger(value.target) || value.target < 1) {
    return "`target` is a whole number of at least 1";
  }
  return null;
}

/** Whether a challenge document is well formed. */
export function challengeWellFormed(value: Challenge): boolean {
  return challengeFault(value) === null;
}

/**
 * The tray a challenge derives, in the order `specs/editor.md` lists it: "the
 * challenge's `permitted` part kinds, in the order of `PARTS`; then one `rise`
 * per reagent, in reagent order; then one `set` per product, in product order."
 */
export function derivedTray(
  value: Challenge,
): { kind: PartName; index: number | null }[] {
  const permitted = PARTS.filter((kind) => value.permitted.includes(kind)).map(
    (kind) => ({ kind: kind as PartName, index: null }),
  );
  const rises = value.reagents.map((_unused, index) => ({
    kind: "rise" as PartName,
    index,
  }));
  const sets = value.products.map((_unused, index) => ({
    kind: "set" as PartName,
    index,
  }));
  return [...permitted, ...rises, ...sets];
}

/**
 * Why a solution's parts are not a well-formed solution document, or `null` when
 * they are (`specs/formats.md`, Solutions).
 *
 * This is the DOCUMENT's shape alone — which keys each class carries, and the
 * trimming rule on a tape. Whether the machine is LEGAL for a challenge is the
 * placement rules of `specs/parts.md`, which `parts.ts` decides, plus the
 * permitted-kind and index rules this module's {@link solutionLegalFor} adds.
 */
export function solutionFault(value: Solution): string | null {
  for (const part of value.parts) {
    if (!(PARTS as readonly string[]).includes(part.kind)) {
      return `each part's \`kind\` is a member of PARTS, not ${JSON.stringify(part.kind)}`;
    }
    if (part.kind === "track") {
      if (part.cells === undefined || part.cells.length === 0) {
        return "a track carries `cells`, its path in order";
      }
      if (
        part.q !== undefined ||
        part.r !== undefined ||
        part.rotation !== undefined
      ) {
        return "a track carries no `q`, `r`, or `rotation`";
      }
    } else {
      if (part.q === undefined || part.r === undefined) {
        return `a ${part.kind} carries \`q\` and \`r\``;
      }
      if (
        part.rotation === undefined ||
        !Number.isInteger(part.rotation) ||
        part.rotation < 0 ||
        part.rotation > 5
      ) {
        return `a ${part.kind}'s \`rotation\` is 0 to 5`;
      }
    }
    if (part.kind === "rise" || part.kind === "set") {
      if (
        part.index === undefined ||
        !Number.isInteger(part.index) ||
        part.index < 0
      ) {
        return `a ${part.kind} carries an \`index\` from 0`;
      }
    }
    if (part.tape !== undefined) {
      for (const cell of part.tape) {
        if (
          cell !== null &&
          !(INSTRUCTIONS as readonly string[]).includes(cell)
        ) {
          return `each tape entry is an INSTRUCTIONS name or null, not ${JSON.stringify(cell)}`;
        }
      }
      if (part.tape.length > 0 && part.tape[part.tape.length - 1] === null) {
        return "a tape's last entry is an instruction";
      }
    }
  }
  return null;
}

/**
 * Whether a solution is legal for a challenge: "every part is a permitted kind
 * or a rise or set the challenge derives, every placement rule of
 * `specs/parts.md` holds across the whole list, and every rise and set index
 * exists" (`specs/formats.md`).
 *
 * The placement half is `parts.ts`'s, and is deliberately NOT called from here:
 * this module knows the documents and that one knows the field, and a check that
 * wants both asks both.
 */
export function solutionLegalFor(
  value: Solution,
  forChallenge: Challenge,
): boolean {
  return value.parts.every((part) => {
    if (part.kind === "rise") {
      return (
        (part.index ?? -1) < forChallenge.reagents.length &&
        (part.index ?? -1) >= 0
      );
    }
    if (part.kind === "set") {
      return (
        (part.index ?? -1) < forChallenge.products.length &&
        (part.index ?? -1) >= 0
      );
    }
    return forChallenge.permitted.includes(part.kind);
  });
}
