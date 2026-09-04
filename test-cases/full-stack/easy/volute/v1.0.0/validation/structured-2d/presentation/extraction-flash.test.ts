// presentation/extraction-flash — the produced flash sheet plays over a run as
// it is drawn out, its frames advancing across the following frames.
//
// THE REQUIREMENT. `specs/assets.md` — "The sheets": "extraction flash | 6 |
// 48 x 48 | plays once over each core an extraction removes", produced with
// `draw-sheet` and animated "in the game". The same section bounds how long it
// runs: it "plays through before the recoil hold ends", and `specs/extraction.md`
// fixes `RECOIL_HOLD` at 0.4 s, which is 24 ticks at the 60 Hz
// `specs/instrumentation.md` fixes. So the whole of the animation is inside the
// 24 ticks that follow the extraction, and that is the window read here.
//
// HOW A FRAME OF THE SHEET IS IDENTIFIED. By what was drawn, never by a path:
// `specs/assets.md` loads every produced file "through the engine's asset
// loaders", which hand the game a decoded bitmap with no path on it.
// `draw-sheet` "lands a sheet as separate
// files, one PNG per frame", so a build that animates one draws a different
// source each step and the source's identity says which frame is up; a build
// that packs the six into one image names a source rectangle per frame instead,
// so the rectangle is part of the key as well. Either way the key changes when
// the animation advances and does not when it stands still.
//
// THE BOUND. At least two distinct keys inside the window, drawn on different
// ticks — which is the least that "its frames advancing across the following
// frames" can mean, and what separates an animated sheet from one still picture
// held up for the whole of the flash. Nothing here reads how many frames a build
// spends on each step: `specs/assets.md` fixes six frames and a deadline, not a
// cadence.
//
// WHERE IT IS READ. Within one sprite of a core the removal took. The flash is
// 48 units square and plays "once over each core an extraction removes", so a
// frame of it centred on a removed core sits at zero distance and one drawn with
// any framing of its own still sits inside 48.

import { afterEach, beforeEach, it } from "vitest";
import { FLASH_SHEET_SPRITE, RECOIL_HOLD } from "../constants";
import {
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertTrue,
} from "../assert";
import {
  captureReplay,
  createHarness,
  ticksFor,
  type Harness,
} from "../harness";
import { driveShot, nearAny, poseRun, RUN_CHARGE } from "./extract";
import { sheetFrameKey, spriteDraws } from "./readouts";

/** How many ticks the drive runs for: the flight, then the whole flash. */
const DRIVE_TICKS = 60;

/** The flash is over by the time the recoil hold expires. */
const FLASH_WINDOW = ticksFor(RECOIL_HOLD);

/** How far a flash frame may sit from the core it plays over. */
const FLASH_RADIUS = FLASH_SHEET_SPRITE;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("plays the produced flash sheet over the cores an extraction removes", async () => {
  await poseRun(h, RUN_CHARGE);
  const shot = await captureReplay(h, "flash", () => driveShot(h, DRIVE_TICKS));

  assertGreaterThan(
    shot.strike,
    0,
    "the tick the released core reached the train",
  );
  assertTrue(
    shot.removed,
    "an extraction taking the run of three off the channel",
  );

  // The keys drawn on each tick of the window, indexed by tick offset from the
  // extraction.
  const perTick: string[][] = [];
  for (let offset = 0; offset < FLASH_WINDOW; offset += 1) {
    const frame = shot.frames[shot.strike - 1 + offset];
    if (frame === undefined) break;
    const keys = spriteDraws(frame, FLASH_SHEET_SPRITE)
      .filter((draw) =>
        nearAny({ x: draw.cx, y: draw.cy }, shot.standing, FLASH_RADIUS),
      )
      .map(sheetFrameKey);
    perTick.push([...new Set(keys)].sort());
  }

  const played = perTick.filter((keys) => keys.length > 0);
  assertGreaterThan(
    played.length,
    0,
    "ticks drawing a produced 48 x 48 sheet frame over the extraction",
  );

  const distinct = new Set(perTick.flat());
  assertGreaterThanOrEqual(
    distinct.size,
    2,
    "distinct frames of the produced flash sheet drawn over the extraction",
  );

  const advanced = perTick.some(
    (keys, index) =>
      index > 0 &&
      keys.length > 0 &&
      perTick[index - 1].length > 0 &&
      keys.join("|") !== perTick[index - 1].join("|"),
  );
  assertTrue(
    advanced,
    "the sheet frame drawn over the extraction changing from one tick to the next",
  );
});
