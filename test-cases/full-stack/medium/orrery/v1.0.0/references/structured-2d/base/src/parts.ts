// Orrery — what a placed part occupies, what it costs, and when it may be
// placed (specs/parts.md, with the footprints of specs/sigils.md and the
// molecule placement of specs/field.md).
//
// Three questions are answered here, and answered once:
//
//   * anatomy — which hexes an arm's grippers stand on, which hexes a sigil's
//     engraving covers, and which hexes a rise or a set watches;
//   * cost — `PART_COSTS` summed over the machine, a track charged per cell;
//   * legality — the six placement rules, checked against the machine as it
//     stands, and reported as the first rule broken so a refusal can say what
//     it refused.
//
// The editor of specs/editor.md and the debug surface of
// specs/instrumentation.md are the two callers, and they ask exactly the same
// questions: a placement made by hand and one made from code are legal on the
// same terms. The challenge's `permitted` list is deliberately absent — it is a
// tray rule of specs/editor.md, not a placement rule.

import { ARM_MAX_LEN, ARM_MIN_LEN, PART_COSTS, WHEEL_MOTES } from "./constants";
import {
  ARM_KINDS,
  CLOSED_TRACK_MIN_CELLS,
  SIGIL_FOOTPRINTS,
  TRACK_COST_PER_CELL,
  TRANSFORMING_SIGILS,
} from "./figures";
import {
  addHex,
  adjacent,
  hexOnField,
  neighbor,
  rotateHex,
  sameHex,
  wrapDir,
} from "./hex";
import type {
  ArmKind,
  Challenge,
  Hex,
  Molecule,
  MoteType,
  PartKind,
  PartState,
  TransformingSigilKind,
} from "./types";

/** The five classes a part kind falls into, for the rules that differ by class. */
export type PartClass = "arm" | "wheel" | "track" | "sigil" | "rise" | "set";

/** Which class a part kind belongs to. */
export function partClass(kind: PartKind): PartClass {
  if (isArmKind(kind)) return "arm";
  if (kind === "wheel") return "wheel";
  if (kind === "track") return "track";
  if (kind === "rise") return "rise";
  if (kind === "set") return "set";
  return "sigil";
}

/** Whether `kind` is one of the five arm kinds. */
export function isArmKind(kind: PartKind): kind is ArmKind {
  return (ARM_KINDS as readonly PartKind[]).includes(kind);
}

/** Whether `kind` is one of the twelve transforming sigils. */
export function isTransformingSigil(
  kind: PartKind,
): kind is TransformingSigilKind {
  return (TRANSFORMING_SIGILS as readonly PartKind[]).includes(kind);
}

/** Whether a part of this kind carries a tape: arms and wheels do. */
export function carriesTape(kind: PartKind): boolean {
  return isArmKind(kind) || kind === "wheel";
}

/** Whether a part of this kind stands on one anchor hex with grippers. */
export function isMechanism(kind: PartKind): boolean {
  return isArmKind(kind) || kind === "wheel";
}

/** The spoke directions an arm of `kind` at `rotation` carries grippers on. */
export function armSpokes(kind: ArmKind, rotation: number): number[] {
  const offsets =
    kind === "biarm"
      ? [0, 3]
      : kind === "triarm"
        ? [0, 2, 4]
        : kind === "hexarm"
          ? [0, 1, 2, 3, 4, 5]
          : [0];
  return offsets.map((offset) => wrapDir(rotation + offset));
}

/** The hex an arm's gripper on `spoke` stands on, at `length` from its base. */
export function gripperHex(base: Hex, spoke: number, length: number): Hex {
  let cell = base;
  for (let step = 0; step < length; step += 1) cell = neighbor(cell, spoke);
  return cell;
}

/** Every gripper hex of an arm standing at the given pose. */
export function armGripperHexes(
  kind: ArmKind,
  base: Hex,
  rotation: number,
  length: number,
): Hex[] {
  return armSpokes(kind, rotation).map((spoke) =>
    gripperHex(base, spoke, length),
  );
}

/** The fixture a wheel at `rotation` carries on spoke `spoke`. */
export function wheelFixture(spoke: number, rotation: number): MoteType {
  return WHEEL_MOTES[wrapDir(spoke - rotation)];
}

/** A wheel's six spoke hexes, indexed by spoke direction. */
export function wheelSpokeHexes(hub: Hex): Hex[] {
  return [0, 1, 2, 3, 4, 5].map((spoke) => neighbor(hub, spoke));
}

