// Wick — audio/cue-gem-once-per-tick: a tick on which five gems are collected
// plays `gem` once.
//
// WHERE THE THRESHOLD COMES FROM. `specs/ui.md`, Audio: the cue table binds
// `gem` to "A gem is collected. At most once per tick", and the rule under
// the table states the once-per-tick bound for every one-shot cue alike:
// "Each is played on the tick its event happens ... and at most once on that
// tick". Five collections on one tick are therefore one `gem`.
//
// WHY THE WORLD IS POSED AS IT IS. Five small gems on the lamplighter's own
// center, in an isolated run holding nothing else with every driver switch
// off. `specs/world.md` collects every gem within `COLLECT_RADIUS` (`8`) of
// the lamplighter's center on the tick it is within it, so all five are
// collected on the same tick, which is the only shape that separates a build
// playing the cue per gem from one playing it per tick. No enemy, pickup, or
// weapon is in the world, so nothing else raises a cue on that tick.
//
// The run is posed at `ISOLATE_LEVEL` (50), whose `xpToNext` is `495`
// (`specs/progression.md`), so the `5` experience five small gems carry
// queues no level-up and the tick opens no overlay.
//
// THE TOLERANCE. None: the count is fixed at one by the stated rule, and the
// collector reads whole frames.

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

/** The count the review item drives: five gems collected together. */
const GEMS = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("plays gem once on the tick five gems are collected", async () => {
  const before = await isolatedRun(h);
  const { player } = before.run;
  for (let index = 0; index < GEMS; index += 1) {
    placeGem(h, "small", player.x, player.y);
  }

  const { result: after, played } = await captureReplay(h, "once", () =>
    cuesOf(h, () => advanceTicks(h, 1)),
  );

  // The premise: all five really were collected on this one tick.
  assertEqual(after.run.gems.length, 0, "the gems left on the field");
  assertEqual(
    after.run.xp - before.run.xp,
    GEMS * GEM_VALUES.small,
    "the experience five collections granted (specs/world.md, Gems)",
  );

  assertEqual(
    heard(played, CUES.gem),
    1,
    "gem cues on the tick five gems were collected (specs/ui.md, Audio)",
  );
});
