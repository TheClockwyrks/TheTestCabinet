// audio/cue-pickup-not-on-gem-or-chest — collecting a gem plays no pickup cue,
// and neither does collecting a chest.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("Audio") binds `pickup` to two
// collections and no others: "`pickup` | `CUES.pickup` | Bread or a draft is
// collected". A gem's collection has its own row, "`gem` | `CUES.gem` | A gem is
// collected", and a chest's has "`chest` | `CUES.chest` | A chest overlay opens".
// specs/world.md ("Pickups") keeps the three kinds apart the same way, listing
// `chest`, `bread`, and `draft` with different effects, and gems in a section of
// their own. So a tick that collects a gem and a tick that collects a chest each
// play `pickup` zero times.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night: every driver switch off,
// nothing alive, nothing else dropped, and no slot held, so on each of the two
// ticks the one thing posed is the whole of the field, and nothing else can
// collect. Each is posed on the lamplighter's center, at distance `0`: the gem
// inside `COLLECT_RADIUS` (`8`) and the chest inside `PICKUP_ITEM_RADIUS` (`16`)
// plus `PLAYER_RADIUS` (`12`), so each is taken on the next tick. The gem is a
// `small` one worth `GEM_VALUES.small` (`1`) experience, and `isolate` holds the
// run at level `50`, where `xpToNext(50)` is `495`, so no level-up overlay opens
// between the two legs. That each collection actually happened is asserted — the
// gem list emptied and the experience risen, the chest overlay opened — before
// the silence is read, so a build that collected nothing reports that rather than
// a spurious pass.
//
// THE TOLERANCE. None: a count of cues on one tick is a whole number, and the
// specification fixes it at zero on both ticks.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLength } from "../assert";
import { TICK_HZ } from "../constants";
import {
  captureReplay,
  collectGem,
  createHarness,
  openChest,
  watchNamedCues,
  type Harness,
} from "../harness";
import { assertSilent, openNight } from "./cues";

/** Frames recorded after each collection, for the replay. Decides nothing. */
const TRAIL_FRAMES = TICK_HZ / 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ armAudio: true });
});

afterEach(async () => {
  await h.dispose();
});

it("plays no pickup cue on the tick a gem or a chest is collected", async () => {
  const opened = await openNight(h);

  const cues = await watchNamedCues(h);
  const taken = await captureReplay(h, "silent", async () => {
    const gem = await collectGem(h, "small");
    const gemFrame = h.frame();
    await h.step(TRAIL_FRAMES);

    const chest = await openChest(h);
    const chestFrame = h.frame();
    await h.step(TRAIL_FRAMES);

    return { gem, gemFrame, chest, chestFrame };
  });

  assertLength(taken.gem.run.gems, 0, "the gems left after the gem's tick");
  assertGreaterThan(
    taken.gem.run.xp,
    opened.run.xp,
    "the experience the gem's collection added",
  );
  assertSilent(
    cues,
    taken.gemFrame,
    "pickup",
    "the pickup cues on the tick a gem was collected",
  );

  assertEqual(
    taken.chest.screen,
    "chest",
    "the screen the chest's collection opened",
  );
  assertSilent(
    cues,
    taken.chestFrame,
    "pickup",
    "the pickup cues on the tick a chest was collected",
  );
});
