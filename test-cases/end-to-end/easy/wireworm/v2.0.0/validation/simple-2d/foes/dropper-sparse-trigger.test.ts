// foes/dropper-sparse-trigger — a sparse lower field draws a dropper in.
//
// specs/foes.md: "the nodes standing in rows 10 to 19 are counted every
// DROPPER_CHECK_INTERVAL (2.5 s) of active play. When that count is below
// DROPPER_SPARSE_THRESHOLD (8), one dropper enters."
//
// The field is posed at SEVEN nodes in those rows — one below the threshold,
// which is the sparsest reading that is still a field rather than an empty
// board. A build that only draws a dropper in over nothing fails here, and a
// build that counts the wrong rows fails here too, since the nodes stand in the
// counted band and nowhere else.
//
// The requirement IS the level's own spawning, so this is one of the few checks
// that turns `setFoeSpawning` back on. Two whole check intervals are allowed, as
// the review item states, which covers a build whose first interval had already
// begun before the field was posed. The glitch spawner runs alongside it at this
// level — that is what `foeSpawning` gates — so the reading counts droppers
// alone; a glitch that eats one of the seven only makes the field sparser.

import { afterEach, beforeEach, it } from "vitest";
import {
  DROPPER_CHECK_INTERVAL,
  DROPPER_FROM_LEVEL,
  DROPPER_SPARSE_THRESHOLD,
} from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { foesOfKind, untilFoeOfKind } from "./harness";

/** The level watched: the one droppers begin at. */
const LEVEL = DROPPER_FROM_LEVEL;

/** The row the posed field stands on: inside the counted rows 10 to 19. */
const FIELD_ROW = 12;

/** One node short of the threshold, spread across the counted row. */
const FIELD_COLUMNS = Array.from(
  { length: DROPPER_SPARSE_THRESHOLD - 1 },
  (_, index) => 2 + index * 4,
);

/** The charge each posed node stands at: inert, so none of them is critical. */
const FIELD_CHARGE = 0;

/** The stretch watched, as the review item states it: two check intervals. */
const WATCH_SECONDS = 2 * DROPPER_CHECK_INTERVAL;

/** How often the roster is read: a twentieth of a second. */
const POLL_FRAMES = ticksFor(0.05);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws a dropper in while the lower field is below the threshold", async () => {
  startPlaying(h);
  h.debug.setLevel(LEVEL);
  for (const c of FIELD_COLUMNS) h.debug.setNode(c, FIELD_ROW, FIELD_CHARGE);
  h.debug.setFoeSpawning(true);

  const drawn = await untilFoeOfKind(
    h,
    "dropper",
    ticksFor(WATCH_SECONDS),
    POLL_FRAMES,
  );
  captureStill(h, "drawn");

  assertEqual(
    drawn.hit,
    true,
    `a dropper enters within ${WATCH_SECONDS} s — two ` +
      `DROPPER_CHECK_INTERVALs (${DROPPER_CHECK_INTERVAL} s) — of level-` +
      `${LEVEL} play with ${FIELD_COLUMNS.length} nodes standing in rows 10 ` +
      `to 19, below DROPPER_SPARSE_THRESHOLD (${DROPPER_SPARSE_THRESHOLD}); ` +
      `the roster held ` +
      `${foesOfKind(drawn.snapshot, "dropper").length} when the sweep ran out`,
  );
});
