// audio/cue-evolve — the tick on which a chest evolves Taper plays the evolve
// cue.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("Audio"): "`evolve` |
// `CUES.evolve` | A weapon evolves", and under the table: "Each is played on the
// tick its event happens". specs/evolutions.md ("Opening a chest") states the
// same rule where an evolution is defined: "The evolved weapon replaces its base
// in the same slot with a single level, its cooldown timer is set to `0` ..., the
// passive stays held, and the `evolve` cue plays."
//
// WHY THIS RECIPE. specs/evolutions.md ("The recipe"): "A base weapon is
// eligible to evolve when all three hold at once: it is held at
// `MAX_WEAPON_LEVEL` (`8`); the passive its recipe names is held, at any level;
// the player opens a chest", and the table's first row is "Pyre | `pyre` | Taper
// | Wick". So Taper at level `MAX_WEAPON_LEVEL` with Wick held is exactly the
// eligible loadout, and the first of the three chest rules applies: "the first
// base weapon at `MAX_WEAPON_LEVEL` whose recipe passive is held at any level
// evolves".
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night: every driver switch off,
// nothing alive, nothing else dropped, so nothing can hit, drop, or collect
// beside the chest, and `weaponFire` off means the Taper in the slot fires
// nothing on the way. The only slots held are the two the recipe names, so no
// other weapon can be the one the chest picks. The chest is posed on the
// lamplighter's center, at distance `0`, inside `PICKUP_ITEM_RADIUS` (`16`) plus
// `PLAYER_RADIUS` (`12`), so the next tick collects it. That the evolution
// happened is asserted off `chestResult` before the cue is read, so a build that
// leveled instead of evolving reports that rather than a missing cue. The same
// tick also opens the overlay and raises `chest`, which specs/ui.md allows and
// which `audio/cue-chest` reads.
//
// THE TOLERANCE. None: a cue sounded on the tick or it did not.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { MAX_WEAPON_LEVEL, TICK_HZ } from "../constants";
import {
  captureReplay,
  createHarness,
  holdPassive,
  holdWeapon,
  openChest,
  watchNamedCues,
  type Harness,
} from "../harness";
import { assertHeard, openNight } from "./cues";

/** Frames recorded on the open overlay, for the replay. Decides nothing. */
const TRAIL_FRAMES = TICK_HZ / 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ armAudio: true });
});

afterEach(async () => {
  await h.dispose();
});

it("plays the evolve cue on the tick a chest evolves Taper", async () => {
  await openNight(h);
  await holdWeapon(h, "taper", MAX_WEAPON_LEVEL);
  await holdPassive(h, "wick", 1);

  const cues = await watchNamedCues(h);
  const evolved = await captureReplay(h, "evolve", async () => {
    const after = await openChest(h);
    const frame = h.frame();
    await h.step(TRAIL_FRAMES);
    return { after, frame };
  });

  assertEqual(
    evolved.after.screen,
    "chest",
    "the screen the collection opened",
  );
  assertDeepEqual(
    evolved.after.run.chestResult,
    { kind: "evolve", weapon: "pyre" },
    "the result the chest recorded for Taper at its top level with Wick held",
  );
  assertHeard(
    cues,
    evolved.frame,
    "evolve",
    "the evolve cues on the tick Taper evolved",
  );
});
