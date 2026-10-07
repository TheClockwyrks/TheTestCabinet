// foes/dropper-sparse-trigger — a sparse lower field draws a dropper in.
//
// `specs/foes.md`: "the nodes standing in rows 10 to 19 are counted every
// DROPPER_CHECK_INTERVAL (2.5 s) of active play. When that count is below
// DROPPER_SPARSE_THRESHOLD (8), one dropper enters."
//
// THE FIELD IS POSED ONE NODE SHORT OF THE THRESHOLD, at seven. That is the
// sparsest reading that is still a FIELD rather than an empty board, which is
// what makes it the reading worth taking: a build that only draws a dropper in
// over nothing fails here, and so does a build that counts the wrong rows, since
// the seven nodes stand inside the counted band and nowhere else on the board.
//
// The requirement this point decides IS the level's own spawning, so this is one
// of the few points that turns `setFoeSpawning` back on. Two whole check
// intervals are allowed, as the review item states, which covers a build whose
// first interval had already begun before the field was posed. The glitch
// spawner runs alongside it at this level — that is what `foeSpawning` gates —
// so the sweep looks for a DROPPER alone; a glitch that eats one of the seven
// only makes the field sparser than the rule needs it.

import { afterEach, beforeEach, it } from "vitest";
import {
  DROPPER_CHECK_INTERVAL,
  DROPPER_COUNT_BOTTOM_ROW,
  DROPPER_COUNT_TOP_ROW,
  DROPPER_FROM_LEVEL,
  DROPPER_SPARSE_THRESHOLD,
} from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  foesOfKind,
  poseNodes,
  startPlaying,
  type Harness,
} from "../harness";
import { untilFoeOfKind } from "./watching";

/** The level watched: the one droppers begin at. */
const LEVEL = DROPPER_FROM_LEVEL;

/** The row the posed field stands on: inside the rows the rule counts. */
const FIELD_ROW = 12;

/** The charge each posed node stands at: inert, so none of them is critical. */
const FIELD_CHARGE = 0;

/** One node short of the threshold, spread across that row. */
const FIELD: readonly (readonly [number, number, number])[] = Array.from(
  { length: DROPPER_SPARSE_THRESHOLD - 1 },
  (_, index) => [2 + index * 4, FIELD_ROW, FIELD_CHARGE] as const,
);

/** The stretch watched, as the review item states it: two check intervals. */
const WATCH_SECONDS = 2 * DROPPER_CHECK_INTERVAL;

/**
 * How often the roster is read, in seconds. A tenth of the check interval, so
 * the sweep resolves the arrival to well inside the interval that produced it.
 */
const POLL_SECONDS = 0.25;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("draws a dropper in while the lower field is below the threshold", async () => {
  await startPlaying(h, { level: LEVEL });
  await poseNodes(h, FIELD);
  await h.debug.setFoeSpawning(true);

  const drawn = await untilFoeOfKind(h, "dropper", WATCH_SECONDS, POLL_SECONDS);

  await captureStill(h, "drawn");
  assertEqual(
    drawn.hit,
    true,
    `a dropper enters within ${WATCH_SECONDS} s — two ` +
      `DROPPER_CHECK_INTERVALs (${DROPPER_CHECK_INTERVAL} s) — of level-` +
      `${LEVEL} play with ${FIELD.length} nodes standing in rows ` +
      `${DROPPER_COUNT_TOP_ROW} to ${DROPPER_COUNT_BOTTOM_ROW}, below ` +
      `DROPPER_SPARSE_THRESHOLD (${DROPPER_SPARSE_THRESHOLD}); the roster ` +
      `held ${foesOfKind(drawn.snapshot, "dropper").length} droppers when ` +
      `the sweep ran out`,
  );
});
