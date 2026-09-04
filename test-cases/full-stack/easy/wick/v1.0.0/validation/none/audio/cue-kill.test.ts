// audio/cue-kill — the tick on which a moth dies plays the kill cue.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("Audio"): "`kill` | `CUES.kill` |
// An enemy dies. At most once per tick." specs/enemies.md ("The life of an
// enemy") states the same rule where the death is defined: "On any tick that
// leaves `hp` at or below `0` the enemy dies on that tick: it is removed, the
// kill count rises by one, its drop appears at its center, and the `kill` cue
// plays as `specs/ui.md` states." So the tick that takes a moth's last health is
// a tick that plays `kill`.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night: every driver switch off,
// nothing alive, nothing dropped, no slot held, so nothing but the posed bolt can
// end anything and no other event can arrive from the side. One moth stands
// MOTH_OFFSET (200) units out, far outside its radius 10 plus `PLAYER_RADIUS`
// (12) so it cannot touch the lamplighter, and far outside `PICKUP_RADIUS` (48)
// so the gem the death leaves stays where it falls. One Ember bolt is posed on
// the moth's center with no velocity: a posed projectile "first hits on the next
// tick" (specs/instrumentation.md), and with `effectMotion` off "`ttl` and every
// re-hit entry still count, and hits still resolve", so the bolt hits from where
// it was put on the one stepped tick. An Ember bolt carries `EMBER_LEVELS[0]`
// damage (`10`) against a moth's `5` health (specs/enemies.md), so that tick is
// the death.
//
// The death is asserted before the cue is read, off the kill count and the empty
// enemy list, so a build that never killed the moth and a build that killed it
// in silence report different failures. The same tick also plays `hit`, which
// specs/ui.md allows ("a tick that raises several different cues plays each of
// those once") and which is `audio/cue-hit`'s point.
//
// THE TOLERANCE. None: a cue sounded on the tick or it did not, and a stepped
// frame is exactly one tick of specs/world.md.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertUndefined } from "../assert";
import { TICK_HZ } from "../constants";
import {
  captureReplay,
  createHarness,
  enemyById,
  placeEnemyNear,
  placeProjectile,
  watchNamedCues,
  type Harness,
} from "../harness";
import { assertHeard, openNight } from "./cues";

/** Where the moth stands: outside contact reach and outside `PICKUP_RADIUS`. */
const MOTH_OFFSET = 200;

/** A bolt that hits alone. */
const NO_PIERCE = 0;

/** Frames recorded after the killing tick, for the replay. Decides nothing. */
const TRAIL_FRAMES = TICK_HZ / 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ armAudio: true });
});

afterEach(async () => {
  await h.dispose();
});

it("plays the kill cue on the tick a moth dies", async () => {
  await openNight(h);
  const moth = await placeEnemyNear(h, "moth", MOTH_OFFSET, 0);
  await placeProjectile(h, "ember", moth.x, moth.y, 0, 0, NO_PIERCE);

  const cues = await watchNamedCues(h);
  const killed = await captureReplay(h, "kill", async () => {
    const after = await h.step(1);
    const frame = h.frame();
    await h.step(TRAIL_FRAMES);
    return { after, frame };
  });

  assertUndefined(
    enemyById(killed.after, moth.id),
    "the moth after the tick that took its last health",
  );
  assertEqual(killed.after.run.kills, 1, "the kills the tick counted");
  assertLength(killed.after.run.gems, 1, "the gem the death left behind");
  assertHeard(
    cues,
    killed.frame,
    "kill",
    "the kill cues on the tick the moth died",
  );
});