/**
 * A pattern coordinate placed at an anchor and a rotation: rotated about
 * `(0, 0)` by the rotation, then translated by the anchor (specs/field.md
 * "Molecule patterns"). Every footprint and every pattern is placed this way.
 */
export function placeHex(cell: Hex, anchor: Hex, rotation: number): Hex {
  return addHex(anchor, rotateHex({ q: cell.q, r: cell.r }, rotation));
}

/** One hex of a placed sigil's footprint, and the role it carries. */
export interface PlacedFootprintHex {
  hex: Hex;
  role: string;
}

/** A transforming sigil's footprint, placed at an anchor and a rotation. */
export function sigilFootprint(
  kind: TransformingSigilKind,
  anchor: Hex,
  rotation: number,
): PlacedFootprintHex[] {
  return SIGIL_FOOTPRINTS[kind].map((cell) => ({
    hex: placeHex(cell, anchor, rotation),
    role: cell.role,
  }));
}

/** A molecule pattern's mote hexes, placed at an anchor and a rotation. */
export function moleculeHexes(
  molecule: Molecule,
  anchor: Hex,
  rotation: number,
): Hex[] {
  return molecule.motes.map((mote) => placeHex(mote, anchor, rotation));
}

/**
 * A rise or set's footprint: the molecule's hexes, and for a repeating product
 * the molecule's hexes translated once by the placed repeat vector
 * (specs/parts.md "Rises and sets").
 */
export function apertureFootprint(
  molecule: Molecule,
  anchor: Hex,
  rotation: number,
  repeating: boolean,
): Hex[] {
  const base = moleculeHexes(molecule, anchor, rotation);
  if (!repeating || molecule.repeat === null) return base;
  const vector = rotateHex(molecule.repeat.vector, rotation);
  return [...base, ...base.map((cell) => addHex(cell, vector))];
}

/** The molecule a rise or set is placed against, or `null` for a bad index. */
export function apertureMolecule(
  part: PartState,
  challenge: Challenge,
): Molecule | null {
  if (part.index === null) return null;
  const list = part.kind === "rise" ? challenge.reagents : challenge.products;
  return list[part.index] ?? null;
}

/**
 * Every hex a placed part occupies: an arm or wheel's anchor, every cell of a
 * track, and every footprint hex of a sigil, rise, or set (specs/parts.md
 * "Placement rules", specs/simulation.md "the area bank").
 */
export function partHexes(part: PartState, challenge: Challenge | null): Hex[] {
  switch (partClass(part.kind)) {
    case "arm":
    case "wheel":
      return [{ q: part.q, r: part.r }];
    case "track":
      return (part.cells ?? []).map((cell) => ({ q: cell.q, r: cell.r }));
    case "sigil":
      return isTransformingSigil(part.kind)
        ? sigilFootprint(
            part.kind,
            { q: part.q, r: part.r },
            part.rotation,
          ).map((entry) => entry.hex)
        : [];
    case "rise":
    case "set": {
      if (challenge === null) return [];
      const molecule = apertureMolecule(part, challenge);
      if (molecule === null) return [];
      return apertureFootprint(
        molecule,
        { q: part.q, r: part.r },
        part.rotation,
        part.kind === "set",
      );
    }
  }
}

/** What one placed part costs; a track is charged per cell of its path. */
export function partCost(part: PartState): number {
  if (part.kind === "track") {
    return TRACK_COST_PER_CELL * (part.cells?.length ?? 0);
  }
  return PART_COSTS[part.kind];
}

/** The machine's cost: the sum of its placed parts' costs. */
export function machineCost(parts: readonly PartState[]): number {
  return parts.reduce((total, part) => total + partCost(part), 0);
}

/** Which hexes carry a sigil, rise, or set engraving, across the machine. */
function engravedHexes(
  parts: readonly PartState[],
  challenge: Challenge | null,
): Hex[] {
  const cells: Hex[] = [];
  for (const part of parts) {
    const kind = partClass(part.kind);
    if (kind === "sigil" || kind === "rise" || kind === "set") {
      cells.push(...partHexes(part, challenge));
    }
  }
  return cells;
}

/** Whether a list of hexes holds `cell`. */
function holds(cells: readonly Hex[], cell: Hex): boolean {
  return cells.some((other) => sameHex(other, cell));
}

