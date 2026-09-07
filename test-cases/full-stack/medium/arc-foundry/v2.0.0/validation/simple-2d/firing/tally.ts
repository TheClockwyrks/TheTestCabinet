// firing — the yard the two tally points are read on. CASE-PROVIDED, LOCAL TO
// THIS CATEGORY.
//
// `specs/components.md` fixes two running tallies: "Every firing structure keeps
// two running tallies for the run: the number of units it killed, and the total
// damage it dealt." They are two independent counters and `firing/tallies-kills`
// and `firing/tallies-damage` decide them apart, so the yard both are read on
// lives here rather than in either.
//
// THE ARRANGEMENT IS CHOSEN SO THE TWO FIGURES CANNOT DRIFT APART FROM OVERKILL:
// a Scrap Emitter deals `2` a shot and a Mote at wave `1` on Medium carries `10`
// health, so each Mote takes exactly five whole shots and the health the
// structure removed is exactly the damage it dealt. Three Motes are held inside
// the radius and nothing else is on the yard, so every point of that damage and
// every one of those kills belongs to the one structure being read.

import { assertEqual } from "../assert";
import {
  captureReplay,
  type Harness,
  openYard,
  parkUnit,
  standComponent,
  structureById,
  type StructureView,
} from "../harness";
import { difficultyById, loadDef, scaledHp } from "../constants";

/** Where the Emitter stands, clear of the Substation's chain. */
export const ANCHOR = { col: 10, row: 10 };

/** Three places inside the Scrap Emitter's `88`, each clear of the others. */
export const PLACES = [
  { x: 50, y: 0 },
  { x: 0, y: 50 },
  { x: -50, y: 0 },
];

/** How long the Emitter is given to work through them, in seconds. */
const PATIENCE = 20;

/**
 * The rate the clearing is driven at.
 *
 * The frames are a cadence being sat out rather than frames anything is read on,
 * and specs/instrumentation.md guarantees that "an interval of simulation time
 * reaches the same state however it was divided into frames". A shot still steps
 * well inside the `2 * PROJECTILE_HIT_R` window it has to be caught in here.
 */
export const TALLY_HZ = 60;

/** One Mote's health at wave 1 on Medium, from `specs/enemies.md`'s formula. */
export const MOTE_HP = scaledHp(
  loadDef("mote").baseHealth,
  1,
  difficultyById("medium"),
);

/**
 * Stand one Emitter, hold three Motes inside its reach, and let it clear them.
 *
 * Returns the structure as it reads once the yard is empty, with the recording of
 * the clearing under the output the caller names.
 */
export async function clearsThreeMotes(
  h: Harness,
  output: string,
): Promise<StructureView> {
  openYard(h, { wave: 1 });
  const id = standComponent(h, "emitter", 1, ANCHOR.col, ANCHOR.row);
  const structure = structureById(h.snapshot(), id);
  for (const place of PLACES) {
    parkUnit(h, "mote", {
      x: structure.cx + place.x,
      y: structure.cy + place.y,
    });
  }

  const cleared = await captureReplay(h, output, () =>
    h.until((s) => s.units.length === 0, {
      maxFrames: h.ticks(PATIENCE),
      poll: 2,
    }),
  );
  assertEqual(
    cleared.hit,
    true,
    `all ${PLACES.length} Motes killed within ${PATIENCE}s`,
  );
  return structureById(cleared.snapshot, id);
}
