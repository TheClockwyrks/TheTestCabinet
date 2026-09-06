// foes/dropper-gate — no dropper appears below the level droppers begin at.
//
// `specs/foes.md`: "Droppers begin at DROPPER_FROM_LEVEL (3), and none appears
// at levels 1 and 2."
//
// BOTH LEVELS BELOW THE GATE ARE WATCHED IN ONE POINT, because they exercise the
// same edge in the same way: each is a level at which the sparse-field rule
// would fire and the gate must hold it. They are two values of one edge rather
// than two edges.
//
// WHAT MAKES THIS THE GATE AND NOT THE TRIGGER. The field posed at each level is
// the SAME seven nodes foes/dropper-sparse-trigger uses — one below
// `DROPPER_SPARSE_THRESHOLD`, standing inside the counted rows — so the
// sparse-field rule is satisfied throughout and the only thing that can keep a
// dropper off the board is the level gate this point decides. Without the field
// the check would pass on a build that simply never counted.
//
// THE CHECK THAT WOULD DRAW A DROPPER IN IS POSED, NOT WAITED FOR.
// `specs/foes.md` runs the sparse-field check when the level's dropper clock
// reaches 0, and `setSpawnTimer` (`specs/instrumentation.md`) poses the seconds
// left on that clock, so the clock is posed to run out inside the next update
// and that update runs. From level 3 that is the moment a dropper enters over a
// field this sparse; at levels 1 and 2 it is the moment the gate has to hold.
// It is posed several times over at each level, so a build whose gate holds
// the first check and lapses on a later one is caught as well.
//
// The requirement this point decides IS the level's own spawning, so this is one
// of the few points that turns `setFoeSpawning` back on. At level 2 the glitch
// spawner runs alongside it — that is what `foeSpawning` gates — so the reading
// counts DROPPERS alone. Each level is posed from scratch through
// `startPlaying`, which empties every roster, so the second stretch begins on
// the board the first one did.

import { afterEach, beforeEach, it } from "vitest";
import {
  DROPPER_COUNT_BOTTOM_ROW,
  DROPPER_COUNT_TOP_ROW,
  DROPPER_FROM_LEVEL,
  DROPPER_SPARSE_THRESHOLD,
} from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseNodes,
  startPlaying,
  type Harness,
} from "../harness";
import { expireClock } from "./watching";

/** Every level below the gate: 1 and 2. */
const LEVELS = Array.from(
  { length: DROPPER_FROM_LEVEL - 1 },
  (_, index) => index + 1,
);

/** The row the posed field stands on: inside the rows the rule counts. */
const FIELD_ROW = 12;

/** The charge each posed node stands at: inert, so none of them is critical. */
const FIELD_CHARGE = 0;

/** One node short of the threshold, spread across that row. */
const FIELD: readonly (readonly [number, number, number])[] = Array.from(
  { length: DROPPER_SPARSE_THRESHOLD - 1 },
  (_, index) => [2 + index * 4, FIELD_ROW, FIELD_CHARGE] as const,
);

/** How many times the dropper's clock is posed to run out at each level. */
const EXPIRIES = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("keeps every dropper off the board below the level they begin at", async () => {
  for (const level of LEVELS) {
    await startPlaying(h, { level });
    await poseNodes(h, FIELD);
    await h.debug.setFoeSpawning(true);

    let peak = 0;
    for (let expiry = 1; expiry <= EXPIRIES; expiry += 1) {
      peak = Math.max(peak, await expireClock(h, "dropper"));
    }

    await captureStill(h, "gated");
    assertEqual(
      peak,
      0,
      `no dropper enters across ${EXPIRIES} expiries of the dropper clock at ` +
        `level ${level}, below DROPPER_FROM_LEVEL (${DROPPER_FROM_LEVEL}), ` +
        `with ${FIELD.length} nodes standing in rows ${DROPPER_COUNT_TOP_ROW} ` +
        `to ${DROPPER_COUNT_BOTTOM_ROW}, below DROPPER_SPARSE_THRESHOLD ` +
        `(${DROPPER_SPARSE_THRESHOLD}); droppers seen on the board at once`,
    );
  }
});
