// Orrery — the twelve transforming sigils: each one's condition, and each
// one's effect on its own footprint (specs/sigils.md).
//
// A sigil is engraved at a fixed pose and acts at every boundary, the settle
// included, on the motes AT REST on its hexes. Each of the twelve is written
// below as one function of the run and its PLACED footprint — the footprint of
// specs/sigils.md rotated by the sigil's rotation and translated onto its
// anchor, with every hex still carrying the role the table gives it. Nothing
// here knows where in the boundary sequence it runs, which wave it belongs to,
// or which sigils ran before it: `src/boundary.ts` owns the order, and each
// function reads the field exactly as it stands at the moment it is called.
//
// TWO RULES RUN THROUGH ALL TWELVE.
//
// A sigil whose condition does not hold at a boundary WAITS. There is no fault
// and no partial effect: every function below reads its whole condition first
// and returns having changed nothing when any part of it fails, so a sigil that
// consumes several motes never consumes some of them.
//
// A fixture satisfies one condition only, the `mirror` source. Every other
// reading of a hex goes through `looseMoteAt` or `freeMoteAt` of
// `src/motes.ts`, which report a fixture as nothing at all, and `vacant` counts
// a fixture as occupying its hex like any mote.

import { ESSENCES, PLANETS } from "./constants";
import { FILAMENT_WEIGHT, TRIUNE_WEIGHT } from "./figures";
import { filamentBetween } from "./constellation";
import {
  addMote,
  dropMote,
  freeMoteAt,
  joinMotes,
  looseMoteAt,
  moteAt,
  vacant,
} from "./motes";
import type { PlacedFootprintHex } from "./parts";
import type {
  EssenceType,
  Hex,
  MoteState,
  MoteType,
  PlanetType,
  SimState,
  TransformingSigilKind,
} from "./types";

/** One sigil acting on the run, at the footprint its placement fixes. */
export type SigilEffect = (
  sim: SimState,
  placed: readonly PlacedFootprintHex[],
) => void;

/** Whether a mote type is one of the four essences. */
export function isEssence(type: MoteType): type is EssenceType {
  return (ESSENCES as readonly MoteType[]).includes(type);
}

/**
 * The rung above `type` on `PLANETS`, and `null` for `sol`, the top rung, and
 * for every type that is not a planet at all.
 */
export function nextRung(type: MoteType): PlanetType | null {
  const rung = (PLANETS as readonly MoteType[]).indexOf(type);
  if (rung < 0) return null;
  return PLANETS[rung + 1] ?? null;
}

/** The one footprint hex carrying `role`; roles named once resolve to it. */
function at(placed: readonly PlacedFootprintHex[], role: string): Hex {
  const found = placed.find((entry) => entry.role === role);
  if (found === undefined) {
    throw new Error(`this footprint carries no ${role} hex`);
  }
  return found.hex;
}

/** Every footprint hex carrying `role`, in the footprint's own order. */
function all(placed: readonly PlacedFootprintHex[], role: string): Hex[] {
  return placed
    .filter((entry) => entry.role === role)
    .map((entry) => entry.hex);
}

/**
 * The mote on every fount, when EVERY fount holds an unbonded, unheld one, and
 * `null` otherwise. The three sigils that drink from founts all ask for that
 * much before they look at anything else.
 */
function freeFounts(
  sim: SimState,
  placed: readonly PlacedFootprintHex[],
): MoteState[] | null {
  const founts: MoteState[] = [];
  for (const cell of all(placed, "fount")) {
    const mote = freeMoteAt(sim, cell);
    if (mote === null) return null;
    founts.push(mote);
  }
  return founts;
}

// ---------------------------------------------------------------------------
// Binding sigils
// ---------------------------------------------------------------------------

/**
 * `bind`: when both hexes hold motes and no filament joins that pair, a
 * filament of weight `1` is created between them. Held motes bind like any
 * others, and binding two constellations merges them into one — which needs no
 * code, because a constellation is walked from the filaments at the moment it
 * is asked for.
 */
