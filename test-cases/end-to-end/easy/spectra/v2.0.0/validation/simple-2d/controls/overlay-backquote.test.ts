// Spectra — controls/overlay-backquote: the backtick shows the read-only debug
// overlay, and a second press hides it.
//
// THE RULE. `specs/controls.md` says the read-only debug overlay is "shown and hidden
// by the backtick key, `KeyboardEvent.code` `Backquote` (`OVERLAY_KEY`), and off when
// the game starts", and that it works on every screen. This point decides that
// TOGGLE, in both directions.
//
// WHY IT IS CAPPED HARDER THAN ITS NEIGHBOURS. `Backquote` is the overlay's ONLY key:
// there is no alternate, so a build that misses it has an overlay nobody can open.
//
// WHAT THIS POINT REALLY REACHES UNDER THIS ENGINE, STATED HONESTLY. On an engine run
// the overlay and its key are the ENGINE's — `specs/controls.md` says so in as many
// words, and the engine handles `Backquote` with a listener of its own rather than as
// a registered action. So the toggle is not the build's code, and a build cannot fail
// this point by wiring a key wrongly. What it still decides, and what makes it worth
// running on every configuration rather than only under `none`, is that the build has
// not made the overlay unreachable in practice: an `initialize` that never returned,
// a render that throws while the panel is up, or a diagnostic source that takes the
// frame down all read here as an overlay that does not appear or does not go away.
// The same item under `none`, where the whole overlay is the build's own, is where
// the toggle is really earned.
//
// HOW THE OVERLAY IS OBSERVED. It has no field in the snapshot — it is a thing that
// gets DRAWN — so it is read off the frame instead. `drawFrame` runs exactly one
// frame and hands back the calls THAT frame made, and `drawnText` extracts the
// strings it drew. The engine draws the panel after the game's `render`, one line per
// registered diagnostic source and then a metrics line, so an overlay that is showing
// puts text on the frame that a bare frame does not have. The reading is therefore a
// COUNT of text draws against the same frame's own baseline, taken moments earlier on
// the same posed field: strictly more with the overlay up, and back to the baseline
// once it is hidden. Nothing here asserts a colour, a position, a font or a layout.
//
// WHY THE COUNT AND NOT THE CONTENT. What the overlay must report — the screen, the
// stage, the ship's band, each drone's id and kind, and the rest of
// `specs/instrumentation.md`'s Diagnostics list — is graded once, by
// `instrumentation/overlay`. This point is about the KEY, so it asks only that the
// key put the overlay up and take it down again; a build whose overlay opens
// correctly but reports the wrong values must lose that point and keep this one.
//
// WHY BOTH DIRECTIONS. "A second press hides it" is half of what the point claims,
// and one press cannot tell a toggle from a latch. Each wrong model reads as a
// different triple — a key that does nothing leaves all three readings equal, an
// overlay that opens and never closes leaves the last two equal and above the
// baseline, and only a real toggle reads baseline, more, baseline.
//
// THE FIELD IS POSED AND FROZEN. `startPosed` gives a live wave with the four rosters
// emptied and the wave's three gates shut, and the harness owns the clock, so nothing
// on the field changes between the three readings: the only thing that can move the
// count is the key. It is posed rather than left on the title because the overlay's
// own sources read the game, and a live wave is the screen it is really watched on —
// though `specs/controls.md` says the key works on any of them.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  drawFrame,
  drawnText,
  startPosed,
  type Harness,
} from "../harness";

/**
 * The one key `specs/controls.md` binds the overlay to, written out as it states it
 * rather than read off the build's `OVERLAY_KEY`: that constant is the build's own
 * copy of the very thing this point decides.
 */
const OVERLAY_TOGGLE = "Backquote";

/** How many runs of text one frame of the posed field drew. */
async function textDraws(harness: Harness): Promise<number> {
  return drawnText(await drawFrame(harness)).length;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("shows the overlay on the backtick and hides it on the next press", async () => {
  startPosed(h);
  assertEqual(
    h.snapshot().screen,
    "inWave",
    "the wave the key is pressed in is live",
  );

  // The frame as it stands with the overlay off, which `specs/controls.md` says is
  // how the game starts.
  const bare = await textDraws(h);

  await h.tap(OVERLAY_TOGGLE);
  const shown = await textDraws(h);
  // Before the assertions, so a check that fails still leaves the picture of the
  // frame the first press produced.
  captureStill(h, "overlay");

  assertGreaterThan(
    shown,
    bare,
    `runs of text one frame drew after the backtick was pressed, against the ` +
      `${String(bare)} the same field drew with the overlay off — the panel puts ` +
      "its diagnostic lines on the frame (specs/controls.md)",
  );

  await h.tap(OVERLAY_TOGGLE);
  assertEqual(
    await textDraws(h),
    bare,
    "runs of text one frame drew after a second backtick, which must come back " +
      "to the bare frame's own count: the key hides the overlay as well as " +
      "showing it (specs/controls.md)",
  );
});
