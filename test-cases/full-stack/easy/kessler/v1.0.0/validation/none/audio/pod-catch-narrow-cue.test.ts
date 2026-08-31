// audio/pod-catch-narrow-cue — catching a narrow pod plays pod-catch-narrow
// rather than pod-catch.
//
// specs/pods.md fixes the catch's cue by kind: "the `pod-catch` cue plays
// (`pod-catch-narrow` for a `narrow` pod), and the kind's effect applies."
// specs/assets.md produces the two as distinct files and says why: "
// `pod-catch-narrow` is told from `pod-catch` by ear alone, so a bad catch is
// heard as bad news." What is decided here is the substitution: on a narrow
// catch, pod-catch-narrow sounds once on the catch tick and pod-catch does
// not sound at all.
//
// THE DRIVE PROVES THE CATCH. The pod still falls after the lead ticks, is
// gone on the crossing tick, and the narrow span effect stands in the
// snapshot — its timer running — so the cue is read against a genuine narrow
// catch.
//
// THE POSE CROSSES STRICTLY. A pod falls at 120 units per second, 2 units of
// radius per tick, so from radius 203 it reads 197 before the crossing tick
// and 195 after it — no reading lands on the 196 catch boundary. The pod
// falls at the deflector's center angle, dead-center in the span.
//
// THE WORLD IS ONE POD AND THE DEFLECTOR: isolate() empties the field and
// holds both driver switches, and spawnPod leaves the seeded generator where
// it stands.
//
// AUDIO IS ARMED WITH A REAL KEY FIRST. A browser opens no audio context
// without a user gesture, so armAudio presses a key through Chromium's own
// input pipeline — UNBOUND_KEY, which specs/controls.md binds to nothing, so
// arming disturbs no game state — and waits for the produced files to decode,
// so a cue that sounds can be named from the file it came from.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLength } from "../assert";
import { PADDLE_START_ANGLE } from "../constants";
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

/** The narrow catch's own cue, and the cue it replaces. */
const NARROW_CUE = "pod-catch-narrow";
const PLAIN_CUE = "pod-catch";

/** Posed start radius: 203 - 2 * 3 = 197 before the crossing tick, 195 after. */
const START_RADIUS = 203;

/** Ticks of plain falling before the catch, on which no cue may sound. */
const LEAD_TICKS = 3;

/** Ticks driven after the catch, so the clip holds the aftermath. */
const TRAIL_TICKS = 3;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("plays pod-catch-narrow, not pod-catch, on a narrow catch", async () => {
  await h.armAudio();
  await isolate(h);
  await spawnPodPolar(h, "narrow", START_RADIUS, PADDLE_START_ANGLE);

  const cues = onCue(h);
  const drive = await captureReplay(h, "narrow-catch", () =>
    driveToEvent(h, cues, LEAD_TICKS, TRAIL_TICKS),
  );

  // The drive reached the narrow catch on the crossing tick and not before.
  assertLength(
    drive.before.pods,
    1,
    "the falling narrow pod after the lead ticks",
  );
  assertLength(
    drive.after.pods,
    0,
    "pods after the crossing tick: the narrow pod was caught",
  );
  assertGreaterThan(
    drive.after.effects.narrowTicks,
    0,
    "the narrow timer after the crossing tick: the catch applied its effect",
  );

  assertLength(
    cuesNamed(drive.quiet, NARROW_CUE),
    0,
    `${NARROW_CUE} cues sounded while the pod was still falling`,
  );
  assertLength(
    cuesNamed(drive.played, NARROW_CUE),
    1,
    `${NARROW_CUE} cues sounded by the end of the catch tick`,
  );
  assertLength(
    cuesNamed(drive.quiet, PLAIN_CUE),
    0,
    `${PLAIN_CUE} cues sounded while the pod was still falling`,
  );
  assertLength(
    cuesNamed(drive.played, PLAIN_CUE),
    0,
    `${PLAIN_CUE} cues sounded on the narrow catch: the narrow pod plays its own cue instead`,
  );
});
