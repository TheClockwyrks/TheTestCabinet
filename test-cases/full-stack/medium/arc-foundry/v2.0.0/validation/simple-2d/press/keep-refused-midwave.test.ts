// press/keep-refused-midwave — a keep does nothing during a live wave.
//
// `specs/scrap-press.md` makes a keep a build-phase action, and
// `specs/controls.md` draws its control disabled in its slot while a wave runs.
// The rule underneath is `specs/pathing.md`'s: nothing available during a live
// wave changes a tile's state, so a wave walks the maze it started with, and
// a harvest would harden whatever is left under a Load already walking.
//
// ONE ACTION PER POINT. The three siblings beside this one decide the other
// build-phase actions, so a build that guards one and not the rest is told apart
// from one that guards none. `press/mid-wave.ts` holds the yard all four share.
//
// THE ACTION IS TAKEN BOTH WAYS where a player has two: through the control a
// player would press AND through the surface, so a build that guards one route
// and not the other is caught on whichever it left open. The yard is then read
// back and held against the yard the wave started with.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import { captureReplay, createHarness, type Harness } from "../harness";
import { attempt, openMidWave, yardOf } from "./mid-wave";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses a keep during a live wave", async () => {
  const posed = openMidWave(h);

  const after = await captureReplay(h, "refused", async () => {
    attempt(() => h.debug.select(posed.candidate));
    attempt(() => h.debug.keep(posed.candidate));
    await h.advance(12);
    return yardOf(h.snapshot());
  });

  assertDeepEqual(
    after,
    posed.before,
    "the yard after a keep during a live wave, against the yard the wave " +
      "started with (specs/scrap-press.md)",
  );
});
