// Wick — clock/fallen-ticks-no-further: a run ended by falling ticks no further.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/world.md` ("Fallen and dawn"): "A run that has ended ticks no
//     further."; the table: "Dawn | `tick` equals `DAWN_TIME × TICK_HZ`
//     (`36000`). | `dawn`" and "Fallen | `hp` is `0` or below. | `fallen`".
//   - `specs/ui.md` ("What advances on each screen"): "`fallen`, `dawn` |
//     Nothing."; and (`fallen` and `dawn`): "The world may stay drawn beneath."
//   - `specs/instrumentation.md` ("Snapshot shape"): "`run` reports ... the run
//     that just ended on `fallen` and `dawn`"; (`setHp`): "A value at or below
//     `0` ends the run fallen at the end of the next `playing` tick";
//     (`setTick`): "Sets `tick` to `tick`, a whole number from `0` to
//     `DAWN_TIME × TICK_HZ − 1` (`35999`)".
//
// WHAT IS READ. A busy night is posed with every autonomous system running; the
// ending tick is run, fallen from `hp` posed to 0, and sixty frames are
// delivered on `fallen`. Then the night is posed again with the clock at 35999,
// the tick that reaches dawn is run, and sixty frames are delivered on `dawn`.
// On each end screen, the whole of `run` after the frames must equal the whole
// of `run` the ending tick left: the tick and every entity.
//
// WHY THE NIGHT IS POSED AS IT IS. A frozen empty night would prove nothing, so
// the night has everything a tick would move: a moth chasing under
// `enemyMotion`, a held Ember firing under `weaponFire` whose bolt flies under
// `effectMotion`, a puddle counting its `ttl`, an attracted gem in flight, and
// the director's own timer counting under `spawning`. The switches stay on
// during the sixty frames, so a build that ticked an ended run would move
// something. Each ending is reached through the rule that produces it on a real
// tick, from the pose the spec names for it.
//
// TOLERANCE. None: the run is compared structurally and the ticks are exact.
//
// The other ending is `clock/dawn-ticks-no-further`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";

import {
  captureStill,
  createHarness,
  enable,
  holdWeapon,
  isolate,
  spawnEnemyAt,
  spawnGemAt,
  type Harness,
} from "../harness";

/** How many frames are delivered on the end screen: one second of them. */
const ENDED_FRAMES = 60;

/** The seed the night is posed from; the director's spawn draws from it. */
const SEED = 3;

/** Where the moth starts: well clear of the lamplighter, closing at 100 u/s. */
const MOTH_X = 300;

/** Where the puddle lies: off the lamplighter, with its `ttl` counting. */
const PUDDLE_X = 100;
const PUDDLE_Y = 100;

/**
 * Where the gem starts: inside the base `PICKUP_RADIUS` (48) so it is attracted
 * on the ending tick and is mid-flight when the run ends.
 */
const GEM_X = 40;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/** Pose a night with every autonomous system running and something for each. */
function poseBusyNight(): void {
  isolate(h, { seed: SEED });
  spawnEnemyAt(h, "moth", MOTH_X, 0);
  spawnGemAt(h, "small", GEM_X, 0);
  h.debug.spawnPuddle("oil-splash", PUDDLE_X, PUDDLE_Y);
  holdWeapon(h, "ember");
  enable(
    h,
    "spawning",
    "enemyMotion",
    "enemyContact",
    "weaponFire",
    "effectMotion",
  );
}

it("holds the ended run still on fallen", async () => {
  poseBusyNight();
  h.debug.setHp(0);
  const ended = await h.tick(1);
  assertEqual(ended.screen, "fallen", "the ending the tick reached");
  await h.tick(ENDED_FRAMES);
  const held = h.snapshot();
  captureStill(h, "ended");

  assertEqual(held.screen, "fallen", "screen after frames on fallen");
  assertDeepEqual(held.run, ended.run, "run after frames on fallen");
});
