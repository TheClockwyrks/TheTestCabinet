// Spectra — controls/overlay-backquote: the backtick shows the read-only debug
// overlay, and a second press hides it.
//
// THE RULE. `specs/controls.md` says the read-only debug overlay
// `specs/instrumentation.md` describes "is shown and hidden by the backtick key,
// `KeyboardEvent.code` `Backquote`", that it is off when the game starts, and that
// it works on every screen. Under this engine both the overlay and its toggle are
// part of the runtime layer the build writes, and neither is one of Spectra's
// actions. This point decides the TOGGLE, in both directions.
//
// WHY IT IS CAPPED HARDER THAN ITS NEIGHBOURS. `Backquote` is the overlay's ONLY
// key: there is no alternate, so a build that misses it has an overlay nobody can
// open.
//
// HOW THE OVERLAY IS OBSERVED. It has no field in the snapshot — it is a thing the
// build DRAWS — so it is read off the frame instead. The recorder hands back every
// operation one frame's render issued, and `drawnText` extracts the strings it
// drew; `specs/instrumentation.md` asks the overlay to draw its registered
// diagnostic sources and to "keep each one short enough to read on a line", so an
// overlay that is showing puts text on the frame that a bare frame does not have.
// The reading is therefore a COUNT of text draws against the same frame's own
// baseline, taken moments earlier on the same posed field: strictly more with the
// overlay up, and back to the baseline once it is hidden. Nothing here asserts a
// hex colour, a position, a font or a layout — where the overlay sits and how it
// looks are the build's.
//
// WHY THE COUNT AND NOT THE CONTENT. What the overlay must report — the screen,
// the stage, the ship's band, each drone's id and kind, and the rest of
// `specs/instrumentation.md`'s Diagnostics list — is graded once, by
// `instrumentation/overlay`. This point is about the KEY, so it asks only that the
// key put the overlay up and take it down again; a build whose overlay opens
// correctly but reports the wrong values must lose that point and keep this one.
//
// WHY BOTH DIRECTIONS. "A second press hides it" is half of what the point claims,
// and one press cannot tell a toggle from a latch. Each wrong model reads as a
// different count — a key wired to nothing leaves all three readings equal, an
// overlay that opens and never closes leaves the last two equal and above the
// baseline, and only a real toggle reads baseline, more, baseline.
//
// THE FIELD IS POSED AND FROZEN. `startPosed` gives a live wave with the four
// rosters emptied and the wave's three gates shut, and the harness owns the clock,
// so nothing on the field changes between the three readings: the only thing that
// can move the count is the key. It is posed rather than left on the title because
// the overlay's own sources read the game, and a live wave is the screen it is
// really watched on — though `specs/controls.md` says the key works on any of them.
//
// THE KEY IS A REAL ONE. `toggleOverlay` taps `Backquote` through Chromium's own
// input pipeline: down, one frame with it held, up. Under this engine the overlay
// and the keyboard beneath it are both the build's own (`specs/instrumentation.md`
// gives the surface no operation for either), so the whole path from a physical
// key to a drawn panel is exercised.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  drawnText,
  startPosed,
  toggleOverlay,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("shows the overlay on the backtick and hides it on the next press", async () => {
  await startPosed(h);
  assertEqual(
    (await h.snapshot()).screen,
    "inWave",
    "the wave the key is pressed in is live",
  );

  // The frame as it stands with the overlay off, which `specs/controls.md` says is
  // how the game starts.
  const bare = drawnText(await h.frameCalls()).length;

  await toggleOverlay(h);
  const shown = drawnText(await h.frameCalls()).length;
  await captureStill(h, "overlay");

  assertGreaterThan(
    shown,
    bare,
    "the backtick put the overlay's diagnostic lines on the frame",
  );

  await toggleOverlay(h);
  assertEqual(
    drawnText(await h.frameCalls()).length,
    bare,
    "and a second press took them off again, leaving the frame as it was",
  );
});
