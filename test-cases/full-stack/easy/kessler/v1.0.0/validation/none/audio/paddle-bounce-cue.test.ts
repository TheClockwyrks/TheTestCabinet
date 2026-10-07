// audio/paddle-bounce-cue — the paddle-bounce cue sounds once, on the tick the
// deflector bounce resolves, and on no tick before it.
//
// specs/deflector-and-ball.md: "The bounce plays the `paddle-bounce` cue and
// spawns the impact spark particle system at the contact." The bounce is a
// one-tick crossing event — "In a tick where a ball's center radius moves from
// above `194` to `194` or below, with inward radial velocity (`v . n < 0`),
// and the ball's center angle is within the deflector's span, the ball bounces
// off the deflector" — and specs/assets.md ties the produced file to exactly
// that event: "The event each cue plays on is fixed in the file that specifies
// the event"; "play a cue on its event". One event, one play, on the event's
// own tick; the ticks of plain inward flight before it belong to no event, so
// no paddle-bounce may sound over them.
//
// THE DRIVE PROVES IT REACHED THE EVENT. The cue is read against the bounce
// the snapshot shows: still inbound after the lead ticks, radially outbound
// after the crossing tick. A build that never bounces fails the bounce's own
// items too, but it fails this one honestly rather than passing it in silence.
//
// THE POSE CROSSES STRICTLY. At the wave-1 speed of 240 units per second the
// ball covers 4 units of radius per tick, so from radius 208 it reads 196
// before the crossing tick and 192 after it — no reading lands on the 194
// boundary, so no float ambiguity decides which tick the event resolves on.
//
// THE WORLD IS ONE BALL AND THE DEFLECTOR. isolate() empties the rings,
// balls, and pods and holds both driver switches, so the only event a tick
// can resolve — and the only cause a conformant build has to sound anything —
// is this bounce.
//
// AUDIO IS ARMED WITH A REAL KEY FIRST. A browser opens no audio context
// without a user gesture, so armAudio presses a key through Chromium's own
// input pipeline — UNBOUND_KEY, which specs/controls.md binds to nothing, so
// arming disturbs no game state — and waits for the produced files to decode,
// so a cue that sounds can be named from the file it came from.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLength, assertLessThan } from "../assert";
import { ballSpeed, PADDLE_START_ANGLE } from "../constants";
import {
  captureReplay,
  cuesNamed,
  isolate,
  onCue,
  openHarness,
  spawnBallPolar,
  type Harness,
} from "../harness";
import { driveToEvent, radialVelocity } from "./cues";

/** The cue specs/deflector-and-ball.md has the bounce play. */
const CUE = "paddle-bounce";

/** Posed start radius: 208 - 4 * 3 = 196 before the crossing tick, 192 after. */
const START_RADIUS = 208;

/** Ticks of plain inward flight before the bounce, on which no cue may sound. */
const LEAD_TICKS = 3;

/** Ticks driven after the bounce, so the clip holds the aftermath as well. */
const TRAIL_TICKS = 6;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("sounds paddle-bounce once, on the tick the bounce resolves", async () => {
  await h.armAudio();
  await isolate(h);
  await spawnBallPolar(h, START_RADIUS, PADDLE_START_ANGLE, ballSpeed(1), 180);

  const cues = onCue(h);
  const drive = await captureReplay(h, "bounce", () =>
    driveToEvent(h, cues, LEAD_TICKS, TRAIL_TICKS),
  );

  // The drive reached the bounce on the crossing tick and not before.
  assertLength(drive.before.balls, 1, "the posed ball after the lead ticks");
  assertLessThan(
    radialVelocity(drive.before.balls[0]),
    0,
    "the ball still inbound after the lead ticks",
  );
  assertLength(drive.after.balls, 1, "the posed ball after the crossing tick");
  assertGreaterThan(
    radialVelocity(drive.after.balls[0]),
    0,
    "the ball outbound after the crossing tick: the bounce resolved on it",
  );

  assertLength(
    cuesNamed(drive.quiet, CUE),
    0,
    `${CUE} cues sounded over the ${LEAD_TICKS} ticks of flight before the bounce`,
  );
  assertLength(
    cuesNamed(drive.played, CUE),
    1,
    `${CUE} cues sounded by the end of the tick the bounce resolved on`,
  );
});
