// foes/dropper-dense-no-trigger — a dense lower field draws no dropper.
//
// specs/foes.md: "When that count is below DROPPER_SPARSE_THRESHOLD (8), one
// dropper enters; when it is 8 or above, none does." This is the other side of
// foes/dropper-sparse-trigger, at the same level and against the same rule, with
// the field posed far above the threshold instead of just below it.
//
// THE CHECK IS POSED, NOT WAITED FOR. specs/foes.md counts the lower field when
// the level's dropper clock reaches 0, and `setSpawnTimer`
// (specs/instrumentation.md) poses the seconds left on that clock, so the clock
// is posed to run out inside the next update and that update runs: that is the
// moment the count is taken and a dropper would enter over a sparse field, and
// the dense field is what keeps one out. It is posed several times over, so a
// build that reads the field right once and wrong on a later check is caught.
//
// The thirty nodes are RE-POSED before each expiry. `setFoeSpawning` gates all
// three spawners together, so a glitch the level also brings in could be on the
// board eating the very field whose density is under test. Re-posing holds the
// density where the check put it, so nothing but the rule this item names can
// decide the outcome. Setting a node that already stands at that charge changes
// nothing.
//
// The reading counts DROPPERS alone, for the same reason: the glitches are the
// price of turning the gate on, not part of the requirement.

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

/** The level watched: the one droppers begin at. */
const LEVEL = DROPPER_FROM_LEVEL;

/** The dense field, as the review item states it: thirty nodes. */
const FIELD_SIZE = 30;

/** The rows it is spread over: inside the counted rows 10 to 19. */
const FIELD_TOP_ROW = 10;
const FIELD_ROWS = 8;

/** The charge each posed node stands at: inert, so none of them is critical. */
const FIELD_CHARGE = 0;

/** The tiles the field stands on: one per column, cycling down the rows. */
const FIELD_TILES = Array.from({ length: FIELD_SIZE }, (_, index) => ({
  c: 2 + index,
  r: FIELD_TOP_ROW + (index % FIELD_ROWS),
}));

/** How many times the dropper's clock is posed to run out. */
const EXPIRIES = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws no dropper in while the lower field is dense", async () => {
  resetTo(h);
  startPlaying(h);
  h.debug.setLevel(LEVEL);
  const poseField = (): void => {
    for (const tile of FIELD_TILES) {
      h.debug.setNode(tile.c, tile.r, FIELD_CHARGE);
    }
  };
  h.debug.setFoeSpawning(true);

  let peak = 0;
  for (let expiry = 1; expiry <= EXPIRIES; expiry += 1) {
    poseField();
    peak = Math.max(peak, await expireClock(h, "dropper"));
  }
  captureStill(h, "dense");

  assertEqual(
    peak,
    0,
    `no dropper enters across ${EXPIRIES} expiries of the level-${LEVEL} ` +
      `dropper clock with ${FIELD_SIZE} nodes held standing in rows 10 to ` +
      `19, at or above DROPPER_SPARSE_THRESHOLD (${DROPPER_SPARSE_THRESHOLD}); ` +
      `droppers seen at once`,
  );
});
