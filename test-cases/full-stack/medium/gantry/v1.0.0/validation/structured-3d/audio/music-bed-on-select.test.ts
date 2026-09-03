// audio/music-bed-on-select — the select screen carries the produced music bed.
//
// specs/ui.md § Audio: "The title and select screens carry the produced music
// bed." The sentence names two screens, and the bed under the site list is the
// half this point decides; the title screen's is its own point. specs/assets.md §
// The sound fixes what the bed is — the piece committed as
// `assets/audio/music.wav` — so the harness's cue probe names it from the file it
// was decoded from.
//
// THE SCREEN IS SHOWN DIRECTLY. `setScreen` "shows a named screen and sets
// nothing else" (specs/instrumentation.md), which is the whole of what this point
// needs: a build with a broken title menu and a correct music bed must fail the
// menu's points and pass this one, so nothing here confirms a menu entry to get
// to the site list.
//
// THE TITLE'S OWN BED IS DRAINED FIRST, so a start that fell on the title screen
// is not read back as the select screen's. What remains is either a source still
// looping when the site list is showing or a source started while it shows, and
// the reading is the union of the two: the specification asks for a bed under the
// screen and fixes nothing about how a build makes one continuous, so a build
// that sets a loop flag and one that re-schedules the buffer end to end both
// answer. A build that stops the bed on leaving the title screen reports neither.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual } from "../assert";
import { createHarness, ticks, type Harness } from "../harness";

/** The stretch the bed is read across: two seconds of the game's own clock. */
const STRETCH = ticks(2);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds the produced music bed while the select screen shows", async () => {
  // A stretch on the title screen first, so a bed the build starts there is
  // started and drained rather than arriving inside the select screen's reading.
  await h.advance(STRETCH);
  await h.cues();

  await h.debug.setScreen("select");
  await h.advance(STRETCH);
  const sounding = [...(await h.loopingCues()), ...(await h.cues())];
  await h.capture("select", "The site list");

  assertEqual(
    (await h.snapshot()).screen,
    "select",
    "the screen showing while the bed was read",
  );
  assertContains(
    sounding,
    "music",
    'the produced music bed sounding on the select screen: "The title and ' +
      'select screens carry the produced music bed" (specs/ui.md § Audio), ' +
      "the piece committed as assets/audio/music.wav (specs/assets.md § The " +
      `sound). Across ${STRETCH} frames of the site list the page sounded ` +
      `${JSON.stringify(sounding)}`,
  );
});
