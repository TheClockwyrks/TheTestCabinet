// Wick — audio/cue-hurt: the tick a contact hit lands plays `hurt`.
//
// WHERE THE THRESHOLD COMES FROM. `specs/ui.md`, Audio: the cue table binds
// `hurt` to "The lamplighter takes damage. At most once per tick", and "Each
// is played on the tick its event happens ... and at most once on that tick".
// `specs/world.md`, Contact damage: "An overlapping enemy whose
// `contactCooldown` is due lands a hit: `hp` falls by
// `max(MIN_DAMAGE_TAKEN, enemy damage - armor)`". One hit on one tick is
// therefore exactly one `hurt`.
//
// WHY THE WORLD IS POSED AS IT IS. One moth on the lamplighter's own center
// in an isolated run, with `enemyContact` the one driver switch turned back
// on. A distance of `0` is inside the moth's radius plus `PLAYER_RADIUS`
// under any reading of the overlap test, and an enemy spawns with
// `contactCooldown` `0` (`specs/enemies.md`), which "is due on every tick on
// which it is `0` after its count-down" (`specs/world.md`, Timers), so the
// first tick lands the hit. `enemyMotion` stays off, so the moth is where it
// was posed when contact is tested, and nothing else in the world can raise a
// cue: no weapon is held, no gem or pickup is on the field, and no enemy
// takes damage.
//
// The lamplighter carries no Brass, so `armor` is `0` and a moth's `5`
// damage takes `hp` from `BASE_MAX_HP` (`100`) to `95`: far from the `0` that
// would end the run and raise `fallen` on the same tick.
//
// THE TOLERANCE. None: the specification fixes the cue to the tick of the hit
// and to at most one play on it, and the collector reads whole frames.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThan } from "../assert";
import { CUES } from "../constants";
import {
  advanceTicks,
  captureReplay,
  createHarness,
  enable,
  placeEnemyNear,
  type Harness,
} from "../harness";
import { cuesOf, heard, isolatedRun } from "./cues";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("plays hurt once on the tick a contact hit lands", async () => {
  const before = await isolatedRun(h);
  placeEnemyNear(h, "moth", 0, 0);
  enable(h, "enemyContact");

  const { result: after, played } = await captureReplay(h, "hurt", () =>
    cuesOf(h, () => advanceTicks(h, 1)),
  );

  // The premise: the lamplighter really took damage on this tick.
  assertLessThan(
    after.run.player.hp,
    before.run.player.hp,
    "the lamplighter's hp after the moth's contact hit (specs/world.md, Contact damage)",
  );
  assertEqual(
    after.screen,
    "playing",
    "the screen after the hit, which is far from the ending threshold",
  );

  assertEqual(
    heard(played, CUES.hurt),
    1,
    "hurt cues on the tick the lamplighter took damage (specs/ui.md, Audio)",
  );
});