const actBind: SigilEffect = (sim, placed) => {
  bindPair(sim, at(placed, "first"), at(placed, "second"), FILAMENT_WEIGHT);
};

/**
 * `manifold`: when the center holds a mote, each reach hex that also holds a
 * mote is bound to the center exactly as `bind` binds a pair. One filament is
 * created for each reach hex holding a mote not already joined to the center.
 */
const actManifold: SigilEffect = (sim, placed) => {
  const center = at(placed, "center");
  for (const reach of all(placed, "reach")) {
    bindPair(sim, center, reach, FILAMENT_WEIGHT);
  }
};

/**
 * `triune`: when both hexes hold `nova` motes and no filament joins that pair,
 * a filament of weight `3` is created between them.
 */
const actTriune: SigilEffect = (sim, placed) => {
  const first = looseMoteAt(sim, at(placed, "first"));
  const second = looseMoteAt(sim, at(placed, "second"));
  if (first === null || second === null) return;
  if (first.type !== "nova" || second.type !== "nova") return;
  joinMotes(sim, first.id, second.id, TRIUNE_WEIGHT);
};

/** Join the motes on two hexes, when both hold one and no filament joins them. */
function bindPair(sim: SimState, a: Hex, b: Hex, weight: number): void {
  const first = looseMoteAt(sim, a);
  const second = looseMoteAt(sim, b);
  if (first === null || second === null) return;
  joinMotes(sim, first.id, second.id, weight);
}

// ---------------------------------------------------------------------------
// Sundering
// ---------------------------------------------------------------------------

/**
 * `sunder`: when a filament joins the motes on its two hexes, that filament is
 * removed, whatever its weight. The group it joined splits where the removal
 * disconnects it, which again needs no code of its own.
 */
const actSunder: SigilEffect = (sim, placed) => {
  const first = looseMoteAt(sim, at(placed, "first"));
  const second = looseMoteAt(sim, at(placed, "second"));
  if (first === null || second === null) return;
  const filament = filamentBetween(sim, first.id, second.id);
  if (filament === null) return;
  sim.filaments = sim.filaments.filter((entry) => entry !== filament);
};

// ---------------------------------------------------------------------------
// Transmuting sigils
// ---------------------------------------------------------------------------

/**
 * `wane`: an essence mote on the seat becomes `dust`. Its filaments, its
 * constellation, and any hold on it are untouched, so the mote keeps its id and
 * only its type changes.
 */
const actWane: SigilEffect = (sim, placed) => {
  const seat = looseMoteAt(sim, at(placed, "seat"));
  if (seat === null || !isEssence(seat.type)) return;
  seat.type = "dust";
};

/**
 * `mirror`: when the source holds an essence and the target holds `dust`, the
 * target becomes that essence. This is the ONE condition a fixture satisfies —
 * a wheel's essence fixture on the source hex reads exactly as a loose essence
 * does — so the source is read with `moteAt` and the target with `looseMoteAt`.
 */
const actMirror: SigilEffect = (sim, placed) => {
  const source = moteAt(sim, at(placed, "source"));
  if (source === null || !isEssence(source.type)) return;
  const target = looseMoteAt(sim, at(placed, "target"));
  if (target === null || target.type !== "dust") return;
  target.type = source.type;
};

/**
 * `ascend`: when the prime holds an unbonded, unheld `mercury` and the crown
 * holds a planet below `sol`, the `mercury` is consumed and the planet rises
 * one rung of `PLANETS`. The planet may be bonded and held.
 */
const actAscend: SigilEffect = (sim, placed) => {
  const prime = freeMoteAt(sim, at(placed, "prime"));
  if (prime === null || prime.type !== "mercury") return;
  const crown = looseMoteAt(sim, at(placed, "crown"));
  if (crown === null) return;
  const risen = nextRung(crown.type);
  if (risen === null) return;
  dropMote(sim, prime.id);
  crown.type = risen;
};

/**
 * `conjoin`: when both founts hold unbonded, unheld motes of the same planet
 * below `sol` and the crown is vacant, both are consumed and one mote of the
 * next rung appears on the crown, unbonded and unheld.
 */
