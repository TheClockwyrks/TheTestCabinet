// screens/how-to-play-copy — the how-to screen covers every subject specs/ui.md
// requires of it.
//
// specs/ui.md: "`how-to-play` covers the goal of building and launching the
// rocket, the controls, the dig-sell-upgrade loop, that the drill cuts down,
// left, and right but never up, fuel and the climb home, the cargo's slots and
// its weight, the hazards, the materials and the scanner, saving, and the two
// modes."
//
// HOW A SUBJECT IS READ WITHOUT FIXING THE WORDS. The specification fixes the
// screen's CONTENT and not its prose — "The content and the navigation are fixed;
// the layout is yours" — so each subject is read as the vocabulary the
// SPECIFICATION ITSELF fixes for it, and nothing else: the two mode names, the
// two material names, the two hazard names, the drill's three directions, the
// keys `specs/controls.md` binds. Every term below is one this case names
// somewhere, so a build that writes its own prose about the right subjects passes
// and a build that leaves a subject out does not.
//
// ISOLATION. The screen reached directly through the surface rather than through
// the title, because a build with a broken title menu and correct copy must pass
// this and fail `screens/how-to-play-reachable`.

import { afterEach, beforeEach, it } from "vitest";
import { assertMatches } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { drawnCopy } from "./frames";

/**
 * One entry per subject specs/ui.md lists, as the terms this case's own
 * specification names for it. A subject with two halves is two entries, so a
 * failure says which half is missing.
 */
const SUBJECTS: readonly (readonly [string, RegExp])[] = [
  ["the rocket that is built", /\bROCKET\b/],
  ["launching it", /\bLAUNCH/],
  // The collective names a build gives the movement keys, or `W` and `D` as words
  // of their own, which ordinary prose does not produce the way `A` and `S` do.
  ["the movement controls", /\bWASD\b|\bARROW|\bW\b|\bD\b/],
  ["digging", /\bDIG\b|\bDIGS\b|\bDIGGING\b|\bDRILL/],
  ["selling", /\bSELL/],
  ["upgrading", /\bUPGRADE/],
  ["the drill cutting downward", /\bDOWN\b|\bDOWNWARD/],
  ["the drill and up", /\bUP\b|\bUPWARD/],
  ["fuel", /\bFUEL\b/],
  ["the climb home", /\bCLIMB|\bJETPACK\b|\bTHRUST/],
  ["the cargo's slots", /\bSLOT/],
  ["the cargo's weight", /\bWEIGHT\b|\bWEIGHS\b|\bKG\b|\bHEAVY\b|\bHEAVIER\b/],
  ["gas", /\bGAS\b/],
  ["lava", /\bLAVA\b/],
  ["the exotic materials", /\bRESONITE\b|\bCRYENITE\b|\bMATERIAL/],
  ["the scanner", /\bSCANNER\b|\bSCAN\b/],
  ["saving", /\bSAVE\b|\bSAVES\b|\bSAVING\b|\bSAVED\b/],
  ["the Standard mode", /\bSTANDARD\b/],
  ["the Hardcore mode", /\bHARDCORE\b/],
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("covers the rocket, the controls, the loop, the hazards, saving and the modes", async () => {
  h.debug.reset();
  h.debug.setScreen("how-to-play");

  const calls = await h.frameCalls();
  captureStill(h, "copy");
  const copy = drawnCopy(calls);

  for (const [subject, names] of SUBJECTS) {
    assertMatches(
      copy,
      names,
      `specs/ui.md: the how-to-play screen covers ${subject}`,
    );
  }
});
