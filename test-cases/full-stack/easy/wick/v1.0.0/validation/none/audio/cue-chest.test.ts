// audio/cue-chest — the tick that collects a chest and opens the overlay plays
// the chest cue.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("Audio"): "`chest` |
// `CUES.chest` | A chest overlay opens", and under the table: "Each is played on
// the tick its event happens". When the overlay opens is specs/progression.md
// ("The chest overlay"): "On the tick it is collected the tick runs to
// completion, the chest's result is applied ..., `chestResult` records it, and
// `screen` becomes `chest` with `menuIndex` `0`." What collection is, is
// specs/world.md ("Collection"): a pickup is collected "on any tick on which the
// distance between its center and the lamplighter's center is less than
// `PICKUP_ITEM_RADIUS` (`16`) plus `PLAYER_RADIUS`". So a chest posed on the
// lamplighter's center, at distance `0`, is collected by the next tick, and that
// tick plays `chest`.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night: every driver switch off,
// nothing alive, nothing else dropped, and no slot held, so the chest is the
// whole of the field and nothing else can raise a cue on the tick. With no weapon
// and no passive held, specs/evolutions.md ("Opening a chest") runs out of its
// first two rules — nothing is at `MAX_WEAPON_LEVEL` with its recipe passive, and
// there is no held item below its max — and the result is the third, `heal`, so
// no `evolve` cue rides beside `chest`. That the overlay opened at all is
// asserted off the screen and `chestResult` before the cue is read.
//
// THE TOLERANCE. None: a cue sounded on the tick or it did not, and a stepped
// frame is exactly one tick of specs/world.md.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { TICK_HZ } from "../constants";
import {
  captureReplay,
  createHarness,
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

it("plays the chest cue on the tick a chest opens its overlay", async () => {
  await openNight(h);

  const cues = await watchNamedCues(h);
  const opened = await captureReplay(h, "chest", async () => {
    const after = await openChest(h);
    const frame = h.frame();
    await h.step(TRAIL_FRAMES);
    return { after, frame };
  });

  assertEqual(opened.after.screen, "chest", "the screen the collection opened");
  assertNotNull(opened.after.run.chestResult, "the result the chest recorded");
  assertHeard(
    cues,
    opened.frame,
    "chest",
    "the chest cues on the tick the overlay opened",
  );
});