/**
 * The first placement rule `candidate` breaks against `others`, worded for the
 * error a refusal raises, or `null` when the placement is legal
 * (specs/parts.md "Placement rules"). `others` is the machine without the
 * candidate, so a move is checked against the machine it is moving within.
 */
export function placementFailure(
  candidate: PartState,
  others: readonly PartState[],
  challenge: Challenge | null,
): string | null {
  // Rule 6 first for a track: a path that is not a path has no hexes to check.
  if (candidate.kind === "track") {
    const cells = candidate.cells ?? [];
    if (cells.length === 0) return "a track's path holds no cells";
    for (let i = 1; i < cells.length; i += 1) {
      if (!adjacent(cells[i - 1], cells[i])) {
        return "a track's consecutive cells are adjacent";
      }
    }
    for (let i = 0; i < cells.length; i += 1) {
      for (let j = i + 1; j < cells.length; j += 1) {
        if (sameHex(cells[i], cells[j]))
          return "no hex is a cell of one track twice";
      }
    }
    if (candidate.closed === true) {
      if (cells.length < CLOSED_TRACK_MIN_CELLS) {
        return `a closed track's path holds at least ${CLOSED_TRACK_MIN_CELLS} cells`;
      }
      if (!adjacent(cells[cells.length - 1], cells[0])) {
        return "a closed track's last cell is adjacent to its first";
      }
    }
  }

  const mine = partHexes(candidate, challenge);
  if (mine.length === 0 && candidate.kind !== "track") {
    return `${candidate.kind} has no footprint to place`;
  }

  // Rule 1: every hex of the part is on the field.
  for (const cell of mine) {
    if (!hexOnField(cell)) {
      return `every hex of a part is on the field; (${cell.q}, ${cell.r}) is not`;
    }
  }

  const kind = partClass(candidate.kind);

  // Rule 5: each rise and each set is placed at most once.
  if (kind === "rise" || kind === "set") {
    const twin = others.find(
      (part) => part.kind === candidate.kind && part.index === candidate.index,
    );
    if (twin !== undefined) {
      return `${candidate.kind} ${String(candidate.index)} is already placed`;
    }
  }

  // Rule 4: no two arms or wheels share an anchor hex.
  if (kind === "arm" || kind === "wheel") {
    const anchor = { q: candidate.q, r: candidate.r };
    const twin = others.find(
      (part) =>
        isMechanism(part.kind) && sameHex({ q: part.q, r: part.r }, anchor),
    );
    if (twin !== undefined) {
      return `an arm or wheel already stands on (${anchor.q}, ${anchor.r})`;
    }
  }

  const engraved = engravedHexes(others, challenge);

  // Rule 2: engraved footprints are pairwise disjoint, and no track cell lies
  // on any of them.
  if (kind === "sigil" || kind === "rise" || kind === "set") {
    for (const cell of mine) {
      if (holds(engraved, cell)) {
        return `an engraving already covers (${cell.q}, ${cell.r})`;
      }
    }
    for (const part of others) {
      if (part.kind !== "track") continue;
      for (const cell of part.cells ?? []) {
        if (holds(mine, cell)) {
          return `a track cell lies on (${cell.q}, ${cell.r})`;
        }
      }
    }
  }

  if (kind === "track") {
    for (const cell of mine) {
      if (holds(engraved, cell)) {
        return `a track cell may not lie on the engraving at (${cell.q}, ${cell.r})`;
      }
    }
    // Rule 3: no hex is a cell of two tracks.
    for (const part of others) {
      if (part.kind !== "track") continue;
      for (const cell of part.cells ?? []) {
        if (holds(mine, cell)) {
          return `(${cell.q}, ${cell.r}) is already a cell of another track`;
        }
      }
    }
  }

  return null;
}

/** Whether a placement is legal, by the rules above. */
export function placementLegal(
  candidate: PartState,
  others: readonly PartState[],
  challenge: Challenge | null,
): boolean {
  return placementFailure(candidate, others, challenge) === null;
}

/** Whether an arm or piston may stand at `length`. */
export function lengthInBounds(length: number): boolean {
  return (
    Number.isInteger(length) && length >= ARM_MIN_LEN && length <= ARM_MAX_LEN
  );
}

/** The track a mechanism anchored on `anchor` is mounted on, if any. */
export function mountedTrack(
  anchor: Hex,
  parts: readonly PartState[],
): PartState | null {
  for (const part of parts) {
    if (part.kind !== "track") continue;
    if ((part.cells ?? []).some((cell) => sameHex(cell, anchor))) return part;
  }
  return null;
}
