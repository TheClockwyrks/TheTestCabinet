// Wick — passives/brass-armor-derived: `armor` is `1` per Brass level held.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md` ("The derived stats"):
// "`armor = BRASS_ARMOR_PER_LEVEL × brass`" with `BRASS_ARMOR_PER_LEVEL` (`1`),
// and "Brass tops out at level `3`, so armor is at most `3`".
// `specs/instrumentation.md` ("Snapshot shape") derives the reported `armor`
// the same way: "`BRASS_ARMOR_PER_LEVEL` (`1`) `×` the Brass level held". So
// with Brass at its max level `3` the snapshot reads `3`, and with Brass at
// level `1` it reads `1`; with none held, "a passive not held is level `0`", so
// it reads `0`.
//
// THE POSE. An isolated night with no passive held, read first so the empty
// loadout's `0` is established; Brass placed at level 3 through `setPassive`
// and read; then the same slot set to level 1 and read again. "A derived stat is
// computed from the levels held at the moment it is read", so no tick is needed
// between the poses, and every faculty stays held so nothing else touches the
// run.
//
// TOLERANCE. `FLOAT_TOL`: each figure is a whole number the formula gives
// exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import { FLOAT_TOL, PASSIVES, armorOf } from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  isolate,
  type Harness,
} from "../harness";

/** Brass at its max level, `3`. */
const MAX_LEVEL = PASSIVES.brass.maxLevel;

/** The level it is lowered to. */
const LOW_LEVEL = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads armor 3 with Brass 3 held and armor 1 with Brass 1 held", async () => {
  const opened = await isolate(h);
  assertNear(
    opened.run.armor,
    armorOf({}),
    FLOAT_TOL,
    "the armor reported with no Brass held",
  );

  const slot = await holdPassive(h, "brass", MAX_LEVEL);
  const armored = await h.snapshot();
  assertNear(
    armored.run.armor,
    armorOf({ brass: MAX_LEVEL }),
    FLOAT_TOL,
    `the armor reported with Brass ${MAX_LEVEL} held`,
  );

  await h.debug.setPassive(slot, "brass", LOW_LEVEL);
  const lowered = await h.step(1);
  await captureStill(h, "armor");
  assertNear(
    lowered.run.armor,
    armorOf({ brass: LOW_LEVEL }),
    FLOAT_TOL,
    `the armor reported with Brass ${LOW_LEVEL} held`,
  );
});
