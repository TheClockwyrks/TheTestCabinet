// Meltdown — the mover-against-an-emitter arrangements this group poses. GROUP-LOCAL.
//
// WHY IT IS HERE AND NOT IN `harness.ts`. Every figure this group asserts is a
// flow one mover drives across a contact of a stated number of edge-tiles:
// `forgeGain(T) = FORGE_K * sharedEdges(T, F) * max(0, setpoint(F) - H_T)` and
// `sinkLoss(T) = output(S) * sharedEdges(T, S) * (H_T / 100)`, each divided by
// the emitter's own mass (`specs/heat.md`). The only way to read one of those on
// its own is to leave the emitter with NO OTHER FLOW AT ALL, and that is a
// question of what stands against each of its four faces. `harness.ts`'s `boxIn`
// seals all four with one tower each and takes no heat and no level, which is
// not enough: this group needs a named mover, at a named level, on a named slice
// of one face, and every remaining edge-tile taken out of the air term. No other
// group needs that, so it lives beside the checks that do.
//
// THE ARRANGEMENT, AND WHY EACH PART OF IT IS HERE. A subject is posed with all
// four faces covered by 2x2 neighbours:
//
//   - COVERED, because an edge-tile facing another tower sheds nothing to air
//     (`specs/heat.md`), so the air term is identically zero rather than a
//     correction the reading would have to carry;
//   - every neighbour that is not a named mover is a PLAIN EMITTER WALL AT THE
//     SUBJECT'S OWN HEAT, because two emitters at the same heat exchange nothing
//     — a gradient of zero, not a faculty switched off, so no reading here rests
//     on `setTowerThermal` being honoured;
//   - and the readings this group takes are ONE FRAME long, so a wall's own
//     cooling cannot reach the subject: every term of a frame is computed from
//     the heats the frame opened with.
//
// What is left is the mover's flow and nothing else.
//
// THE SLOTS. A mover is 2x2 at every level (`specs/towers.md`), and a face is one
// edge-tile long per tile of the footprint's side (`specs/heat.md`), so a 2x2
// subject's face is one slot of two edge-tiles and a 4x4 subject's face is two.
// Naming the slot is what lets a check vary the WIDTH of a contact — two
// edge-tiles against four — while covering the rest of the face either way.
//
// THE SIZES COME FROM THE SPECIFICATION, never from a snapshot's own `size`: a
// build that reported a 3x3 Arc would otherwise be boxed according to its own
// mistake and then graded on the arrangement that mistake produced.
//
// NOTHING HERE IS A TOLERANCE and nothing here is a threshold. This file says
// only what stands where; what a reading must come to is stated in the check
// that takes it.

import { fail } from "../assert";
import {
  SURGE_TYPES,
  TOWER_DEFS,
  isEmitter,
  type Side,
  type Tile,
  type TowerType,
} from "../constants";
import { FREE_SITE } from "../fixtures";
import {
  poseIdleTower,
  poseTarget,
  poseTower,
  requireTower,
  type Harness,
} from "../harness";
import { sizeOf } from "../thermal";

/** The footprint side of both movers, in tiles, and so the width of one slot. */
export const SLOT = sizeOf("forge");

/**
 * The plain emitter every uncovered slot is walled with.
 *
 * The Arc is the 2x2 workhorse (`specs/towers.md`), which is the size a slot is,
 * so one wall covers one slot exactly and any two walls on adjoining faces meet
 * at a corner alone — where two towers share no edge-tile (`specs/heat.md`).
 */
export const WALL: TowerType = "arc";

/**
 * Three anchors with room for a 4x4 subject AND the ring of eight 2x2
 * neighbours around it, and nothing else near.
 *
 * A subject at index `i` spans `col..col+size-1`; its ring reaches two tiles
 * further on every side. The three rings are far apart on both axes, so no
 * neighbour of one abuts any part of another, and every one of them keeps clear
 * of the left vent's corridor (rows `16..19`) and the top vent's (columns
 * `22..29`), so nothing posed here lengthens a route (`specs/floor.md`).
 *
 * Three, because the figures this group compares come in threes: the Forge's
 * three setpoints and the Sink's three outputs. Posing all three legs on ONE
 * floor and reading them in ONE frame is what makes the comparison a comparison
 * — the same clock, the same frame, the same everything but the level.
 */
export const BOXED_SITES: readonly Tile[] = [
  { col: 34, row: 24 },
  { col: 34, row: 4 },
  { col: 12, row: 4 },
];

/** The thermal mass that divides every change to an emitter's heat. */
export function massOf(type: TowerType): number {
  const def = TOWER_DEFS[type];
  if (!isEmitter(def)) {
    fail("one of the six emitters (specs/towers.md)", type);
  }
  return def.mass;
}

/** One mover, and the slice of the subject's perimeter it is posed against. */
export interface MoverPlacement {
  /** `"forge"` or `"sink"`. */
  type: TowerType;
  /** The subject's world face it sits flush against. */
  side: Side;
  /** Which slot of that face, counted from the low coordinate. Defaults to `0`. */
  slot?: number;
  /** Its level, `1`, `2` or `3`. Defaults to `1`. */
  level?: number;
}

/** The subject: what it is, and the heat it opens at. */
export interface Subject {
  type: TowerType;
  heat: number;
}

/** A posed box: the subject, its movers in the order given, and its plain walls. */
export interface Boxed {
  id: number;
  /** The subject's footprint anchor. */
  site: Tile;
  /** One id per {@link MoverPlacement}, in the order they were given. */
  movers: number[];
  /** The plain walls covering every slot no mover claimed. */
  walls: number[];
}

