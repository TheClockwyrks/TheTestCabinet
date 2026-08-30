// audio/impact-cue — a hard landing sounds and a soft one does not.
//
// `specs/assets.md`: the `impact` cue plays when the miner lands above the safe
// speed. `specs/hazards.md` fixes the line — a landing at downward speed `v`
// costs `max(0, v - IMPACT_SAFE_SPEED) * IMPACT_DAMAGE_RATE` hull, and
// `IMPACT_SAFE_SPEED` (`700`) "covers a free fall of two tiles, so stepping off a
// ledge is always harmless". So two falls are driven onto the same floor, one
// from well above that height and one from well below it, and only the first may
// sound.
//
// The heights are computed from `GRAVITY` rather than guessed: a fall from `d`
// units arrives at `sqrt(2 * GRAVITY * d)`, so a two-tile drop lands at the safe
// speed exactly. The drill is held and the mine is cleared, so nothing but the
// falls happens, and the landing speed the harness measured is asserted either
// side of the line before the sound is read.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLessThan } from "../assert";
import { GRAVITY, IMPACT_SAFE_SPEED, PLAYABLE_COL_MIN } from "../constants";
import {
  captureReplay,
  createHarness,
  driveFall,
  layFloor,
  openScene,
  pinDrill,
  watchCues,
  type Harness,
} from "../harness";
import { armAudio } from "./probe";

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

afterEach(async () => {
  await h.dispose();
});

it("sounds on a landing above the safe speed and not on one below it", async () => {
  const armed = await armAudio(h);
  await openScene(h);
  await pinDrill(h);
  await layFloor(h, ROW);

  const cues = watchCues(h);
  const landed = await captureReplay(h, "thud", async () => {
    const softFrom = h.frame();
    const soft = await driveFall(h, COL, ROW, SOFT_DROP);
    const softTo = h.frame();
    const hard = await driveFall(h, COL, ROW, HARD_DROP);
    const hardTo = h.frame();
    return { soft, hard, softFrom, softTo, hardTo, cues: [...cues] };
  });

  const during = (from: number, to: number): number =>
    landed.cues.filter((cue) => cue.frame > from && cue.frame <= to).length;

  assertEqual(armed, true, "specs/assets.md");
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
  assertEqual(during(landed.softFrom, landed.softTo), 0, "specs/assets.md");
  assertGreaterThan(
    during(landed.hardTo - SLACK, landed.hardTo),
    0,
    "specs/assets.md",
  );
});
