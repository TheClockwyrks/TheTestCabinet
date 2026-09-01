// progression/pool-no-new-passive-when-full — the pool offers no new passive
// with every passive slot filled.
//
// WHERE THE THRESHOLD COMES FROM. specs/progression.md ("The candidate pool"):
// a passive not held enters the pool "WHEN a passive slot is free", and "Slots"
// fixes "Passive slots | `PASSIVE_SLOTS` | `6`". With six passives held there is
// no free slot, so no passive that is not held is a candidate.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with every faculty held
// and nothing alive, with six passives held at level `1`. Level `1` rather than
// each one's max, so every held passive is still a `+1` candidate and the pool
// is not empty: what this point reads is the absence of the four passives that
// are not held. The weapon slots are untouched and every base weapon is still a
// candidate, so a build that empties the pool wholesale fails a different point.
//
// THE TOLERANCE. None: an id is in the pool or it is not.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { PASSIVE_SLOTS } from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";
import { FULL_PASSIVES, SPARE_PASSIVES } from "./stage";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves every unheld passive out once six are held", async () => {
  await isolate(h);
  for (const id of FULL_PASSIVES) await holdPassive(h, id, 1);

  const overlay = await openLevelUp(h);
  await captureStill(h, "full");

  assertEqual(
    overlay.screen,
    "levelup",
    "the screen the queued level-up opened",
  );
  assertEqual(
    overlay.run.passives.length,
    PASSIVE_SLOTS,
    "the passive slots held",
  );
  assertDeepEqual(
    SPARE_PASSIVES.filter((id) => overlay.run.pool.includes(id)),
    [],
    "the unheld passives the pool offered with every slot filled",
  );
});
