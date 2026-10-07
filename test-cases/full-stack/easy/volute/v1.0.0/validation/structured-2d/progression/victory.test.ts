// progression/victory — clearing the fifth level wins the run.
//
// THE SPEC LINE. `specs/progression.md` — "Clearing a level": "Clearing levels 1
// through 4 opens a 2 s interlude, after which the next level begins. Clearing
// level 5 moves the game to `victory` on the clearing tick, with no interlude."
// Its table says the same: "Level 5 cleared | `victory` | the run is over".
//
// THE DRIVE. The same drive `progression/level-cleared` runs, opened on level 5:
// `clearing.ts` poses the level with its quota spent and one run of three
// matching cores, and fires a matching core into them. The lead the run is posed
// short by follows level 5's own feed speed, so the shot arrives over the same
// part of the run it does on level 1.
//
// WHAT IS DECIDED. One question: is the screen `victory` on the clearing tick.
// The interlude is read on the same tick as the corroborating half of "with no
// interlude" — a build that opened one would report seconds left of it.
//
// TOLERANCES. None on the answer: a screen name and a core count are exact, and
// the interlude is asserted to be the 0 the same spec sentence fixes. The sweep's
// 90-tick ceiling is `clearing.ts`'s, and is a ceiling rather than a tolerance.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { LEVEL_COUNT } from "../constants";
import {
  captureStill,
  coreCount,
  createHarness,
  type Harness,
} from "../harness";
import { driveClear, poseClearingHall } from "./clearing";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("ends the run on the victory screen when level 5 clears", async () => {
  await poseClearingHall(h, LEVEL_COUNT);

  const drive = await driveClear(h);
  captureStill(h, "victory");

  assertEqual(
    coreCount(drive.ended),
    0,
    "no core left on the channel once the run was extracted",
  );
  assertEqual(
    drive.ended.screen,
    "victory",
    "the screen on the tick level 5 cleared",
  );
  assertEqual(
    drive.ended.interlude,
    0,
    "the seconds of interlude a victory opens",
  );
});
