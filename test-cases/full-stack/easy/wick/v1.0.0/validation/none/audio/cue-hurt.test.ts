// audio/cue-hurt — the tick on which a moth's contact hit lands plays the hurt
// cue.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("Audio"): "`hurt` | `CUES.hurt` |
// The lamplighter takes damage. At most once per tick", and under the table:
// "Each is played on the tick its event happens". What a contact hit is, is
// specs/world.md ("Contact damage"): "An overlapping enemy whose
// `contactCooldown` is due lands a hit: `hp` falls by
// `max(MIN_DAMAGE_TAKEN, enemy damage - armor)`, and its `contactCooldown` is set
// to `CONTACT_COOLDOWN`." So the tick a moth's hit lands is a tick that plays
// `hurt`.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with `enemyContact` alone
// turned back on: nothing else alive, nothing dropped, and no slot held, so
// nothing can damage the moth, nothing can drop, and the only event on the
// stepped tick is the hit. The moth is posed on the lamplighter's center, at
// distance `0`, which is inside its radius `10` plus `PLAYER_RADIUS` (`12`), so
// the circles overlap; specs/enemies.md spawns it with "`contactCooldown` `0`",
// and specs/world.md counts a timer due "on every tick on which it is `0` after
// its count-down", so the hit lands on the first stepped tick.
// `enemyMotion` stays off, so the moth holds the place it was put.
//
// A moth's damage is `5` and `armor` is `0` with no Brass held, so the hit takes
// `5` health from the `BASE_MAX_HP` (`100`) a fresh run starts at, nowhere near
// the ending rule. The fall is asserted before the cue is read, so a build that
// never landed the hit and a build that landed it in silence report different
// failures.
//
// THE TOLERANCE. None on the cue: it sounded on the tick or it did not. The
// health is read as a fall rather than as a figure, since how much a hit takes is
// `contact/`'s point.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThan } from "../assert";
import { TICK_HZ } from "../constants";
import {
  captureReplay,
  createHarness,
  placeEnemyNear,
  player,
  watchNamedCues,
  type Harness,
} from "../harness";
import { assertHeard, openNight } from "./cues";

/** Frames recorded after the hit, for the replay. Decides nothing. */
const TRAIL_FRAMES = TICK_HZ / 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("plays the hurt cue on the tick a moth's contact hit lands", async () => {
  const opened = await openNight(h, { on: ["enemyContact"] });
  await placeEnemyNear(h, "moth", 0, 0);

  const cues = await watchNamedCues(h);
  const hurt = await captureReplay(h, "hurt", async () => {
    const after = await h.step(1);
    const frame = h.frame();
    await h.step(TRAIL_FRAMES);
    return { after, frame };
  });

  assertLessThan(
    player(hurt.after).hp,
    player(opened).hp,
    "the lamplighter's health after the moth's hit",
  );
  assertHeard(
    cues,
    hurt.frame,
    "hurt",
    "the hurt cues on the tick the moth's hit landed",
  );
});
