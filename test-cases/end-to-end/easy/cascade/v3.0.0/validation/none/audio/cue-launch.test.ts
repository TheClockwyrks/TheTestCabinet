// audio/cue-launch — the frame the victory cascade launches a card sounds a cue,
// and the won screen around it stays silent.
//
// `specs/audio.md`'s cue table: `launch` is played when "The cascade launches a
// card", and every cue "is played on the frame its event happens and at most
// once on that frame". `specs/victory.md` fixes the event: each frame the launch
// clock "adds the frame's delta. While it holds at least `LAUNCH_INTERVAL` and
// cards remain to be launched, `LAUNCH_INTERVAL` is subtracted from it and the
// next card launches", and a launched card "leaves the foundation it came from
// and becomes a card in flight". `specs/instrumentation.md` reports the count as
// `launched`, raised by one per launch, so the frame the cue belongs to is the
// frame `launched` first rises.
//
// WHAT IS AND IS NOT OBSERVABLE HERE is the whole of `audio/cues`' module
// comment; the short of it is that a sound and its frame can be read from
// outside an engineless build and a cue's NAME cannot.
//
// THE CASCADE IS ENTERED THROUGH THE GAME'S OWN WIN, never by posing the screen.
// `specs/victory.md` begins the cascade WITH THE WIN, so a build that runs it off
// the win rather than off the screen field is conformant and a posed `won`
// screen would fail it for a requirement no specification states. `startCascade`
// puts fifty-one cards home and sends the last King home through a real move,
// exactly as a player would.
//
// LAUNCHING IS HELD SHUT ACROSS THE WIN, WHICH IS WHAT MAKES THE READING CLEAN.
// `setLaunching(false)` gates "the cascade's launch clock and the launching of
// the next card, and nothing else" (`specs/instrumentation.md`), so the win
// itself launches no card and the cues the win raised are all behind us before
// anything is listened for. The gate is then opened, ALONE, on a won screen that
// has been silent for a third of a second, so the first launch is the only event
// left on the table. It is shut again the moment the reading is taken, so the
// second launch, `LAUNCH_INTERVAL` later, cannot land in the settle.
//
// ONE FRAME IS DRIVEN BETWEEN THE WIN AND THE WATCH. The win is reached from
// `move()`, which resolves between frames, so a build that holds its cues until
// the next update would sound them on the first frame after it. That frame is
// driven before `watchCues`, so nothing the win raised can be counted against
// the launch.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  framesFor,
  openTable,
  startCascade,
  watchCues,
  type Harness,
} from "../harness";
import { frameOf, framesApartFrom, soundsOn } from "./cues";

/** Quiet play on the won screen before the gate opens, with nothing launching. */
const QUIET_FRAMES = framesFor(0.3);

/** Quiet play after the launch, with the gate shut again, so a late blip is caught. */
const SETTLE_FRAMES = framesFor(0.3);

/**
 * How long the first launch is waited for once the gate opens, in frames.
 *
 * A CEILING, NOT A TOLERANCE. `specs/victory.md` has the launch clock holding
 * `LAUNCH_INTERVAL` (`0.18` s) when the cascade begins, so a conforming build
 * launches at once or within that interval of the gate opening, whichever way it
 * carried the clock while the gate was shut. A second of game time is several
 * times either, and the frame read is the frame the launch ACTUALLY happened on,
 * so widening this changes no verdict.
 */
const LAUNCH_CEILING = framesFor(1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("sounds on the frame a card launches, and on no other frame", async () => {
  await openTable(h);
  await h.debug.setLaunching(false);
  await startCascade(h);
  await h.armAudio();

  // The win resolved between frames; this frame is where a build that queues its
  // cues plays them, and it is driven before anything is listened for.
  await h.advance(1);

  const played = watchCues(h);
  await h.advance(QUIET_FRAMES);

  await h.debug.setLaunching(true);
  const launched = await frameOf(
    h,
    (snapshot) => snapshot.launched > 0,
    LAUNCH_CEILING,
  );
  const onTheLaunch = soundsOn([...played], launched.frame);

  // Shut again at once, so the next launch cannot sound inside the settle.
  await h.debug.setLaunching(false);
  await h.advance(SETTLE_FRAMES);
  const heard = [...played];
  await captureStill(h, "launch");

  // A card really left the foundations, exactly one of them.
  assertEqual(
    launched.hit,
    true,
    "the cascade to launch a card once the gate opened",
  );
  assertEqual(
    launched.snapshot.launched,
    1,
    "the cards the cascade has launched",
  );
  assertGreaterThan(
    launched.snapshot.flyers.length,
    0,
    "the cards in flight on the frame of the launch",
  );

  assertGreaterThan(
    onTheLaunch,
    0,
    `sounds emitted on frame ${launched.frame}, the frame the card launched`,
  );
  assertDeepEqual(
    framesApartFrom(heard, [launched.frame]),
    [],
    "the frames of every sound emitted away from the launch",
  );
});
