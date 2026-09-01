// audio/cue-hit-once-per-tick — a tick on which twenty moths take damage plays
// hit exactly once.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("Audio") states the figure
// outright: "Each is played on the tick its event happens, or on the frame for a
// menu event, and at most once on that tick: a tick on which twenty enemies take
// damage plays `hit` once". The cue table carries the same rule in its row:
// "`hit` | An enemy takes damage. At most once per tick." So the count read here
// is exactly one, and MOTHS (`20`) is the specification's own example.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with `weaponFire` alone
// turned back on: nothing alive but the twenty moths, nothing dropped, and no
// slot held but the Flare the check gives it, so the burst is the only thing that
// can damage anything on the stepped tick. specs/weapons.md ("Flare"): "On
// firing, every enemy within `radius` of the player's center takes `damage` on
// that tick", with `FLARE_LEVELS[0]` radius `640`, and "Flare fires whether or
// not any enemy exists". The moths stand on a circle of RING_RADIUS (`300`)
// units: inside the burst's `640`, outside contact reach (a moth's radius 10 plus
// `PLAYER_RADIUS` 12), and outside `PICKUP_RADIUS` (`48`) so the twenty gems the
// deaths leave stay where they fall instead of flying in and raising `gem`.
// specs/weapons.md ("Common rules"): "On acquisition the timer is `0`, so a
// weapon fires on the first `playing` tick it is held", which is the one tick
// this steps.
//
// WHAT THE SAME TICK ALSO DOES. `FLARE_LEVELS[0]` damage (`100`) against a moth's
// `5` health kills all twenty, so the tick raises `kill` beside `hit`, once each
// — which is what specs/ui.md asks and what `audio/cue-kill-once-per-tick`
// reads. This point counts `hit` alone. That twenty moths were struck at all is
// asserted off the kill count before the count of cues is read.
//
// THE TOLERANCE. None: a count of cues on one tick is a whole number, and the
// specification fixes it at one.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { TICK_HZ } from "../constants";
import {
  captureReplay,
  createHarness,
  fireWeapon,
  watchNamedCues,
  type Harness,
} from "../harness";
import { assertHeardOnce, openNight, ringOfMoths } from "./cues";

/** The specification's own example: "a tick on which twenty enemies take damage". */
const MOTHS = 20;

/** Inside the burst's radius 640, outside contact reach and `PICKUP_RADIUS`. */
const RING_RADIUS = 300;

/** Frames recorded after the burst, for the replay. Decides nothing. */
const TRAIL_FRAMES = TICK_HZ / 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("plays hit once on the tick a burst damages twenty moths", async () => {
  await openNight(h);
  const moths = await ringOfMoths(h, MOTHS, RING_RADIUS);
  assertLength(moths, MOTHS, "the moths posed around the lamplighter");

  const cues = await watchNamedCues(h);
  const burst = await captureReplay(h, "once", async () => {
    const fired = await fireWeapon(h, "flare");
    const frame = h.frame();
    await h.step(TRAIL_FRAMES);
    return { fired, frame };
  });

  assertEqual(
    burst.fired.after.run.kills,
    MOTHS,
    "the moths the burst's damage took to 0 health",
  );
  assertHeardOnce(
    cues,
    burst.frame,
    "hit",
    "the hit cues on the tick the burst damaged twenty moths",
  );
});
