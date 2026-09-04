// Wick — audio/cue-hit-once-per-tick: a tick on which twenty enemies take
// damage plays `hit` once.
//
// WHERE THE THRESHOLD COMES FROM. `specs/ui.md`, Audio: "at most once on that
// tick: a tick on which twenty enemies take damage plays `hit` once, and a
// tick that raises several different cues plays each of those once." The
// specification names this exact scenario and this exact count, so the
// threshold is one and the drive is twenty.
//
// WHY THE WORLD IS POSED AS IT IS. Twenty moths stand evenly around a ring
// `MOTH_RING` (300) units from the lamplighter, and Flare is held and armed.
// A Flare burst "damages every enemy whose circle overlaps it" within its
// `640` radius (`specs/weapons.md`, Flare), so one tick lands twenty hits at
// once, which is the only shape that separates a build playing the cue per
// enemy from one playing it per tick. The ring is far outside `PICKUP_RADIUS`
// (`48`) and the pickup collection distance (`specs/world.md`), so the gems
// and any bread the deaths drop sit where they fell and raise no cue of their
// own on this tick. The run is isolated with every driver switch off but the
// `weaponFire` the arming turns on, and Flare is the only weapon held, so
// nothing else fires.
//
// Whether the moths also die on this tick is beside the point: `kill` is its
// own name, and only the plays named `hit` are counted.
//
// THE TOLERANCE. None. The specification states the count for this scenario
// verbatim, and the collector reads whole frames.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { CUES } from "../constants";
import {
  advanceTicks,
  captureReplay,
  createHarness,
  type Harness,
} from "../harness";
import { burnMoths, cuesOf, heard } from "./cues";

/** The count `specs/ui.md` names in the rule this check decides. */
const MOTHS = 20;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("plays hit once on the tick a burst damages twenty enemies", async () => {
  const { before } = await burnMoths(h, MOTHS);

  const { result: after, played } = await captureReplay(h, "once", () =>
    cuesOf(h, () => advanceTicks(h, 1)),
  );

  // The premise: the burst really did reach all twenty on this one tick.
  assertEqual(
    before.run.enemies.length,
    MOTHS,
    "the moths standing in the burst's radius before the firing tick",
  );
  assertEqual(
    after.run.kills - before.run.kills,
    MOTHS,
    "the enemies the one burst tick took damage to death (specs/weapons.md, Flare)",
  );

  assertEqual(
    heard(played, CUES.hit),
    1,
    "hit cues on the tick twenty enemies took damage (specs/ui.md, Audio)",
  );
});
