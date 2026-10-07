// Wick — audio/cue-hit: the tick a bolt damages an enemy plays `hit`.
//
// WHERE THE THRESHOLD COMES FROM. `specs/ui.md`, Audio: the cue table binds
// `hit` to "An enemy takes damage. At most once per tick", and the paragraph
// under it fixes when it sounds: "Each is played on the tick its event
// happens, or on the frame for a menu event, and at most once on that tick."
// One damaged enemy on one tick is therefore exactly one `hit`, and the
// threshold is that count. `specs/instrumentation.md`: "A pose changes the
// state alone and sounds nothing; the cues a scenario hears come from the
// ticks run after it", so every cue read here was raised by the driven tick.
//
// WHY THE WORLD IS POSED AS IT IS. The requirement is DAMAGE, not death, so
// the tick under test has to carry a hit that no enemy dies on: a build that
// sounded `hit` from its death path alone would otherwise pass. The
// specification's damage figures decide which enemy stands here. The weakest
// bolt `spawnProjectile` can place carries its weapon's level-1 row damage
// (`specs/instrumentation.md`), and `specs/enemies.md`'s roster gives the
// Hound `120` HP against Ember's `10` (`specs/weapons.md`, Ember), so the
// bolt takes the Hound to `110` and the tick damages without killing. A moth
// (`5` HP) dies to every bolt in the game and could not express this
// requirement.
//
// The world holds the Hound and the bolt and nothing else: an isolated run
// with every driver switch off, so no spawn, event, despawn, enemy move,
// contact hit, weapon firing, or effect motion arrives on top of the hit.
// The bolt is posed at the Hound's own center, and "a posed enemy,
// projectile, puddle, gem, or pickup first moves, first hits, and first
// pulses on the next tick" (`specs/instrumentation.md`), so exactly one tick
// separates the arrangement from the hit. Hits resolve whatever `effectMotion`
// holds ("`ttl` and every re-hit entry still count, and hits still resolve"),
// so the bolt hits from where it was placed.
//
// THE TOLERANCE. None, and none would be honest: "at most once on that tick"
// and "played when an enemy takes damage" fix the count at exactly one, and
// the collector reads whole frames.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThan } from "../assert";
import { CUES } from "../constants";
import {
  advanceTicks,
  captureReplay,
  createHarness,
  enemyById,
  placeEnemyNear,
  placeProjectile,
  type Harness,
} from "../harness";
import { cuesOf, heard, isolatedRun } from "./cues";

/** Where the Hound and the bolt stand, clear of nothing else in the world. */
const POST = { x: 240, y: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("plays hit once on the tick a bolt damages a live enemy", async () => {
  await isolatedRun(h);
  const hound = placeEnemyNear(h, "hound", POST.x, POST.y);
  const before = h.snapshot();
  placeProjectile(h, "ember", POST.x, POST.y, 0, 0, 0);

  const { result: after, played } = await captureReplay(h, "hit", () =>
    cuesOf(h, () => advanceTicks(h, 1)),
  );

  // The premise: this tick really was a tick on which an enemy took damage
  // and lived, so what the cue count decides is the damage rule alone.
  const damaged = enemyById(after, hound);
  assertEqual(
    damaged === undefined,
    false,
    "whether the Hound outlived the bolt (specs/enemies.md, 120 HP against Ember's 10)",
  );
  assertLessThan(
    damaged?.hp ?? Number.POSITIVE_INFINITY,
    before.run.enemies[0].hp,
    "the Hound's hp after the bolt hit it",
  );

  assertEqual(
    heard(played, CUES.hit),
    1,
    "hit cues on the tick a bolt damaged an enemy (specs/ui.md, Audio)",
  );
});
