// Wick — audio/cue-pickup-draft: the tick a draft is collected plays
// `pickup`.
//
// WHERE THE THRESHOLD COMES FROM. `specs/ui.md`, Audio: the cue table binds
// `pickup` to "Bread or a draft is collected", and "Each is played on the
// tick its event happens ... and at most once on that tick."
// `specs/world.md`, Collection: "A pickup is collected on any tick on which
// the distance between its center and the lamplighter's center is less than
// `PICKUP_ITEM_RADIUS` (`16`) plus `PLAYER_RADIUS`", and a draft's collection
// makes "Every gem on the field becomes attracted". One collection on one
// tick is therefore exactly one `pickup`, and the draft is the second of the
// two kinds the cue covers.
//
// WHY THE WORLD IS POSED AS IT IS. One draft on the lamplighter's own center
// in an isolated run with every driver switch off. A distance of `0` is
// inside the collection distance whatever the build's pickup radius, so the
// collection lands on the first tick.
//
// One gem stands `FAR_GEM` (900) units out, far outside `PICKUP_RADIUS`
// (`48`) at every Lure level: it is what makes the draft's own effect
// readable, so the tick is provably a draft collection rather than a pickup
// of any kind. `GEM_SPEED` is `600` units per second, so one tick moves it
// `10` units and it is nowhere near `COLLECT_RADIUS` (`8`) of the
// lamplighter — no `gem` cue rides along, and only the plays named `pickup`
// are counted in any case.
//
// THE TOLERANCE. None: the specification fixes the cue to the tick of the
// collection and to at most one play on it, and the collector reads whole
// frames.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { CUES } from "../constants";
import {
  advanceTicks,
  captureReplay,
  createHarness,
  gemById,
  placeGem,
  placePickup,
  type Harness,
} from "../harness";
import { cuesOf, heard, isolatedRun } from "./cues";

/** How far out the witness gem stands: far outside every pickup radius. */
const FAR_GEM = 900;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("plays pickup once on the tick a draft is collected", async () => {
  const before = await isolatedRun(h);
  const { player } = before.run;
  const gem = placeGem(h, "small", player.x + FAR_GEM, player.y);
  placePickup(h, "draft", player.x, player.y);

  const { result: after, played } = await captureReplay(h, "draft", () =>
    cuesOf(h, () => advanceTicks(h, 1)),
  );

  // The premise: the draft really was collected on this tick, which its own
  // effect on the distant gem shows.
  assertEqual(after.run.pickups.length, 0, "the pickups left on the field");
  assertEqual(
    gemById(after, gem)?.attracted,
    true,
    "the distant gem the draft attracted (specs/world.md, Pickups)",
  );

  assertEqual(
    heard(played, CUES.pickup),
    1,
    "pickup cues on the tick a draft was collected (specs/ui.md, Audio)",
  );
});