/** The top-left tile of slot `slot` on `side` of a `size`-tile footprint at `site`. */
function slotAnchor(site: Tile, size: number, side: Side, slot: number): Tile {
  const along = slot * SLOT;
  if (side === "N") return { col: site.col + along, row: site.row - SLOT };
  if (side === "S") return { col: site.col + along, row: site.row + size };
  if (side === "E") return { col: site.col + size, row: site.row + along };
  return { col: site.col - SLOT, row: site.row + along };
}

/**
 * Pose `subject` at the `siteIndex`-th anchor with every one of its four faces
 * covered: the named movers where they were asked for, and a plain wall at the
 * subject's own heat everywhere else.
 *
 * The subject's guns are held off (`poseIdleTower`), because no requirement this
 * group decides involves a shot and a flow racing one would be a reading of
 * both. The movers are posed bare (`poseTower`): a mover has no guns to hold and
 * no heat to set, and its level is the one thing about it that matters.
 *
 * The caller opens the run — `startRun` once, then one call to this per subject
 * — so that several subjects differing in one figure can be read in one frame.
 */
export async function poseBoxed(
  h: Harness,
  subject: Subject,
  movers: readonly MoverPlacement[],
  siteIndex = 0,
): Promise<Boxed> {
  const size = sizeOf(subject.type);
  if (size % SLOT !== 0) {
    fail(
      `a subject whose footprint divides into ${SLOT}-tile slots ` +
        "(specs/towers.md)",
      `${subject.type} is ${size}x${size}`,
    );
  }
  const site = BOXED_SITES[siteIndex];
  if (site === undefined) {
    fail(`one of the ${BOXED_SITES.length} boxed anchors`, siteIndex);
  }

  const id = await poseIdleTower(h, subject.type, site.col, site.row, {
    heat: subject.heat,
  });

  const claimed = new Set<string>();
  const moverIds: number[] = [];
  for (const placement of movers) {
    const slot = placement.slot ?? 0;
    claimed.add(`${placement.side}${slot}`);
    const at = slotAnchor(site, size, placement.side, slot);
    const moverId = await poseTower(h, placement.type, at.col, at.row);
    if ((placement.level ?? 1) !== 1) {
      await h.debug.setTowerLevel(moverId, placement.level ?? 1);
    }
    moverIds.push(moverId);
  }

  const wallIds: number[] = [];
  for (const side of ["N", "E", "S", "W"] as const) {
    for (let slot = 0; slot < size / SLOT; slot += 1) {
      if (claimed.has(`${side}${slot}`)) continue;
      const at = slotAnchor(site, size, side, slot);
      wallIds.push(
        await poseIdleTower(h, WALL, at.col, at.row, { heat: subject.heat }),
      );
    }
  }

  return { id, site, movers: moverIds, walls: wallIds };
}

/** A tower's heat right now, through the build's own `snapshot`. */
export async function readHeat(
  h: Harness,
  id: number,
  doing: string,
): Promise<number> {
  return requireTower(await h.snapshot(), id, doing).heat;
}

/* -------------------------------------------------------------------------- */
/* A mover with the whole surge around it                                     */
/* -------------------------------------------------------------------------- */

/**
 * Where a mover stands when the point is about what it does to the SURGE rather
 * than to a neighbour's heat: a quiet anchor, clear of both corridors and of
 * every other named anchor (`validation/none/fixtures.ts`).
 */
export const SURROUNDED_SITE: Tile = FREE_SITE;

/**
 * Where the six marks stand: one tile off each of the mover's four faces and
 * one off two of its corners.
 *
 * Geometry, not a tolerance. Every one of them is inside two and a half tiles of
 * the mover's footprint centre, which is well inside the SHORTEST range on the
 * roster — the Stutter's `5.0` tiles (`specs/towers.md`) — so a build that gave
 * a mover any emitter's range would have all six in it, and none of them stands
 * on the footprint itself.
 */
export const MARK_OFFSETS: readonly Tile[] = [
  { col: 0, row: -1 },
  { col: SLOT, row: 0 },
  { col: 0, row: SLOT },
  { col: -1, row: 1 },
  { col: SLOT, row: SLOT },
  { col: -1, row: -1 },
];

/** Hp far past anything the roster could remove in a scenario of a few seconds. */
export const MARK_HP = 10_000;

/**
 * Pose a lone mover of `type` with one stationary mark of every surge type
 * around it, and hand back the mover's id and the six mark ids in
 * `SURGE_TYPES` order.
 *
 * The mover is posed bare, so its firing faculty is ON: what is being decided is
 * that a mover never fires, not that a gate can silence it. The marks have their
 * motion off, so none of them walks out of whatever range a build gave the mover
 * while the reading is taken, and their hp is far past anything a shot could
 * take, so a reading of hp REMOVED is a reading of shots and not of a death.
 *
 * The caller opens the run.
 */
export async function poseSurroundedMover(
  h: Harness,
  type: TowerType,
): Promise<{ id: number; marks: number[] }> {
  const site = SURROUNDED_SITE;
  const id = await poseTower(h, type, site.col, site.row);
  const marks: number[] = [];
  for (const [index, surge] of SURGE_TYPES.entries()) {
    const at = MARK_OFFSETS[index % MARK_OFFSETS.length];
    marks.push(
      await poseTarget(
        h,
        surge,
        site.col + at.col,
        site.row + at.row,
        MARK_HP,
      ),
    );
  }
  return { id, marks };
}
