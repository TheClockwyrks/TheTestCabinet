// audio/cue-pickup-draft — the tick on which a draft is collected plays the
// pickup cue.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("Audio"): "`pickup` |
// `CUES.pickup` | Bread or a draft is collected", and under the table: "Each is
// played on the tick its event happens". What collection is, is specs/world.md
// ("Collection"): a pickup is collected "on any tick on which the distance
// between its center and the lamplighter's center is less than
// `PICKUP_ITEM_RADIUS` (`16`) plus `PLAYER_RADIUS`", and "Every bread and draft
// that meets the condition on a tick is collected on that tick". So a draft posed
// on the lamplighter's center, at distance `0`, is collected by the next tick,
// and that tick plays `pickup`. Bread is the other half of the row and is
// `audio/cue-pickup-bread`'s point; a build that sounds one kind and not the
// other must grade differently from one that sounds neither.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night: every driver switch off,
// nothing alive, nothing else dropped, and no slot held, so the draft is the
// whole of the field and nothing else can raise a cue on the tick. In particular
// no gem is on the field, so what specs/world.md gives a draft — "Every gem on
// the field becomes attracted" — reaches nothing and no `gem` cue can ride
// beside `pickup`. That the draft was collected is asserted off the emptied
// pickup list before the cue is read.
//
// THE TOLERANCE. None: a cue sounded on the tick or it did not, and a stepped
// frame is exactly one tick of specs/world.md.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength } from "../assert";
import { TICK_HZ } from "../constants";
import {
  captureReplay,
  collectPickup,
  createHarness,
  watchNamedCues,
  type Harness,
} from "../harness";
import { assertHeard, openNight } from "./cues";

/** Frames recorded after the collecting tick, for the replay. Decides nothing. */
const TRAIL_FRAMES = TICK_HZ / 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ armAudio: true });
});

afterEach(async () => {
  await h.dispose();
});

it("plays the pickup cue on the tick a draft is collected", async () => {
  const opened = await openNight(h);
  assertLength(opened.run.pickups, 0, "the pickups the isolated night holds");

  const cues = await watchNamedCues(h);
  const taken = await captureReplay(h, "draft", async () => {
    const after = await collectPickup(h, "draft");
    const frame = h.frame();
    await h.step(TRAIL_FRAMES);
    return { after, frame };
  });

  assertLength(taken.after.run.pickups, 0, "the pickups left after the tick");
  assertHeard(
    cues,
    taken.frame,
    "pickup",
    "the pickup cues on the tick the draft was collected",
  );
});
