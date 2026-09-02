// Orrery — what a part occupies, what it costs, and what a tape is worth, as the
// specification fixes them. CASE-PROVIDED, and the SAME FILE in all three engine
// projects.
//
// THIS IS AN ORACLE, NOT A READING. Every anatomy, footprint, cost and period
// below is quoted from `specs/parts.md` (the arms' spokes, the wheel's ring, the
// track, rises and sets, the six placement rules, and `PART_COSTS`),
// `specs/sigils.md` (each transforming sigil's footprint, hex by hex, with the
// roles the specification names) or `specs/instructions.md` (a tape's length and
// the machine's period). A check computes what a machine ought to occupy, cost,
// or run at from here, and compares it against what the build reports.
//
// A FOOTPRINT IS WRITTEN AT ROTATION `0`, exactly as `specs/sigils.md` writes it,
// and {@link sigilHexes} is what places one: "a placed sigil's hexes are its
// footprint rotated and translated as `specs/field.md` describes".

import {
  DIRS,
  PART_COSTS,
  WHEEL_MOTES,
  type InstructionName,
  type MoteName,
  type PartName,
  type SigilName,
} from "./constants";
import {
  adjacent,
  at,
  neighbors,
  onField,
  place,
  sameHex,
  turnDirection,
  type Hex,
} from "./field";
import type { Molecule, SolutionPart } from "./formats";

/* -------------------------------------------------------------------------- */
/* Arms and the wheel                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The spoke directions an arm of `kind` carries at `rotation`
 * (`specs/parts.md`, Arms): `arm` and `piston` carry the rotation alone,
 * `biarm` adds `+3`, `triarm` adds `+2` and `+4`, and `hexarm` carries all six.
 *
 * A kind with no gripper — a wheel, a track, a sigil, a rise, a set — carries no
 * spoke, and this answers the empty list for it.
 */
export function spokesOf(kind: PartName, rotation: number): number[] {
  const offsets =
    kind === "arm" || kind === "piston"
      ? [0]
      : kind === "biarm"
        ? [0, 3]
        : kind === "triarm"
          ? [0, 2, 4]
          : kind === "hexarm"
            ? [0, 1, 2, 3, 4, 5]
            : [];
  return offsets.map((offset) => turnDirection(rotation, offset));
}

/**
 * Where the gripper on spoke direction `d` sits: `base + length * DIRS[d]`
 * (`specs/parts.md`, Arms).
 *
 * `d` is a SPOKE direction, as {@link spokesOf} answers them, rather than an
 * offset from the part's rotation.
 */
export function gripperHex(base: Hex, d: number, length: number): Hex {
  const step = DIRS[turnDirection(d, 0)] as readonly [number, number];
  return { q: base.q + length * step[0], r: base.r + length * step[1] };
}

/** Every gripper hex of an arm at a pose, in spoke order. */
export function gripperHexes(
  kind: PartName,
  base: Hex,
  rotation: number,
  length: number,
): Hex[] {
  return spokesOf(kind, rotation).map((d) => gripperHex(base, d, length));
}

/**
 * The fixture a wheel at `rotation` carries on spoke `d`: "the fixture on spoke
 * `d` is the entry above for `d - rotation` modulo `6`" (`specs/parts.md`).
 */
export function wheelFixture(rotation: number, d: number): MoteName {
  return WHEEL_MOTES[turnDirection(d, -rotation)] as MoteName;
}

/** A wheel's six fixture hexes, in spoke order: its six adjacent hexes. */
export function wheelFixtureHexes(anchor: Hex): Hex[] {
  return [0, 1, 2, 3, 4, 5].map((d) => gripperHex(anchor, d, 1));
}

/** The six fixtures a wheel at `rotation` carries, indexed by spoke direction. */
export function wheelRing(rotation: number): MoteName[] {
  return [0, 1, 2, 3, 4, 5].map((d) => wheelFixture(rotation, d));
}

/* -------------------------------------------------------------------------- */
/* Sigil footprints                                                           */
/* -------------------------------------------------------------------------- */

/**
 * One hex of a sigil's footprint, at rotation `0`, under the role name
 * `specs/sigils.md` gives it.
 *
 * The role is carried because several review items are about the roles reading
 * apart from one another on the field, and because a check that poses a sigil
 * aims at "the crown" rather than at "the third hex".
 */
export interface FootprintHex {
  hex: Hex;
  role: string;
}

/**
 * Every transforming sigil's footprint, hex by hex, exactly as `specs/sigils.md`
 * tabulates it, in the order it tabulates them.
 */
export const SIGIL_FOOTPRINTS: Readonly<
  Record<SigilName, readonly FootprintHex[]>
