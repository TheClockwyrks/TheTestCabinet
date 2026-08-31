// audio/pod-burn-cue — the pod-burn cue sounds once, on the tick a pod burns
// up against the planet, and on no tick before it.
//
// specs/pods.md: "In a tick where the pod's center radius reaches
// `new_r <= 78`, the pod burns up: it is removed, the burn-up particle system
// plays at the pod, and the `pod-burn` cue plays. A burn-up applies no
// effect." specs/assets.md ties the produced file to that event: "play a cue
// on its event". One burn-up, one play, on the burn-up's own tick; the ticks
// of plain falling before it belong to no event.
//
// THE DRIVE PROVES THE BURN-UP. The pod still falls after the lead ticks and
// is gone on the threshold tick — with its kind's effect NOT standing in the
// snapshot, so what the cue is read against is a burn-up rather than a catch
// gone astray.
//
// THE POSE CROSSES STRICTLY. A pod falls at 120 units per second, 2 units of
// radius per tick, so from radius 85 it reads 79 before the threshold tick
// and 77 after it — no reading lands on the 78 threshold itself. The pod is
// posed below the catch radius at an angle far from the deflector's span, so
// no catch can precede the burn-up.
//
// THE WORLD IS ONE POD AND THE PLANET: isolate() empties the field and holds
// both driver switches, and spawnPod leaves the seeded generator where it
// stands.
//
// AUDIO IS ARMED WITH A REAL KEY FIRST. A browser opens no audio context
// without a user gesture, so armAudio presses a key through Chromium's own
// input pipeline — UNBOUND_KEY, which specs/controls.md binds to nothing, so
// arming disturbs no game state — and waits for the produced files to decode,
// so a cue that sounds can be named from the file it came from.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  captureReplay,
  cuesNamed,
  isolate,
  onCue,
  openHarness,
  spawnPodPolar,
  type Harness,
} from "../harness";
import { driveToEvent } from "./cues";

/** The cue specs/pods.md has a pod's burn-up play. */
const CUE = "pod-burn";

/** Posed start radius: 85 - 2 * 3 = 79 before the threshold tick, 77 after. */
const START_RADIUS = 85;

/** A stage angle far from the deflector's span at its start angle of 90. */
const THETA_DEG = 270;

/** Ticks of plain falling before the burn-up, on which no cue may sound. */
const LEAD_TICKS = 3;

/** Ticks driven after the burn-up, so the clip holds the aftermath. */
const TRAIL_TICKS = 3;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("sounds pod-burn once, on the tick the pod burns up", async () => {
  await h.armAudio();
  await isolate(h);
  await spawnPodPolar(h, "widen", START_RADIUS, THETA_DEG);

  const cues = onCue(h);
  const drive = await captureReplay(h, "burn", () =>
    driveToEvent(h, cues, LEAD_TICKS, TRAIL_TICKS),
  );

  // The drive reached the burn-up on the threshold tick and not before.
  assertLength(drive.before.pods, 1, "the falling pod after the lead ticks");
  assertLength(
    drive.after.pods,
    0,
    "pods after the threshold tick: the pod burned up",
  );
  assertEqual(
    drive.after.effects.widenTicks,
    0,
    "the widen timer after the threshold tick: a burn-up applies no effect",
  );

  assertLength(
    cuesNamed(drive.quiet, CUE),
    0,
    `${CUE} cues sounded while the pod was still falling`,
  );
  assertLength(
    cuesNamed(drive.played, CUE),
    1,
    `${CUE} cues sounded by the end of the tick the pod burned up on`,
  );
});
