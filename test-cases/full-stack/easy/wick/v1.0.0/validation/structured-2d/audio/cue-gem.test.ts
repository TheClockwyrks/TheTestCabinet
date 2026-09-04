// Wick — audio/cue-gem: the tick a gem is collected plays `gem`.
//
// WHERE THE THRESHOLD COMES FROM. `specs/ui.md`, Audio: the cue table binds
// `gem` to "A gem is collected. At most once per tick", and "Each is played
// on the tick its event happens ... and at most once on that tick".
// `specs/world.md`, Attraction and flight: "a gem whose center is at most
// `COLLECT_RADIUS` from the lamplighter's center is collected on that tick:
// it is removed, and `xp` rises". One collection on one tick is therefore
// exactly one `gem`.
//
// WHY THE WORLD IS POSED AS IT IS. One small gem on the lamplighter's own
// center, in an isolated run holding nothing else with every driver switch
// off. A gem at distance `0` is inside `COLLECT_RADIUS` (`8`) whatever the
// build's `pickupRadius`, so the collection needs no flight and lands on the
// first tick: "A gem dropped on this tick is attracted and collected by the
// same tests as any other". Nothing else in the world can raise a cue —
// no enemy to damage or kill, no pickup to collect, no contact, and no
// weapon held.
//
// The run is posed at `ISOLATE_LEVEL` (50), whose `xpToNext` is `495`
// (`specs/progression.md`), so the `1` experience a small gem carries queues
// no level-up and the tick opens no overlay beside the collection.
//
// THE TOLERANCE. None: the specification fixes the cue to the tick of the
// collection and to at most one play on it, and the collector reads whole
// frames.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { CUES, GEM_VALUES } from "../constants";
import {
  advanceTicks,
  captureReplay,
  createHarness,
  placeGem,
  type Harness,
} from "../harness";
import { cuesOf, heard, isolatedRun } from "./cues";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("plays gem once on the tick a gem is collected", async () => {
  const before = await isolatedRun(h);
  const { player } = before.run;
  placeGem(h, "small", player.x, player.y);

  const { result: after, played } = await captureReplay(h, "gem", () =>
    cuesOf(h, () => advanceTicks(h, 1)),
  );

  // The premise: the gem really was collected on this tick.
  assertEqual(after.run.gems.length, 0, "the gems left on the field");
  assertEqual(
    after.run.xp - before.run.xp,
    GEM_VALUES.small,
    "the experience the collection granted (specs/world.md, Gems)",
  );

  assertEqual(
    heard(played, CUES.gem),
    1,
    "gem cues on the tick a gem was collected (specs/ui.md, Audio)",
  );
});
