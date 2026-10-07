// audio/alarm-fuel-cue — the low-fuel alarm sounds under the threshold only.
//
// `specs/character.md`: below `LOW_FUEL_FRACTION` (`0.2`) of the maximum, the fuel
// gauge takes the alert treatment and the low-fuel alarm cue plays.
// `specs/assets.md` names the cue and says the same. So two windows of the same
// length are measured on the same standing miner, one with the tank comfortably
// above the threshold and one below it, and the build must be silent for the first
// and sounding for the second.
//
// The miner stands below the ground line, where `specs/character.md` has life
// support burning at `LOW_FUEL_FRACTION`'s expense, so the tank is re-posed at the
// top of each window rather than assumed to have stayed where it was put. Nothing
// else in the scene can sound: the mine is cleared, the drill is held, no key is
// down, and the miner's travel is held so it neither falls nor lands.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  FUEL_TANK_MAX,
  LOW_FUEL_FRACTION,
  PLAYABLE_COL_MIN,
} from "../constants";
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
import { armAudio, soundsOver } from "./probe";

const ROW = 200;
const COL = PLAYABLE_COL_MIN + 8;

/** Each window, in seconds, and the frames it is driven in. */
const WINDOW = 2;
const FRAMES = 120;

/** How far either side of the threshold the tank is posed, as a fraction. */
const CLEAR = 0.3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("is silent above the low-fuel threshold and sounds below it", async () => {
  const armed = await armAudio(h);
  await openScene(h);
  await pinDrill(h);
  await layFloor(h, ROW);
  await standOn(h, COL, ROW);
  await pinMiner(h);

  const max = FUEL_TANK_MAX[0];
  const heard = await captureReplay(h, "alarm", async () => {
    await h.debug.setFuel((LOW_FUEL_FRACTION + CLEAR) * max);
    const above = await soundsOver(h, WINDOW, FRAMES);
    const afterAbove = await h.snapshot();
    await h.debug.setFuel((LOW_FUEL_FRACTION - CLEAR / 2) * max);
    const below = await soundsOver(h, WINDOW, FRAMES);
    const afterBelow = await h.snapshot();
    return { above, below, afterAbove, afterBelow };
  });

  assertEqual(armed, true, "specs/assets.md");
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
  assertEqual(heard.above, 0, "specs/character.md");
  assertGreaterThan(heard.below, 0, "specs/character.md");
});