> = {
  bind: [
    { hex: at(0, 0), role: "first" },
    { hex: at(1, 0), role: "second" },
  ],
  manifold: [
    { hex: at(0, 0), role: "center" },
    { hex: at(1, 0), role: "reach" },
    { hex: at(-1, 1), role: "reach" },
    { hex: at(0, -1), role: "reach" },
  ],
  triune: [
    { hex: at(0, 0), role: "first" },
    { hex: at(1, 0), role: "second" },
  ],
  sunder: [
    { hex: at(0, 0), role: "first" },
    { hex: at(1, 0), role: "second" },
  ],
  wane: [{ hex: at(0, 0), role: "seat" }],
  mirror: [
    { hex: at(0, 0), role: "source" },
    { hex: at(1, 0), role: "target" },
  ],
  ascend: [
    { hex: at(0, 0), role: "prime" },
    { hex: at(1, 0), role: "crown" },
  ],
  conjoin: [
    { hex: at(0, 0), role: "fount" },
    { hex: at(1, 0), role: "fount" },
    { hex: at(0, 1), role: "crown" },
  ],
  eclipse: [
    { hex: at(0, 0), role: "fount" },
    { hex: at(1, 0), role: "fount" },
    { hex: at(0, 1), role: "umbral crown" },
    { hex: at(1, -1), role: "lumen crown" },
  ],
  confluence: [
    { hex: at(0, 0), role: "crown" },
    { hex: at(1, 0), role: "fount" },
    { hex: at(0, 1), role: "fount" },
    { hex: at(-1, 0), role: "fount" },
    { hex: at(0, -1), role: "fount" },
  ],
  dispersion: [
    { hex: at(0, 0), role: "fount" },
    { hex: at(1, 0), role: "nebula crown" },
    { hex: at(0, 1), role: "comet crown" },
    { hex: at(-1, 0), role: "nova crown" },
    { hex: at(0, -1), role: "meteor crown" },
  ],
  void: [
    { hex: at(0, 0), role: "maw" },
    { hex: at(1, 0), role: "rim" },
    { hex: at(0, 1), role: "rim" },
    { hex: at(-1, 1), role: "rim" },
    { hex: at(-1, 0), role: "rim" },
    { hex: at(0, -1), role: "rim" },
    { hex: at(1, -1), role: "rim" },
  ],
};

/** Whether a part kind is one of the twelve transforming sigils. */
export function isTransformingSigil(kind: PartName): kind is SigilName {
  return Object.prototype.hasOwnProperty.call(SIGIL_FOOTPRINTS, kind);
}

/** Where a transforming sigil's footprint lands, placed at a pose. */
export function sigilHexes(
  kind: SigilName,
  anchor: Hex,
  rotation: number,
): Hex[] {
  return (SIGIL_FOOTPRINTS[kind] ?? []).map((entry) =>
    place(entry.hex, anchor, rotation),
  );
}

/** The hex a named role of a placed sigil lands on, or `null` for no such role. */
export function sigilRoleHex(
  kind: SigilName,
  role: string,
  anchor: Hex,
  rotation: number,
): Hex | null {
  const found = (SIGIL_FOOTPRINTS[kind] ?? []).find(
    (entry) => entry.role === role,
  );
  return found === undefined ? null : place(found.hex, anchor, rotation);
}

/* -------------------------------------------------------------------------- */
/* Rises and sets                                                             */
/* -------------------------------------------------------------------------- */

/** Where a molecule pattern's motes land, placed at a pose (`specs/field.md`). */
export function moleculeHexes(
  molecule: Molecule,
  anchor: Hex,
  rotation: number,
): Hex[] {
  return molecule.motes.map((mote) =>
    place(at(mote.q, mote.r), anchor, rotation),
  );
}

/**
 * A rise's footprint: "the molecule pattern for a rise" placed at its pose
 * (`specs/parts.md`, Rises and sets).
 */
export function riseFootprint(
  reagent: Molecule,
  anchor: Hex,
  rotation: number,
): Hex[] {
  return moleculeHexes(reagent, anchor, rotation);
}

/**
 * A set's footprint: "the pattern plus, when the product repeats, the pattern
 * translated once by the repeat vector" (`specs/parts.md`, Rises and sets).
 *
 * The repeat vector is a PATTERN offset, so it is rotated with the pattern.
 */
export function setFootprint(
  product: Molecule,
  anchor: Hex,
  rotation: number,
): Hex[] {
  const hexes = moleculeHexes(product, anchor, rotation);
  const repeat = product.repeat;
  if (repeat === undefined || repeat === null) return hexes;
  const shifted = product.motes.map((mote) =>
    place(
      at(mote.q + repeat.vector.q, mote.r + repeat.vector.r),
      anchor,
      rotation,
    ),
  );
  return [...hexes, ...shifted];
}

