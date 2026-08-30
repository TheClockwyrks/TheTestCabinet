// foes/dropper-dense-no-trigger — a dense lower field draws no dropper.
//
// `specs/foes.md`: "When that count is below DROPPER_SPARSE_THRESHOLD (8), one
// dropper enters; when it is 8 or above, none does." This is the other side of
// the rule foes/dropper-sparse-trigger decides, at the same level and over the
// same counted rows, with the field posed far above the threshold instead of
// just below it. The two are separate points because a build that spawns a
// dropper on every check and a build that spawns none would grade alike on one
// paired item.
//
// THE THIRTY NODES ARE RE-POSED AS THE WATCH RUNS. `setFoeSpawning` gates all
// three spawners together, so turning it on to test the dropper's rule also puts
// glitches on the board — and a glitch eats the node it stands on, which is the
// very field whose density is under test. Re-posing holds the density where this
// point put it, so nothing but the rule the item names can decide the outcome.
// Setting a node that already stands at that charge changes nothing, so the
// re-pose is inert wherever nothing was eaten.
//
// The re-pose runs every half second. Two glitches crossing at `GLITCH_H_SPEED`
// (`210`) stand on at most a handful of tiles in that time, so the field cannot
// fall from thirty to anywhere near `DROPPER_SPARSE_THRESHOLD` between one
// re-pose and the next.
//
// The reading counts DROPPERS alone, for the same reason: the glitches are the
// price of turning the gate on, not part of this requirement.

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
import { watchRoster } from "./watching";

/** The level watched: the one droppers begin at. */
const LEVEL = DROPPER_FROM_LEVEL;

/** The dense field, as the review item states it: thirty nodes. */
const FIELD_SIZE = 30;

/** The rows it is spread over, all of them inside the rows the rule counts. */
const FIELD_TOP_ROW = 10;
const FIELD_ROWS = 8;

/** The charge each posed node stands at: inert, so none of them is critical. */
const FIELD_CHARGE = 0;

/** The tiles the field stands on: one per column, cycling down those rows. */
const FIELD: readonly (readonly [number, number, number])[] = Array.from(
  { length: FIELD_SIZE },
  (_, index) =>
    [2 + index, FIELD_TOP_ROW + (index % FIELD_ROWS), FIELD_CHARGE] as const,
);

/** The stretch watched, as the review item states it: ten seconds. */
const WATCH_SECONDS = 10;

/** How often the roster is read and the field re-posed, in seconds. */
const POLL_SECONDS = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("draws no dropper in while the lower field is dense", async () => {
  await startPlaying(h, { level: LEVEL });
  const poseDenseField = (): Promise<void> => poseNodes(h, FIELD);
  await poseDenseField();
  await h.debug.setFoeSpawning(true);

  const watch = await watchRoster(
    h,
    "dropper",
    WATCH_SECONDS,
    POLL_SECONDS,
    poseDenseField,
  );

  await captureStill(h, "dense");
  assertEqual(
    watch.peak,
    0,
    `no dropper enters over ${WATCH_SECONDS} s of level-${LEVEL} play with ` +
      `${FIELD_SIZE} nodes held standing in rows ${DROPPER_COUNT_TOP_ROW} to ` +
      `${DROPPER_COUNT_BOTTOM_ROW}, far above DROPPER_SPARSE_THRESHOLD ` +
      `(${DROPPER_SPARSE_THRESHOLD}); droppers seen on the board at once`,
  );
});
