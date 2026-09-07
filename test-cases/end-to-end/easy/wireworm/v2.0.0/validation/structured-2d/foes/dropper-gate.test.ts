// foes/dropper-gate — no dropper appears below the level droppers begin at.
//
// specs/foes.md: "Droppers begin at DROPPER_FROM_LEVEL (3), and none appears at
// levels 1 and 2."
//
// Both levels below the gate are watched, because they are the same edge
// exercised the same way: the sparse field that WOULD draw a dropper in at level
// 3 is posed at each of them, so what is being read is the level gate and not
// the sparse-field trigger. That trigger is foes/dropper-sparse-trigger's
// requirement, and the field posed here is the same seven nodes it uses, one
// below DROPPER_SPARSE_THRESHOLD.
//
// THE CHECK THAT WOULD DRAW A DROPPER IN IS POSED, NOT WAITED FOR. specs/foes.md
// runs the sparse-field check when the level's dropper clock reaches 0, and
// `setSpawnTimer` (specs/instrumentation.md) poses the seconds left on that
// clock, so the clock is posed to run out inside the next update and that
// update runs. From level 3 that is the moment a dropper enters over a field
// this sparse; at levels 1 and 2 it is the moment the gate has to hold. It is
// posed several times over at each level, so a build whose gate holds the
// first check and lapses on a later one is caught as well.
//
// The requirement IS the level's own spawning, so this is one of the few checks
// that turns `setFoeSpawning` back on. At level 2 the glitch spawner runs
// alongside it — that is what `foeSpawning` gates — so the reading counts
// droppers alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { DROPPER_FROM_LEVEL, DROPPER_SPARSE_THRESHOLD } from "../constants";
import {
  captureStill,
  createHarness,
  resetTo,
  startPlaying,
  type Harness,
} from "../harness";
import { expireClock } from "./harness";

/** Every level below the gate: 1 and 2. */
const LEVELS = Array.from(
  { length: DROPPER_FROM_LEVEL - 1 },
  (_, index) => index + 1,
);

/** The row the posed field stands on: inside the counted rows 10 to 19. */
const FIELD_ROW = 12;

/** One node short of the threshold, spread across the counted row. */
const FIELD_COLUMNS = Array.from(
  { length: DROPPER_SPARSE_THRESHOLD - 1 },
  (_, index) => 2 + index * 4,
);

/** The charge each posed node stands at: inert, so none of them is critical. */
const FIELD_CHARGE = 0;

/** How many times the dropper's clock is posed to run out at each level. */
const EXPIRIES = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps every dropper off the board below the level they begin at", async () => {
  for (const level of LEVELS) {
    resetTo(h);
    startPlaying(h);
    h.debug.setLevel(level);
    for (const c of FIELD_COLUMNS) h.debug.setNode(c, FIELD_ROW, FIELD_CHARGE);
    h.debug.setFoeSpawning(true);

    let peak = 0;
    for (let expiry = 1; expiry <= EXPIRIES; expiry += 1) {
      peak = Math.max(peak, await expireClock(h, "dropper"));
    }
    captureStill(h, "gated");

    assertEqual(
      peak,
      0,
      `no dropper enters across ${EXPIRIES} expiries of the dropper clock at ` +
        `level ${level}, below DROPPER_FROM_LEVEL (${DROPPER_FROM_LEVEL}), ` +
        `with ${FIELD_COLUMNS.length} nodes standing in rows 10 to 19, below ` +
        `DROPPER_SPARSE_THRESHOLD (${DROPPER_SPARSE_THRESHOLD}); droppers ` +
        `seen at once`,
    );
  }
});
