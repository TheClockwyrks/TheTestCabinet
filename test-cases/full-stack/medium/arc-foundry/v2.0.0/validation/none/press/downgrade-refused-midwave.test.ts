// press/downgrade-refused-midwave — a downgrade does nothing during a live wave.
//
// `specs/scrap-press.md` makes a downgrade a build-phase action, and
// `specs/controls.md` draws its control disabled in its slot while a wave runs.
// The rule underneath is `specs/pathing.md`'s: nothing available during a live
// wave changes a tile's state, so a wave walks the maze it started with, and
// a harvest would harden whatever is left under a Load already walking.
//
// ONE ACTION PER POINT. The three siblings beside this one decide the other
// build-phase actions, so a build that guards one and not the rest is told apart
// from one that guards none. `press/mid-wave.ts` holds the yard all four share.
//
// THE ACTION IS TAKEN THROUGH THE CONTROL A PLAYER PRESSES. The surface is not
// the route this decides: `specs/instrumentation.md` makes an operation
// unconditional, so `keep`, `downgrade`, `dismantle` and `placeRock` each commit
// their own transaction from wherever the game stands and the phase running is no
// condition on them. What is left, and what a wave must actually hold shut, is the
// player's route. The yard is read back after it and held against the yard the
// wave started with.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  pressAction,
  type Harness,
} from "../harness";
import { openMidWave, yardOf } from "./mid-wave";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("refuses a downgrade during a live wave", async () => {
  const posed = await openMidWave(h);

  const after = await captureReplay(h, "refused", async () => {
    await h.debug.select(posed.candidate);
    await pressAction(h, "downgrade");
    await h.advance(12);
    return yardOf(await h.snapshot());
  });

  assertDeepEqual(
    after,
    posed.before,
    "the yard after a downgrade during a live wave, against the yard the wave " +
      "started with (specs/scrap-press.md)",
  );
});
