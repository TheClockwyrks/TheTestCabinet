// audio/cue-kill-once-per-tick — a tick on which twenty moths die plays kill
// exactly once.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("Audio"): "`kill` | `CUES.kill` |
// An enemy dies. At most once per tick", and the paragraph under the table:
// "Each is played on the tick its event happens ... and at most once on that
// tick: a tick on which twenty enemies take damage plays `hit` once, and a tick
// that raises several different cues plays each of those once." So twenty deaths
// on one tick are one `kill`, and the count read here is exactly one.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with `weaponFire` alone
// turned back on: nothing alive but the twenty moths, nothing dropped, and no
// slot held but the Flare the check gives it, so the burst is the only thing that
// can end anything on the stepped tick. specs/weapons.md ("Flare"): "On firing,
// every enemy within `radius` of the player's center takes `damage` on that
// tick", with `FLARE_LEVELS[0]` radius `640` and damage `100` against a moth's
// `5` health (specs/enemies.md), so every moth inside the burst dies on that one
// tick. The moths stand on a circle of RING_RADIUS (`300`) units: inside the
// burst, outside contact reach (a moth's radius 10 plus `PLAYER_RADIUS` 12), and
// outside `PICKUP_RADIUS` (`48`) so the gems the deaths leave stay where they
// fall rather than flying in and raising `gem` on the same tick.
// specs/weapons.md: "On acquisition the timer is `0`, so a weapon fires on the
// first `playing` tick it is held", which is the one tick this steps.
//
// That twenty moths actually died is asserted off the kill count and the gems
// they left before the cues are counted, so a build that killed none and a build
// that killed twenty in silence report different failures. The same tick also
// raises `hit`, which `audio/cue-hit-once-per-tick` reads.
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

/** The specification's own example: twenty enemies on one tick. */
const MOTHS = 20;

/** Inside the burst's radius 640, outside contact reach and `PICKUP_RADIUS`. */
const RING_RADIUS = 300;

/** Frames recorded after the burst, for the replay. Decides nothing. */
const TRAIL_FRAMES = TICK_HZ / 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ armAudio: true });
});

afterEach(async () => {
  await h.dispose();
});

it("plays kill once on the tick a burst kills twenty moths", async () => {
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

  assertLength(
    burst.fired.after.run.enemies,
    0,
    "the moths left alive after the burst",
  );
  assertEqual(burst.fired.after.run.kills, MOTHS, "the kills the tick counted");
  assertHeardOnce(
    cues,
    burst.frame,
    "kill",
    "the kill cues on the tick twenty moths died",
  );
});
