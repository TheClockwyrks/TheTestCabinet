// Wick — audio/cue-hurt-once-per-tick: a tick on which three contact hits
// land plays `hurt` once.
//
// WHERE THE THRESHOLD COMES FROM. `specs/ui.md`, Audio: the cue table binds
// `hurt` to "The lamplighter takes damage. At most once per tick", and the
// rule under the table states the once-per-tick bound for every one-shot cue
// alike: "Each is played on the tick its event happens ... and at most once
// on that tick". Three hits on one tick are therefore one `hurt`.
//
// WHY THE WORLD IS POSED AS IT IS. Three moths on the lamplighter's own
// center in an isolated run, with `enemyContact` the one driver switch turned
// back on. `specs/world.md` gives every enemy its own schedule — "several
// overlapping enemies each hit on their own schedule" — and each spawns with
// `contactCooldown` `0` (`specs/enemies.md`), so all three hit on the same
// tick, which is the only shape that separates a build playing the cue per
// hit from one playing it per tick. `enemyMotion` stays off, so all three are
// where they were posed when contact is tested.
//
// The lamplighter carries no Brass, so `armor` is `0` and three moths at `5`
// damage each take `hp` from `BASE_MAX_HP` (`100`) to `85`: far from the `0`
// that would end the run and raise `fallen` on the same tick. Nothing else in
// the world can raise a cue: no weapon is held, no gem or pickup is on the
// field, and no enemy takes damage.
//
// THE TOLERANCE. None on the cue count. The hp reading is compared as a
// strict drop of at least two moths' worth, since what makes this scenario a
// pile-up is that more than one hit landed, and the exact damage figure is
// the contact category's own requirement.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { CUES, ENEMIES, MIN_DAMAGE_TAKEN } from "../constants";
import {
  advanceTicks,
  captureReplay,
  createHarness,
  enable,
  placeEnemyNear,
  type Harness,
} from "../harness";
import { cuesOf, heard, isolatedRun } from "./cues";

/** The count the review item drives: three overlapping moths. */
const MOTHS = 3;

/** The least two moth hits can remove, by `specs/world.md`'s damage floor. */
const TWO_HITS = 2 * Math.max(MIN_DAMAGE_TAKEN, ENEMIES.moth.damage);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("plays hurt once on the tick three contact hits land", async () => {
  const before = await isolatedRun(h);
  for (let index = 0; index < MOTHS; index += 1) {
    placeEnemyNear(h, "moth", 0, 0);
  }
  enable(h, "enemyContact");

  const { result: after, played } = await captureReplay(h, "once", () =>
    cuesOf(h, () => advanceTicks(h, 1)),
  );

  // The premise: more than one hit really landed on this one tick.
  assertGreaterThanOrEqual(
    before.run.player.hp - after.run.player.hp,
    TWO_HITS,
    "the health three overlapping moths removed on one tick (specs/world.md, Contact damage)",
  );

  assertEqual(
    heard(played, CUES.hurt),
    1,
    "hurt cues on the tick three contact hits landed (specs/ui.md, Audio)",
  );
});
