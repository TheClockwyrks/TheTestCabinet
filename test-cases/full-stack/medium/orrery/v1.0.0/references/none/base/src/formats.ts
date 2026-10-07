// Orrery — the two JSON documents the game speaks (specs/formats.md).
//
// A challenge states a puzzle; a solution states a machine. Both arrive from
// outside the build — the fixed Extras, the campaign's own course, and
// whatever the debug surface of specs/instrumentation.md is handed — so both
// are parsed rather than trusted: every rule specs/formats.md states is checked
// here, and a document that breaks one raises an `Error` naming what is wrong
// with it and changes nothing.
//
// Reading is the other half. `solutionFromMachine` writes the machine back out
// in exactly the form `parseSolution` accepts, so a machine survives the round
// trip with its placement order, its poses, its paths, and its tapes intact.

import { INSTRUCTIONS, MOTES, NAME_MAX, PARTS, TRAY_MAX } from "./constants";
import { adjacent, hexOnField, sameHex } from "./hex";
import { trimTape } from "./machine";
import { apertureFootprint, moleculeHexes, partClass } from "./parts";
import { fieldHexes } from "./hex";
import type {
  Challenge,
  Hex,
  Instruction,
  Molecule,
  MoteType,
  PartKind,
  PartState,
  PatternFilament,
  Solution,
  SolutionPart,
  TapeCell,
} from "./types";

/** What a malformed document raises. Carries the path that failed. */
export class DocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentError";
  }
}

function fail(message: string): never {
  throw new DocumentError(message);
}

