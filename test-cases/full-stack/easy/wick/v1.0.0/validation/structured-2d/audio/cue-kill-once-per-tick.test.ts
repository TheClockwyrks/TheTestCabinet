// Wick — audio/cue-kill-once-per-tick: a tick on which twenty enemies die
// plays `kill` once.
//
// WHERE THE THRESHOLD COMES FROM. `specs/ui.md`, Audio: the cue table binds
// `kill` to "An enemy dies. At most once per tick", and the rule under the
// table is stated for every one-shot cue alike: "Each is played on the tick
// its event happens ... and at most once on that tick: a tick on which twenty
// enemies take damage plays `hit` once, and a tick that raises several
// different cues plays each of those once." Twenty deaths on one tick are
// therefore one `kill`.
//
// WHY THE WORLD IS POSED AS IT IS. Twenty moths stand evenly around a ring
// `MOTH_RING` (300) units from the lamplighter, and Flare is held and armed.
// `specs/enemies.md` gives a moth `5` HP and `specs/weapons.md` gives a Flare
// burst `100` damage over a `640` radius, so the one armed tick takes all
// twenty below `0` at once, which is the only shape that separates a build
// playing the cue per death from one playing it per tick. The ring is far
// outside `PICKUP_RADIUS` (`48`) and the pickup collection distance
// (`specs/world.md`), so the twenty gems and any bread the deaths drop sit
// where they fell and raise no cue of their own. The run is isolated with
// every driver switch off but the `weaponFire` the arming turns on, and Flare
// is the only weapon held, so nothing else fires.
//
// THE TOLERANCE. None. The count is fixed at one by the stated rule, and the
// collector reads whole frames.

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

/** Twenty deaths on one tick, the pile-up the once-per-tick rule is about. */
const MOTHS = 20;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("plays kill once on the tick twenty enemies die", async () => {
  const { before } = await burnMoths(h, MOTHS);

  const { result: after, played } = await captureReplay(h, "once", () =>
    cuesOf(h, () => advanceTicks(h, 1)),
  );

  // The premise: all twenty really died on this one tick.
  assertEqual(
    after.run.enemies.length,
    0,
    "the moths left alive after the burst tick",
  );
  assertEqual(
    after.run.kills - before.run.kills,
    MOTHS,
    "the deaths the one burst tick produced (specs/enemies.md)",
  );

  assertEqual(
    heard(played, CUES.kill),
    1,
    "kill cues on the tick twenty enemies died (specs/ui.md, Audio)",
  );
});
