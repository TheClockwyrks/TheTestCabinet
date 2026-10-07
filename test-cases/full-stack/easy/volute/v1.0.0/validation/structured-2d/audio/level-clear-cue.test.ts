// audio/level-clear-cue — the cue a cleared level plays is `level-clear`.
//
// THE SPEC LINE. `specs/ui.md` ("Audio"): `level-clear` is played when "A
// level is cleared", and `specs/progression.md` fixes that as "the moment its
// quota is exhausted and no cores remain on the channel".
//
// THE DRIVE. `progression/clearing.ts` carries it, because it is the same hall
// `progression/level-cleared` is decided on: the quota spent, one run of three
// matching cores standing over the injector, and a matching core fired into
// them. The extraction empties the channel and the level clears on that tick.
//
// WHAT ALSO SOUNDS ON THAT TICK. The insertion and the extraction, so `seat`
// and `extract-1` sound beside the clear — which `specs/ui.md` allows. What is
// read is that `level-clear` is among them, exactly once.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureReplay,
  coreCount,
  createHarness,
  watchCues,
  type Harness,
} from "../harness";
import { driveClear, poseClearingHall } from "../progression/clearing";
import { assertHeardOnce, openHall } from "./cues";

/** Levels 1 through 4 clear to `cleared`; level 5 is `progression/victory`. */
const LEVEL = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds the level-clear cue on the tick the last core leaves", async () => {
  await openHall(h);
  await poseClearingHall(h, LEVEL);

  const played = watchCues(h);
  const cleared = await captureReplay(h, "clear", async () => {
    const drive = await driveClear(h);
    return { drive, tick: h.tick(), cues: [...played] };
  });

  assertEqual(
    cleared.drive.ended.screen,
    "cleared",
    "the screen on the clearing tick, so a clear really happened",
  );
  assertEqual(
    coreCount(cleared.drive.ended),
    0,
    "the cores left once the run was drawn out",
  );
  assertHeardOnce(
    cleared.cues,
    cleared.tick,
    "level-clear",
    "the level-clear cue on the tick the level cleared",
  );
});