function asObject(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${where} is not an object`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, where: string): unknown[] {
  if (!Array.isArray(value)) fail(`${where} is not an array`);
  return value;
}

function asWhole(value: unknown, where: string, least = 0): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < least) {
    fail(`${where} is not a whole number of at least ${least}`);
  }
  return value;
}

function asHex(value: unknown, where: string): Hex {
  const object = asObject(value, where);
  const q = object.q;
  const r = object.r;
  if (typeof q !== "number" || !Number.isInteger(q)) {
    fail(`${where}.q is not a whole number`);
  }
  if (typeof r !== "number" || !Number.isInteger(r)) {
    fail(`${where}.r is not a whole number`);
  }
  return { q, r };
}

function asWeight(value: unknown, where: string): number {
  if (value !== 1 && value !== 3) fail(`${where}.weight is not 1 or 3`);
  return value;
}

function asMoteType(value: unknown, where: string): MoteType {
  if (typeof value !== "string" || !MOTES.includes(value as MoteType)) {
    fail(`${where}.type is not a mote type`);
  }
  return value as MoteType;
}

function asPartKind(value: unknown, where: string): PartKind {
  if (typeof value !== "string" || !PARTS.includes(value as PartKind)) {
    fail(`${where} is not a part kind`);
  }
  return value as PartKind;
}

function asPatternFilament(value: unknown, where: string): PatternFilament {
  const object = asObject(value, where);
  return {
    a: asHex(object.a, `${where}.a`),
    b: asHex(object.b, `${where}.b`),
    weight: asWeight(object.weight, where),
  };
}

/** Whether a molecule's motes and filaments form one connected constellation. */
function connected(molecule: Molecule): boolean {
  const keys = molecule.motes.map((mote) => `${mote.q},${mote.r}`);
  if (keys.length <= 1) return true;
  const links = new Map<string, string[]>(keys.map((key) => [key, []]));
  for (const filament of molecule.filaments) {
    const a = `${filament.a.q},${filament.a.r}`;
    const b = `${filament.b.q},${filament.b.r}`;
    links.get(a)?.push(b);
    links.get(b)?.push(a);
  }
  const seen = new Set<string>([keys[0]]);
  const queue = [keys[0]];
  while (queue.length > 0) {
    const key = queue.shift() as string;
    for (const next of links.get(key) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen.size === keys.length;
}

/** Parse one molecule pattern, checking every rule specs/formats.md states. */
export function parseMolecule(
  value: unknown,
  where: string,
  allowRepeat: boolean,
): Molecule {
  const object = asObject(value, where);
  const motesRaw = asArray(object.motes, `${where}.motes`);
  if (motesRaw.length === 0) fail(`${where}.motes is empty`);
  const motes = motesRaw.map((entry, index) => {
    const cell = asHex(entry, `${where}.motes[${index}]`);
    const type = asMoteType(
      asObject(entry, `${where}.motes[${index}]`).type,
      `${where}.motes[${index}]`,
    );
    return { q: cell.q, r: cell.r, type };
  });
  for (let i = 0; i < motes.length; i += 1) {
    for (let j = i + 1; j < motes.length; j += 1) {
      if (sameHex(motes[i], motes[j])) {
        fail(
          `${where}.motes places two motes on (${motes[i].q}, ${motes[i].r})`,
        );
      }
    }
  }

  const filamentsRaw =
    object.filaments === undefined
      ? []
      : asArray(object.filaments, `${where}.filaments`);
  const filaments = filamentsRaw.map((entry, index) =>
    asPatternFilament(entry, `${where}.filaments[${index}]`),
  );
  const holdsMote = (cell: Hex): boolean =>
    motes.some((mote) => sameHex(mote, cell));
  for (const [index, filament] of filaments.entries()) {
    const at = `${where}.filaments[${index}]`;
    if (!holdsMote(filament.a) || !holdsMote(filament.b)) {
      fail(`${at} joins a hex this molecule holds no mote on`);
    }
    if (sameHex(filament.a, filament.b)) fail(`${at} joins a mote to itself`);
    if (!adjacent(filament.a, filament.b)) {
      fail(`${at} joins two hexes that are not adjacent`);
    }
    for (const other of filaments.slice(0, index)) {
      const same =
        (sameHex(other.a, filament.a) && sameHex(other.b, filament.b)) ||
        (sameHex(other.a, filament.b) && sameHex(other.b, filament.a));
      if (same) fail(`${at} joins a pair another filament already joins`);
    }
  }

  const repeatRaw = object.repeat;
  let repeat: Molecule["repeat"] = null;
  if (repeatRaw !== undefined && repeatRaw !== null) {
    if (!allowRepeat)
      fail(`${where}.repeat appears on a repeating product alone`);
    const repeatObject = asObject(repeatRaw, `${where}.repeat`);
    const vector = asHex(repeatObject.vector, `${where}.repeat.vector`);
    if (vector.q === 0 && vector.r === 0) {
      fail(`${where}.repeat.vector is the zero offset`);
    }
    const link = asPatternFilament(repeatObject.link, `${where}.repeat.link`);
    if (!holdsMote(link.a)) {
      fail(`${where}.repeat.link.a is not a mote hex of the pattern`);
    }
    if (!holdsMote({ q: link.b.q - vector.q, r: link.b.r - vector.r })) {
      fail(`${where}.repeat.link.b minus the vector is not a mote hex`);
    }
    if (!adjacent(link.a, link.b)) {
      fail(`${where}.repeat.link joins two hexes that are not adjacent`);
    }
    for (const mote of motes) {
      const shifted = { q: mote.q + vector.q, r: mote.r + vector.r };
      if (holdsMote(shifted)) {
        fail(`${where}.repeat.vector leaves the pattern overlapping its copy`);
      }
    }
    repeat = { vector, link };
  }

  const molecule: Molecule = { motes, filaments, repeat };
  if (!connected(molecule)) fail(`${where} is not one connected constellation`);
  return molecule;
}

/** Whether some placement of a pattern's footprint lies entirely on the field. */
export function fitsField(molecule: Molecule, repeating: boolean): boolean {
  for (const anchor of fieldHexes()) {
    for (let rotation = 0; rotation < 6; rotation += 1) {
      const hexes = repeating
        ? apertureFootprint(molecule, anchor, rotation, true)
        : moleculeHexes(molecule, anchor, rotation);
      if (hexes.every(hexOnField)) return true;
    }
  }
  return false;
}

/**
 * Parse a challenge document, checking every rule of specs/formats.md,
 * including that the derived tray fits and that every pattern fits the field.
 */
export function parseChallenge(value: unknown): Challenge {
  const object = asObject(value, "challenge");
  const name = object.name;
  if (typeof name !== "string" || name.length < 1 || name.length > NAME_MAX) {
    fail(`challenge.name is not 1 to ${NAME_MAX} characters`);
  }
  const reagentsRaw = asArray(object.reagents, "challenge.reagents");
  if (reagentsRaw.length === 0) fail("challenge.reagents is empty");
  const productsRaw = asArray(object.products, "challenge.products");
  if (productsRaw.length === 0) fail("challenge.products is empty");
  const reagents = reagentsRaw.map((entry, index) =>
    parseMolecule(entry, `challenge.reagents[${index}]`, false),
  );
  const products = productsRaw.map((entry, index) =>
    parseMolecule(entry, `challenge.products[${index}]`, true),
  );

  const permittedRaw = asArray(object.permitted, "challenge.permitted");
  if (permittedRaw.length === 0) fail("challenge.permitted is empty");
  const permitted = permittedRaw.map((entry, index) => {
    const kind = asPartKind(entry, `challenge.permitted[${index}]`);
    if (kind === "rise" || kind === "set") {
      fail(
        `challenge.permitted[${index}] names ${kind}, which the tray derives`,
      );
    }
    return kind;
  });
  for (let i = 0; i < permitted.length; i += 1) {
    if (permitted.indexOf(permitted[i]) !== i) {
      fail(`challenge.permitted names ${permitted[i]} twice`);
    }
  }
  const trayEntries = permitted.length + reagents.length + products.length;
  if (trayEntries > TRAY_MAX) {
    fail(
      `the derived tray holds ${trayEntries} entries, above TRAY_MAX (${TRAY_MAX})`,
    );
  }

  const target = asWhole(object.target, "challenge.target", 1);

  for (const [index, molecule] of reagents.entries()) {
    if (!fitsField(molecule, false)) {
      fail(`challenge.reagents[${index}] fits nowhere on the field`);
    }
  }
  for (const [index, molecule] of products.entries()) {
    if (!fitsField(molecule, true)) {
      fail(`challenge.products[${index}] fits nowhere on the field`);
    }
  }

  return { name, reagents, products, permitted, target };
}

function asTape(value: unknown, where: string): TapeCell[] {
  const cells = asArray(value, where).map((entry, index) => {
    if (entry === null) return null;
    if (
      typeof entry !== "string" ||
      !INSTRUCTIONS.includes(entry as Instruction)
    ) {
      fail(`${where}[${index}] is not an instruction or null`);
    }
    return entry as Instruction;
  });
  return trimTape(cells);
}

function asRotation(value: unknown, where: string): number {
  const rotation = asWhole(value, where);
  if (rotation > 5) fail(`${where} is not 0 to 5`);
  return rotation;
}

/** Parse a solution document: the placed parts, in placement order. */
export function parseSolution(value: unknown): Solution {
  const object = asObject(value, "solution");
  const partsRaw = asArray(object.parts, "solution.parts");
  const parts = partsRaw.map((entry, index) => {
    const where = `solution.parts[${index}]`;
    const part = asObject(entry, where);
    const kind = asPartKind(part.kind, `${where}.kind`);
    const cls = partClass(kind);
    const out: SolutionPart = { kind };
    if (cls === "track") {
      const cells = asArray(part.cells, `${where}.cells`).map((cell, at) =>
        asHex(cell, `${where}.cells[${at}]`),
      );
      if (cells.length === 0) fail(`${where}.cells is empty`);
      out.cells = cells;
      out.closed = part.closed === true;
    } else {
      out.q = asHex({ q: part.q, r: part.r }, where).q;
      out.r = asHex({ q: part.q, r: part.r }, where).r;
      out.rotation = asRotation(part.rotation, `${where}.rotation`);
    }
    if (cls === "arm" || cls === "wheel") {
      const length =
        part.length === undefined
          ? 1
          : asWhole(part.length, `${where}.length`, 1);
      if (length > 3) fail(`${where}.length is not 1 to 3`);
      if (cls === "wheel" && length !== 1) fail(`${where}.length is not 1`);
      out.length = length;
      out.tape =
        part.tape === undefined ? [] : asTape(part.tape, `${where}.tape`);
    }
    if (cls === "rise" || cls === "set") {
      out.index = asWhole(part.index, `${where}.index`);
    }
    return out;
  });
  return { parts };
}

/** The machine written back out as a solution document. */
export function solutionFromMachine(parts: readonly PartState[]): Solution {
  return {
    parts: parts.map((part) => {
      const cls = partClass(part.kind);
      const out: SolutionPart = { kind: part.kind };
      if (cls === "track") {
        out.cells = (part.cells ?? []).map((cell) => ({
          q: cell.q,
          r: cell.r,
        }));
        out.closed = part.closed === true;
        return out;
      }
      out.q = part.q;
      out.r = part.r;
      out.rotation = part.rotation;
      if (cls === "arm" || cls === "wheel") {
        out.length = part.length;
        out.tape = [...(part.tape ?? [])];
      }
      if (cls === "rise" || cls === "set") out.index = part.index ?? 0;
      return out;
    }),
  };
}

/** A challenge copied, sharing nothing with the original. */
export function cloneChallenge(challenge: Challenge): Challenge {
  return {
    name: challenge.name,
    reagents: challenge.reagents.map(cloneMolecule),
    products: challenge.products.map(cloneMolecule),
    permitted: [...challenge.permitted],
    target: challenge.target,
  };
}

/** A molecule copied, sharing nothing with the original. */
export function cloneMolecule(molecule: Molecule): Molecule {
  return {
    motes: molecule.motes.map((mote) => ({ ...mote })),
    filaments: molecule.filaments.map((filament) => ({
      a: { ...filament.a },
      b: { ...filament.b },
      weight: filament.weight,
    })),
    repeat:
      molecule.repeat === null
        ? null
        : {
            vector: { ...molecule.repeat.vector },
            link: {
              a: { ...molecule.repeat.link.a },
              b: { ...molecule.repeat.link.b },
              weight: molecule.repeat.link.weight,
            },
          },
  };
}
