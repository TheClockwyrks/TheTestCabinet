// audio/no-autoplay — nothing sounds between the page loading and the first key.
//
// `specs/ui.md`: "No sound is started between the page loading and the player's
// first key press, and a build whose audio cannot start still runs and still
// plays."
//
// So the measurement is: load the build, run the screen it opens on without ever
// delivering a key, and read the raw source count.
// `validation/audio-init.js` is injected before any of the build's script runs and
// counts what goes through the two doors a browser can emit sound through, so a
// build that starts an oscillator or plays an `<audio>` element while it
// initializes is caught even though the browser's own autoplay policy would have
// kept it inaudible.
//
// NO KEY IS PRESSED ANYWHERE IN THIS CHECK, and that is the whole scenario. In
// particular `armAudio` is NOT called here, though every other check in this
// directory opens with it: arming presses a real key, which is exactly the event
// this check must stay on the near side of. Nothing below reaches for a bound key
// either.
//
// THE WINDOW IS THE WHOLE CHECK, NOT A STRETCH INSIDE IT. The probe is passive: it
// counts a source the moment that source is started, and it has been installed
// since before the build's first line. Nothing here samples it — `h.sounds()`
// returns a total covering every millisecond between the page loading and the
// read, the load and the crossings as much as the driven frames. So a sound a
// build starts off a timer of its own, or off a settled `decodeAudioData`, is
// counted wherever in that window it lands, without this check having to arrange
// for real time to pass. What the window is, is the check's own duration — the
// load, the crossings and the frames it drives, some half a second of real time on
// an idle host and longer on a busy one — rather than a span it sets aside.
//
// AND WHAT IT DOES NOT REACH, SAID PLAINLY. A sound a build defers behind a timer
// longer than that window. The two engine-backed suites close that door outright:
// their build's timers are the suite's own process's, so they run on fake ones and
// wind a simulated minute forward for nothing. A build's timers here are the
// BROWSER's, out of this process's reach, and the alternatives — firing the page's
// pending callbacks early, or installing a virtual clock under a build that owns
// its own frame loop — would each put a mechanism between a conforming build and
// its point, which is a worse thing to be wrong about than a sound no build in
// this project has ever deferred. So the window is the honest one, and it is
// stated here rather than papered over: sitting through a fixed stretch of the
// wall clock would only have moved it, and would have moved it by however much a
// busy host felt like.
//
// AND THE BUILD'S OWN LOOP IS INSIDE THAT WINDOW TOO. `setAutoStep(false)` "stops
// the frame loop advancing the simulation from the wall clock" and does no more
// than that: `specs/instrumentation.md` is explicit that "drawing is unaffected
// either way: the loop keeps rendering". The build's own animation frame therefore
// runs in real time throughout this check, under the probe. What the loop adds
// when it IS advancing is the update — and `advance` runs that same update, "the
// same update the loop runs followed by a render", so handing the clock back would
// exercise no line the frames below do not.
//
// SO NO STRETCH OF THE WALL CLOCK IS DRIVEN, and that is deliberate. What this
// point requires is silence before a key, not that the game advances on its own;
// the one point in this project whose requirement IS unstepped advance is
// `instrumentation/advances-in-real-time`, and even that one ends its wait on the
// build's own clock passing a floor rather than on a fixed span of the wall clock.
// A fixed span here would have decided nothing except how many frames of its own a
// busy host let the build run — reach that rises and falls with the machine rather
// than with the build.
//
// WHAT THIS DOES NOT DECIDE. That the build makes any sound at all once a key HAS
// been pressed, which is what the nine cue points above decide, and what a build
// silent for a different reason fails there rather than here.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  framesFor,
  type Harness,
} from "../harness";

/**
 * Frames of the loaded game driven under the suite's clock.
 *
 * Two seconds of the screen the game opens on: long enough for a sound a build
 * makes from a frame to have been made, and more game time than a browser hands
 * its own loop over the same stretch of a busy host's wall clock.
 */
const IDLE_FRAMES = framesFor(2);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("starts no sound before the player's first key press", async () => {
  // The game as the page left it: whatever screen the build opens on, with no key
  // ever delivered to it.
  const opened = await h.snapshot();

  // Two seconds of it, frame by frame, with no key ever delivered either.
  await h.advance(IDLE_FRAMES);

  const started = await h.sounds();
  await captureStill(h, "loaded");

  assertEqual(
    started,
    0,
    "sounds the build started between the page loading and the first key — " +
      `over ${String(IDLE_FRAMES)} driven frames on the ${opened.screen} ` +
      "screen, with no key ever pressed (specs/ui.md)",
  );
});
