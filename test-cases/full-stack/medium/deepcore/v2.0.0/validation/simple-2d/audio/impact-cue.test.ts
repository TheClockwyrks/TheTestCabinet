// audio/impact-cue — a hard landing sounds the impact cue and a soft one does not.
//
// `specs/assets.md`: the `impact` cue plays when the miner lands above the safe
// speed. `specs/hazards.md` fixes the line — a landing at downward speed `v` costs
// `max(0, v - IMPACT_SAFE_SPEED) * IMPACT_DAMAGE_RATE` hull, and
// `IMPACT_SAFE_SPEED` (`700`) "covers a free fall of two tiles, so stepping off a
// ledge is always harmless". So two falls are driven onto the same floor, one from
// well above that height and one from well below it, and only the first may sound
// the cue.
//
// The heights are computed from `GRAVITY` rather than guessed: a fall from `d`
// units arrives at `sqrt(2 * GRAVITY * d)`, so a two-tile drop lands at the safe
// speed exactly. The drill is held and the mine is cleared, so nothing but the
// falls happens, and the landing speed the harness measured is asserted either
// side of the line before the cue is read.

import { afterEach, beforeEach, it } from "vitest";
import {
  CUES,
  GRAVITY,
  IMPACT_SAFE_SPEED,
  PLAYABLE_COL_MIN,
} from "../../src/constants";
import { assertEqual, assertGreaterThan, assertLessThan } from "../assert";
import {
  captureReplay,
  createHarness,
  driveFall,
  layFloor,
  openScene,
  pinDrill,
  type Harness,
} from "../harness";
import { playsIn, watchAudio } from "./cues";

const ROW = 300;
const COL = PLAYABLE_COL_MIN + 8;

/** The drop that lands exactly at the safe speed. */
const SAFE_DROP = (IMPACT_SAFE_SPEED * IMPACT_SAFE_SPEED) / (2 * GRAVITY);

/** Well under it, and well over it. */
const SOFT_DROP = SAFE_DROP * 0.4;
const HARD_DROP = SAFE_DROP * 6;

/** Frames at the end of a fall the landing's cue may land on. */
const SLACK = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sounds the impact cue above the safe speed and not below it", async () => {
  openScene(h);
  pinDrill(h);
  layFloor(h, ROW);

  const log = watchAudio(h);
  const landed = await captureReplay(h, "thud", async () => {
    const softFrom = h.frame();
    const soft = await driveFall(h, COL, ROW, SOFT_DROP);
    const softTo = h.frame();
    const hard = await driveFall(h, COL, ROW, HARD_DROP);
    const hardTo = h.frame();
    return { soft, hard, softFrom, softTo, hardTo };
  });

  const soft = playsIn(log, CUES.impact, {
    from: landed.softFrom,
    to: landed.softTo,
  });
  const hard = playsIn(log, CUES.impact, {
    from: landed.hardTo - SLACK,
    to: landed.hardTo,
  });

  assertEqual(landed.soft.landed, true, "specs/character.md");
  assertEqual(landed.hard.landed, true, "specs/character.md");
  assertLessThan(
    landed.soft.impactSpeed,
    IMPACT_SAFE_SPEED,
    "specs/hazards.md",
  );
  assertGreaterThan(
    landed.hard.impactSpeed,
    IMPACT_SAFE_SPEED,
    "specs/hazards.md",
  );
  assertEqual(soft.length, 0, "specs/assets.md");
  assertGreaterThan(hard.length, 0, "specs/assets.md");
});
