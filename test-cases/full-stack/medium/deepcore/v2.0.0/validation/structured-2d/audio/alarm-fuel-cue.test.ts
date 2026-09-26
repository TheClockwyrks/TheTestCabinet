// audio/alarm-fuel-cue — the low-fuel alarm sounds under the threshold only.
//
// `specs/character.md`: below `LOW_FUEL_FRACTION` (`0.2`) of the maximum, the fuel
// gauge takes the alert treatment and the low-fuel alarm cue plays.
// `specs/assets.md` names the cue and says the same. So two windows of the same
// length are measured on the same standing miner, one with the tank comfortably
// above the threshold and one below it, and `alarm-fuel` must be silent for the
// first and sounding for the second.
//
// THE CUE IS READ BY NAME, so nothing else the scene sounds can stand in for the
// alarm, and a build that holds it as one looping source and a build that
// re-triggers it while the tank is low both pass: `specs/assets.md` fixes only
// that it plays below the threshold.
//
// The miner stands below the ground line, where `specs/character.md` has life
// support burning at `LOW_FUEL_FRACTION`'s expense, so the tank is re-posed at the
// top of each window rather than assumed to have stayed where it was put. Nothing
// else in the scene can sound: the mine is cleared, the drill is held, no key is
// down, and the miner's travel is held so it neither falls nor lands.

import { afterEach, beforeEach, it } from "vitest";
import {
  CUES,
  FUEL_TIERS,
  LOW_FUEL_FRACTION,
  PLAYABLE_COL_MIN,
} from "../constants";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureReplay,
  createHarness,
  layFloor,
  openScene,
  pinDrill,
  pinMiner,
  standOn,
  type Harness,
} from "../harness";
import { audibleOver, watchAudio } from "./cues";

const ROW = 200;
const COL = PLAYABLE_COL_MIN + 8;

/** Each window, in seconds, and the frames it is driven in. */
const WINDOW = 2;
const FRAMES = 240;

/** How far either side of the threshold the tank is posed, as a fraction. */
const CLEAR = 0.3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sounds the fuel alarm below the threshold and not above it", async () => {
  openScene(h);
  pinDrill(h);
  layFloor(h, ROW);
  standOn(h, COL, ROW);
  pinMiner(h);

  const max = FUEL_TIERS[0];
  const log = watchAudio(h);
  const heard = await captureReplay(h, "alarm", async () => {
    h.debug.setFuel((LOW_FUEL_FRACTION + CLEAR) * max);
    const above = await audibleOver(h, log, CUES.alarmFuel, WINDOW, FRAMES);
    const afterAbove = h.snapshot();
    h.debug.setFuel((LOW_FUEL_FRACTION - CLEAR / 2) * max);
    const below = await audibleOver(h, log, CUES.alarmFuel, WINDOW, FRAMES);
    const afterBelow = h.snapshot();
    return { above, below, afterAbove, afterBelow };
  });

  assertGreaterThan(
    heard.afterAbove.miner.fuel / heard.afterAbove.miner.maxFuel,
    LOW_FUEL_FRACTION,
    "specs/character.md",
  );
  assertGreaterThan(
    LOW_FUEL_FRACTION,
    heard.afterBelow.miner.fuel / heard.afterBelow.miner.maxFuel,
    "specs/character.md",
  );
  assertEqual(heard.above, false, "specs/character.md");
  assertEqual(heard.below, true, "specs/character.md");
});