/* -------------------------------------------------------------------------- */
/* Every hex a placed part occupies                                           */
/* -------------------------------------------------------------------------- */

/** The reagents and products a rise's or a set's footprint is drawn from. */
export interface Patterns {
  reagents: readonly Molecule[];
  products: readonly Molecule[];
}

/**
 * Every hex of a placed part, as placement rule 1 counts them: "an arm or
 * wheel's anchor, every cell of a track, and every footprint hex of a sigil,
 * rise, or set" (`specs/parts.md`).
 *
 * `patterns` supplies the open challenge's molecules, because a rise's and a
 * set's footprints are its reagents' and products' patterns. A rise or set whose
 * index the challenge does not carry occupies nothing here, which is a placement
 * a check refuses on rule 1 rather than a shape this function invents.
 */
export function partHexes(part: SolutionPart, patterns: Patterns): Hex[] {
  const anchor = at(part.q ?? 0, part.r ?? 0);
  const rotation = part.rotation ?? 0;
  if (part.kind === "track") {
    return (part.cells ?? []).map((cell) => at(cell.q, cell.r));
  }
  if (part.kind === "rise") {
    const reagent = patterns.reagents[part.index ?? -1];
    return reagent === undefined
      ? []
      : riseFootprint(reagent, anchor, rotation);
  }
  if (part.kind === "set") {
    const product = patterns.products[part.index ?? -1];
    return product === undefined ? [] : setFootprint(product, anchor, rotation);
  }
  if (isTransformingSigil(part.kind)) {
    return sigilHexes(part.kind, anchor, rotation);
  }
  return [anchor];
}

/** Whether a part kind is a sigil, a rise or a set — a part with a footprint. */
export function hasFootprint(kind: PartName): boolean {
  return kind === "rise" || kind === "set" || isTransformingSigil(kind);
}

/** Whether a part kind is an arm or a wheel — a part anchored on one hex. */
export function isAnchored(kind: PartName): boolean {
  return !hasFootprint(kind) && kind !== "track";
}

/* -------------------------------------------------------------------------- */
/* Placement legality                                                         */
/* -------------------------------------------------------------------------- */

/** Which of the six placement rules a machine breaks, in the order they are numbered. */
export interface PlacementFault {
  /** The rule's number, `1` to `6`, as `specs/parts.md` numbers them. */
  rule: number;
  /** What the rule requires, in the specification's own words. */
  requirement: string;
}

/**
 * Whether wheels anchored on `a` and `b` have rings that meet — whether any hex
 * at all is adjacent to both anchors, which is what rule 4's second clause
 * forbids.
 */
function ringsMeet(a: Hex, b: Hex): boolean {
  return neighbors(a).some((cell) => adjacent(cell, b));
}

/**
 * The first placement rule a whole machine breaks, or `null` when every one of
 * the six holds (`specs/parts.md`, Placement rules).
 *
 * The rules are checked in the order the specification numbers them, so a
 * failure names the same rule a build's own refusal is required to name.
 */