const actConjoin: SigilEffect = (sim, placed) => {
  const founts = freeFounts(sim, placed);
  if (founts === null) return;
  const [first, second] = founts;
  if (first.type !== second.type) return;
  const risen = nextRung(first.type);
  if (risen === null) return;
  const crown = at(placed, "crown");
  if (!vacant(sim, crown)) return;
  dropMote(sim, first.id);
  dropMote(sim, second.id);
  addMote(sim, crown, risen);
};

/**
 * `eclipse`: when both founts hold unbonded, unheld `dust` and both crowns are
 * vacant, both `dust` are consumed, an `umbra` appears on the umbral crown, and
 * a `lumen` appears on the lumen crown, each unbonded and unheld.
 */
const actEclipse: SigilEffect = (sim, placed) => {
  const founts = freeFounts(sim, placed);
  if (founts === null || founts.some((mote) => mote.type !== "dust")) return;
  const umbral = at(placed, "umbral-crown");
  const lumen = at(placed, "lumen-crown");
  if (!vacant(sim, umbral) || !vacant(sim, lumen)) return;
  for (const mote of founts) dropMote(sim, mote.id);
  addMote(sim, umbral, "umbra");
  addMote(sim, lumen, "lumen");
};

/**
 * `confluence`: when the four founts hold unbonded, unheld motes comprising one
 * of each essence, in any arrangement, and the crown is vacant, all four are
 * consumed and one `aether` appears on the crown, unbonded and unheld.
 */
const actConfluence: SigilEffect = (sim, placed) => {
  const founts = freeFounts(sim, placed);
  if (founts === null) return;
  const held = founts.map((mote) => mote.type);
  const oneOfEach = ESSENCES.every(
    (essence) => held.filter((type) => type === essence).length === 1,
  );
  if (!oneOfEach) return;
  const crown = at(placed, "crown");
  if (!vacant(sim, crown)) return;
  for (const mote of founts) dropMote(sim, mote.id);
  addMote(sim, crown, "aether");
};

/**
 * `dispersion`: when the fount holds an unbonded, unheld `aether` and all four
 * crowns are vacant, the `aether` is consumed and the four essences appear,
 * each on its named crown, unbonded and unheld.
 */
const actDispersion: SigilEffect = (sim, placed) => {
  const fount = freeMoteAt(sim, at(placed, "fount"));
  if (fount === null || fount.type !== "aether") return;
  const crowns = ESSENCES.map((essence) => ({
    essence,
    hex: at(placed, `${essence}-crown`),
  }));
  if (!crowns.every((crown) => vacant(sim, crown.hex))) return;
  dropMote(sim, fount.id);
  for (const crown of crowns) addMote(sim, crown.hex, crown.essence);
};

// ---------------------------------------------------------------------------
// The void
// ---------------------------------------------------------------------------

/**
 * `void`: an unbonded, unheld mote on the maw is consumed. The maw is the only
 * hex that consumes; the rim takes part in the placement rules of
 * specs/parts.md alone, so nothing here reads it.
 */
const actVoid: SigilEffect = (sim, placed) => {
  const maw = freeMoteAt(sim, at(placed, "maw"));
  if (maw === null) return;
  dropMote(sim, maw.id);
};

/** Every transforming sigil's effect, by kind (specs/sigils.md). */
export const SIGIL_EFFECTS: Record<TransformingSigilKind, SigilEffect> = {
  bind: actBind,
  manifold: actManifold,
  triune: actTriune,
  sunder: actSunder,
  wane: actWane,
  mirror: actMirror,
  ascend: actAscend,
  conjoin: actConjoin,
  eclipse: actEclipse,
  confluence: actConfluence,
  dispersion: actDispersion,
  void: actVoid,
};

/** Act one placed transforming sigil on the run, once. */
export function actSigil(
  sim: SimState,
  kind: TransformingSigilKind,
  placed: readonly PlacedFootprintHex[],
): void {
  SIGIL_EFFECTS[kind](sim, placed);
}
