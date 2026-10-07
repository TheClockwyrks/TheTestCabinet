// audio/cue-hit — the tick on which a bolt damages a moth plays the hit cue.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("Audio") binds the cue to its
// event in one row: "`hit` | `CUES.hit` | An enemy takes damage. At most once per
// tick." specs/weapons.md ("Hits and death") says the same from the other side:
// "Hits and deaths play the `hit` and `kill` cues as `specs/ui.md` states." And
// the paragraph under the table fixes WHEN: "Each is played on the tick its event
// happens, or on the frame for a menu event". So the tick a bolt takes a moth's
// health is a tick that plays `hit`.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night: every driver switch off,
// nothing alive, nothing dropped, no slot held, so nothing but the posed bolt can
// touch anything and no other cue's event can arrive from the side. One moth
// stands MOTH_OFFSET (200) units out, which is far outside its radius 10 plus
// `PLAYER_RADIUS` (12), so it cannot touch the lamplighter, and far outside
// `PICKUP_RADIUS` (48), so the gem it leaves stays where it falls rather than
// flying in and raising `gem` on a later frame. One Ember bolt is posed on the
// moth's center with no velocity: specs/instrumentation.md has a posed
// projectile "first hit on the next tick", and `setEffectMotion(false)` leaves
// "`ttl` and every re-hit entry still count, and hits still resolve", so the
// bolt hits from exactly where it was put on the one stepped tick.
//
// WHAT THE HITTING TICK ALSO DOES. An Ember bolt carries `EMBER_LEVELS[0]`
// damage (`10`) and a moth spawns with `5` health (specs/enemies.md), so the
// moth dies on the same tick and the tick raises `kill` beside `hit` —
// specs/ui.md allows exactly that: "a tick that raises several different cues
// plays each of those once". This point reads `hit`; `kill` is
// `audio/cue-kill`'s. The death is also what proves the damage landed at all,
// which is asserted before the cue is read so a silent build and an unhurt moth
// are told apart.
//
// THE TOLERANCE. None: a cue sounded on the tick or it did not, and the tick is
// exact because a stepped frame is one tick of `specs/world.md` and the harness
// stamps each sound with the frame it went out on.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertUndefined } from "../assert";
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

/** A bolt that hits alone, so the moth takes one shape's damage. */
const NO_PIERCE = 0;

/** Frames recorded after the hitting tick, so the replay shows the night. Decides nothing. */
const TRAIL_FRAMES = TICK_HZ / 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ armAudio: true });
});

afterEach(async () => {
  await h.dispose();
});

it("plays the hit cue on the tick a bolt damages a moth", async () => {
  await openNight(h);
  const moth = await placeEnemyNear(h, "moth", MOTH_OFFSET, 0);
  await placeProjectile(h, "ember", moth.x, moth.y, 0, 0, NO_PIERCE);

  const cues = await watchNamedCues(h);
  const struck = await captureReplay(h, "hit", async () => {
    const after = await h.step(1);
    const frame = h.frame();
    await h.step(TRAIL_FRAMES);
    return { after, frame };
  });

  assertUndefined(
    enemyById(struck.after, moth.id),
    "the moth the bolt's damage took to 0 health",
  );
  assertEqual(struck.after.run.kills, 1, "the kills the hitting tick counted");
  assertHeard(
    cues,
    struck.frame,
    "hit",
    "the hit cues on the tick the bolt damaged the moth",
  );
});