export function placementFault(
  parts: readonly SolutionPart[],
  patterns: Patterns,
): PlacementFault | null {
  const hexesOf = parts.map((part) => partHexes(part, patterns));

  for (const [index, part] of parts.entries()) {
    for (const hex of hexesOf[index] as Hex[]) {
      if (!onField(hex)) {
        return {
          rule: 1,
          requirement: `every hex of a ${part.kind} is on the field`,
        };
      }
    }
  }

  const footprints = parts.flatMap((part, index) =>
    hasFootprint(part.kind) ? [hexesOf[index] as Hex[]] : [],
  );
  for (let a = 0; a < footprints.length; a += 1) {
    for (let b = a + 1; b < footprints.length; b += 1) {
      const left = footprints[a] as Hex[];
      const right = footprints[b] as Hex[];
      if (left.some((hex) => right.some((other) => sameHex(hex, other)))) {
        return {
          rule: 2,
          requirement: "sigil, rise and set footprints are pairwise disjoint",
        };
      }
    }
  }
  const trackCells = parts.flatMap((part, index) =>
    part.kind === "track" ? (hexesOf[index] as Hex[]) : [],
  );
  for (const cell of trackCells) {
    if (footprints.some((hexes) => hexes.some((hex) => sameHex(hex, cell)))) {
      return {
        rule: 2,
        requirement: "no track cell lies on a sigil, rise or set footprint",
      };
    }
  }

  for (let a = 0; a < trackCells.length; a += 1) {
    for (let b = a + 1; b < trackCells.length; b += 1) {
      if (sameHex(trackCells[a] as Hex, trackCells[b] as Hex)) {
        return {
          rule: 3,
          requirement: "no hex is a cell of two tracks, or of one track twice",
        };
      }
    }
  }

  const anchors = parts.flatMap((part) =>
    isAnchored(part.kind) ? [at(part.q ?? 0, part.r ?? 0)] : [],
  );
  for (let a = 0; a < anchors.length; a += 1) {
    for (let b = a + 1; b < anchors.length; b += 1) {
      if (sameHex(anchors[a] as Hex, anchors[b] as Hex)) {
        return {
          rule: 4,
          requirement: "no two arms or wheels share an anchor hex",
        };
      }
    }
  }
  const hubs = parts.flatMap((part) =>
    part.kind === "wheel" ? [at(part.q ?? 0, part.r ?? 0)] : [],
  );
  for (let a = 0; a < hubs.length; a += 1) {
    for (let b = a + 1; b < hubs.length; b += 1) {
      if (ringsMeet(hubs[a] as Hex, hubs[b] as Hex)) {
        return {
          rule: 4,
          requirement: "no two wheels' rings meet",
        };
      }
    }
  }

  for (const kind of ["rise", "set"] as const) {
    const seen = new Set<number>();
    for (const part of parts) {
      if (part.kind !== kind) continue;
      const index = part.index ?? -1;
      if (seen.has(index)) {
        return {
          rule: 5,
          requirement: `each ${kind} is placed at most once`,
        };
      }
      seen.add(index);
    }
  }

  for (const part of parts) {
    if (part.kind !== "track") continue;
    const cells = (part.cells ?? []).map((cell) => at(cell.q, cell.r));
    for (let i = 1; i < cells.length; i += 1) {
      if (!adjacent(cells[i - 1] as Hex, cells[i] as Hex)) {
        return {
          rule: 6,
          requirement: "a track's consecutive cells are adjacent",
        };
      }
    }
    if (part.closed === true) {
      const first = cells[0];
      const last = cells[cells.length - 1];
      if (cells.length < 3) {
        return {
          rule: 6,
          requirement: "a closed track's path holds at least three cells",
        };
      }
      if (first !== undefined && last !== undefined && !adjacent(last, first)) {
        return {
          rule: 6,
          requirement: "a closed track's last cell is adjacent to its first",
        };
      }
    }
  }

  return null;
}

/** Whether a machine satisfies every one of the six placement rules. */
export function placementLegal(
  parts: readonly SolutionPart[],
  patterns: Patterns,
): boolean {
  return placementFault(parts, patterns) === null;
}

/* -------------------------------------------------------------------------- */
/* Cost, tapes and the period                                                 */
/* -------------------------------------------------------------------------- */

/**
 * What one placed part costs (`specs/parts.md`, Costs). "A track costs its entry
 * per cell", so a track's cost is `PART_COSTS.track` times the length of its
 * path.
 */
export function partCost(part: SolutionPart): number {
  const each = PART_COSTS[part.kind] ?? 0;
  return part.kind === "track" ? each * (part.cells?.length ?? 0) : each;
}

/** A machine's cost: the sum of its placed parts' costs (`specs/parts.md`). */
export function machineCost(parts: readonly SolutionPart[]): number {
  return parts.reduce((total, part) => total + partCost(part), 0);
}

/**
 * A tape's length: "the index of its last non-blank cell plus one, and `0` when
 * it is entirely blank" (`specs/instructions.md`).
 */
export function tapeLength(
  tape: readonly (InstructionName | null)[] | null | undefined,
): number {
  if (tape === null || tape === undefined) return 0;
  for (let i = tape.length - 1; i >= 0; i -= 1) {
    if (tape[i] !== null && tape[i] !== undefined) return i + 1;
  }
  return 0;
}

/**
 * The machine's period `P`: "the largest tape length across its arms and wheels,
 * and `1` when every tape is empty" (`specs/instructions.md`).
 */
export function machinePeriod(parts: readonly SolutionPart[]): number {
  const longest = parts.reduce(
    (most, part) => Math.max(most, tapeLength(part.tape)),
    0,
  );
  return longest === 0 ? 1 : longest;
}

/**
 * The cell a part executes on cycle `c`: "the cell at index `c` modulo `P` of its
 * own tape, blank cells included; a cell at or past the tape's own length is
 * blank" (`specs/instructions.md`).
 */
export function cellForCycle(
  tape: readonly (InstructionName | null)[] | null | undefined,
  cycle: number,
  period: number,
): InstructionName | null {
  if (tape === null || tape === undefined) return null;
  const index = ((cycle % period) + period) % period;
  return tape[index] ?? null;
}

/**
 * A tape trimmed as `specs/formats.md` requires: "Its last entry is an
 * instruction, and an entirely blank tape is the empty list."
 */
export function trimTape(
  tape: readonly (InstructionName | null)[],
): (InstructionName | null)[] {
  return tape.slice(0, tapeLength(tape));
}
