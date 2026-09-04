// audio/music-bed-on-title — the title screen carries the produced music bed.
//
// specs/ui.md § Audio: "The title and select screens carry the produced music
// bed." specs/assets.md § The sound names what that bed is — "a steady, unhurried
// machine-yard piece under the title and select screens, committed as
// `assets/audio/music.wav`" — so the bed is a produced file like every cue, and
// the harness's cue probe names it from the file it was decoded from.
//
// THE SCREEN IS THE ONE THE GAME OPENS ON, so nothing is navigated to reach it:
// "The game opens on `title`" and a `reset` leaves it there, which is where every
// harness starts. Reaching this screen through a menu would fold the title menu's
// bindings into an audio point.
//
// THE AUDIO IS ALREADY UNLOCKED. specs/assets.md has sound wait for "the player's
// first interaction with the page", and the harness makes that interaction as it
// opens — one press of a key specs/controls.md binds to no action — so a silent
// reading here is a silent build rather than a locked audio context.
//
// WHAT COUNTS AS SOUNDING, AND WHY IT IS READ BOTH WAYS. The specification asks
// for a bed under the screen and fixes nothing about how a build makes one
// continuous: a source started with its loop flag set and one re-scheduled end to
// end are both a bed. So the reading is the union of the sources still looping
// and every source started since the page loaded, which is what the harness's
// `loopingCues()` and `cues()` answer between them.
//
// A stretch of frames is driven first, because a build is free to start its bed
// on the first update after the unlock rather than inside the gesture. HALF A
// SECOND OF THEM, because that is what the allowance is worth: the bed is asked
// for on the screen the game opens on, and the only latitude the specification
// leaves is which update starts it. Driving further would be waiting on nothing.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual } from "../assert";
import { createHarness, ticks, type Harness } from "../harness";

/** The stretch the bed is read across: half a second of the game's own clock. */
const STRETCH = ticks(0.5);

/**
 * The longest this waits for the bed to start, in ticks.
 *
 * Generous, because what it bounds is a build that never sounds the bed at all
 * rather than one that took a moment to decode nine megabytes of it — and this
 * project runs four suites at once, each loading its own copy of the page.
 */
const PATIENCE = ticks(20);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds the produced music bed while the title screen shows", async () => {
  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "the screen a fresh game opens on (specs/ui.md § Title)",
  );

  // WAITED FOR RATHER THAN ASSUMED. The bed is a produced file the build has to
  // fetch and decode before it can play any of it, and a build is free to take as
  // long over that as the file needs — so a fixed stretch of frames asks a
  // conforming build to have finished by a deadline the specification does not
  // set. This drives the same frames and stops the moment the bed is sounding.
  let sounding: string[] = [];
  for (let waited = 0; waited < PATIENCE; waited += STRETCH) {
    await h.advance(STRETCH);
    sounding = [...(await h.loopingCues()), ...(await h.cues())];
    if (sounding.includes("music")) break;
  }
  await h.capture("title", "The title screen");

  assertContains(
    sounding,
    "music",
    'the produced music bed sounding on the title screen: "The title and ' +
      'select screens carry the produced music bed" (specs/ui.md § Audio), ' +
      "the piece committed as assets/audio/music.wav (specs/assets.md § The " +
      `sound). Across ${STRETCH} frames the page sounded ` +
      `${JSON.stringify(sounding)} across ${PATIENCE} frames`,
  );
});
