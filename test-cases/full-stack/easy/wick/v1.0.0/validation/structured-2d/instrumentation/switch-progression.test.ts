// Wick — instrumentation/switch-progression: with `setProgression(false)`, a
// gem collected past `xpToNext` raises `xp` and nothing else; with the switch
// back on, the next gain spends it on the levels it earns.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`, the
// switch table, `progression`: on, "Experience gained is spent on levels as
// `specs/progression.md` states: `xp` falls by `xpToNext(level)`, `level`
// rises, and a level-up is queued"; off, "No gain is spent: `xp` rises as gems
// are collected and stands however high it climbs, and `level` and
// `pendingLevelUps` hold where they are." "turning one back on resumes that
// faculty from the next tick". `specs/progression.md`, "Levels and
// experience": `xpToNext(level)` is `XP_BASE` (`5`) `+ XP_STEP` (`10`)
// `× (level − 1)`, and "After every gain, while `xp >= xpToNext(level)`: `xp`
// falls by `xpToNext(level)`, `level` rises by `1`, and one level-up is
// queued". `specs/world.md`, "Gems": a `large` gem grants `GEM_VALUES.large`
// (`10`) `× xpMul`, `1` with no Soot held, and a gem within `COLLECT_RADIUS`
// (`8`) of the lamplighter's center is collected on that tick.
//
// WHY COLLECTION IS THE READING THAT MATTERS. The switch names what a GAIN is
// spent on, not whether a gain arrives, and the specification is explicit that
// collection is gated by neither `drops` nor `progression`. So the off half
// has to show the gem gone and `xp` risen by its stated value while `level`
// and `pendingLevelUps` stand — a build that held collection itself, or that
// held the experience, fails here.
//
// THE ARITHMETIC, FROM THE SPECIFICATION ALONE. Level `1`, `xp` `0`, one
// `large` gem: `10` collected against `xpToNext(1)` (`5`). With the switch off
// that leaves `xp` `10`, above the threshold and standing there, level `1`, no
// level-up queued, and the screen still `playing`. With it on, the run reaches
// level `2` with `5` carried and one level-up queued at the end of the tick
// that collected — which the overlay, gated by neither switch, then opens.
//
// THE DRIVE. Two isolated runs, each with a `large` gem posed on the
// lamplighter's own center and one tick, the second with `progression` on.
//
// THE TOLERANCE. `REAL_EPS` on the two experience figures, each a difference
// of stated integers.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNear } from "../assert";
import { GEM_VALUES, REAL_EPS, XP_BASE, xpToNext } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  enable,
  isolate,
  placeGem,
  type Harness,
} from "../harness";

/** The gain one `large` gem carries with no Soot held: `xpMul` is `1`. */
const GAIN = GEM_VALUES.large;

/** What the gain leaves once level `1` is left: `GAIN − xpToNext(1)`. */
const CARRIED = GAIN - xpToNext(1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("banks the gain unspent while off and spends it on the levels it earns when on", async () => {
  const { player } = isolate(h).run;
  placeGem(h, "large", player.x, player.y);
  const held = await advanceTicks(h, 1);
  captureStill(h, "held");

  assertLength(held.run.gems, 0, "the gems left after the collecting tick");
  assertNear(
    held.run.xp,
    GAIN,
    REAL_EPS,
    `run.xp after collecting a large gem with progression off, which stands above xpToNext(1) (${XP_BASE})`,
  );
  assertEqual(held.run.level, 1, "run.level with progression off");
  assertEqual(
    held.run.pendingLevelUps,
    0,
    "run.pendingLevelUps with progression off",
  );
  assertEqual(held.screen, "playing", "the screen after the gain, unspent");

  const again = isolate(h).run;
  enable(h, "progression");
  placeGem(h, "large", again.player.x, again.player.y);
  const spent = await advanceTicks(h, 1);
  captureStill(h, "spent");

  assertEqual(spent.run.level, 2, "run.level with progression on");
  assertNear(
    spent.run.xp,
    CARRIED,
    REAL_EPS,
    "run.xp carried past the threshold with progression on",
  );
  assertEqual(
    spent.run.pendingLevelUps,
    1,
    "run.pendingLevelUps with progression on",
  );
});
