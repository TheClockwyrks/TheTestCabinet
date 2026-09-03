// audio/cue-hurt-once-per-tick — a tick on which three moths each land a hit
// plays hurt exactly once.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("Audio"): "`hurt` | `CUES.hurt` |
// The lamplighter takes damage. At most once per tick", and under the table:
// "Each is played on the tick its event happens ... and at most once on that
// tick". specs/world.md ("Contact damage") has each enemy hit on its own
// schedule: "several overlapping enemies each hit on their own schedule", and
// spawns each with "`contactCooldown` `0`" (specs/enemies.md), so three
// overlapping moths all hit on the same tick. That tick plays `hurt` once, which
// is the count read here.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with `enemyContact` alone
// turned back on: nothing else alive, nothing dropped, and no slot held, so
// nothing can damage the moths, nothing can drop, and the only events on the
// stepped tick are the three hits. Each moth is posed within MOTH_SPREAD (`2`)
// units of the lamplighter's center, well inside its radius `10` plus
// `PLAYER_RADIUS` (`12`), so all three circles overlap; `enemyMotion` stays off,
// so each holds the place it was put.
//
// THE HEALTH IS WHAT PROVES THE THREE HITS. A moth's damage is `5` and `armor` is
// `0` with no Brass held, so three hits take `3 x 5` health from the
// `BASE_MAX_HP` (`100`) a fresh run starts at, nowhere near the ending rule. The
// check reads the fall as at least `MOTHS` times `MIN_DAMAGE_TAKEN` (`1`), the
// floor specs/world.md puts under a hit, so it decides that three hits landed
// without restating the damage figure `contact/` owns.
//
// THE TOLERANCE. None: a count of cues on one tick is a whole number, and the
// specification fixes it at one.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, assertLength } from "../assert";
import { MIN_DAMAGE_TAKEN, TICK_HZ } from "../constants";
import {
  captureReplay,
  createHarness,
  placeEnemyNear,
  player,
  watchNamedCues,
  type Harness,
} from "../harness";
import { assertHeardOnce, openNight } from "./cues";

/** The overlapping moths, as the review item states. */
const MOTHS = 3;

/** How far apart the three stand: inside the overlap either way. */
const MOTH_SPREAD = 2;

/** Frames recorded after the hits, for the replay. Decides nothing. */
const TRAIL_FRAMES = TICK_HZ / 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ armAudio: true });
});

afterEach(async () => {
  await h.dispose();
});

it("plays hurt once on the tick three moths each land a hit", async () => {
  const opened = await openNight(h, { on: ["enemyContact"] });
  for (let i = 0; i < MOTHS; i += 1) {
    await placeEnemyNear(h, "moth", (i - 1) * MOTH_SPREAD, 0);
  }
  const posed = await h.snapshot();
  assertLength(posed.run.enemies, MOTHS, "the moths posed on the lamplighter");

  const cues = await watchNamedCues(h);
  const hurt = await captureReplay(h, "once", async () => {
    const after = await h.step(1);
    const frame = h.frame();
    await h.step(TRAIL_FRAMES);
    return { after, frame };
  });

  assertGreaterThanOrEqual(
    player(opened).hp - player(hurt.after).hp,
    MOTHS * MIN_DAMAGE_TAKEN,
    "the health the three moths' hits took together",
  );
  assertHeardOnce(
    cues,
    hurt.frame,
    "hurt",
    "the hurt cues on the tick three moths hit",
  );
});
