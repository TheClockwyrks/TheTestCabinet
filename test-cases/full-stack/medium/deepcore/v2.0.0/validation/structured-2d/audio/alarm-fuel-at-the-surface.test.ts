// audio/alarm-fuel-at-the-surface — the alarm follows the fuel, not the depth.
//
// `specs/character.md`: "Below `LOW_FUEL_FRACTION` (`0.2`) of the maximum, the
// fuel gauge takes the alert treatment and the low-fuel alarm cue plays."
// `specs/assets.md`'s cue table says the same, giving `alarm-fuel`'s trigger as
// "Fuel is below `LOW_FUEL_FRACTION`". Neither mentions where the miner is
// standing, and the camp is exactly where a player wants the warning: it is where
// the fuel is bought.
//
// `audio/alarm-fuel-cue` decides the threshold, underground. This is the edge
// case beside it: the same threshold crossed at the camp, where a build that
// hung the alarm on being below the ground line goes silent.
//
// The two windows are the same length on the same standing miner, so the only
// thing that differs between them is the tank. Nothing else in the scene can
// sound: the camp ground is laid and the miner stands on it, the drill is held,
// no key is down, and the miner's travel is held so it neither falls nor lands.

import { afterEach, beforeEach, it } from "vitest";
import { CUES, FUEL_TIERS, LOW_FUEL_FRACTION } from "../../src/constants";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureReplay,
  createHarness,
  layCamp,
  openScene,
  pinDrill,
  pinMiner,
  standAtCamp,
  type Harness,
} from "../harness";
import { audibleOver, watchAudio } from "./cues";

/** Each window, in seconds, and the frames it is driven in. */
const WINDOW = 2;
const FRAMES = 240;

/** How far either side of the threshold the tank is posed, as a fraction. */
const CLEAR = 0.05;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sounds the fuel alarm below the threshold with the miner at the camp", async () => {
  openScene(h);
  layCamp(h);
  standAtCamp(h);
  pinMiner(h);
  pinDrill(h);
  await h.advance(2);

  const max = FUEL_TIERS[0];
  const log = watchAudio(h);
  const heard = await captureReplay(h, "alarm", async () => {
    h.debug.setFuel((LOW_FUEL_FRACTION + CLEAR) * max);
    const above = await audibleOver(h, log, CUES.alarmFuel, WINDOW, FRAMES);
    const afterAbove = h.snapshot();
    h.debug.setFuel((LOW_FUEL_FRACTION - CLEAR) * max);
    const below = await audibleOver(h, log, CUES.alarmFuel, WINDOW, FRAMES);
    const afterBelow = h.snapshot();
    return { above, below, afterAbove, afterBelow };
  });

  // The miner really is at the camp: `specs/world.md` puts row 0 at the surface.
  assertEqual(
    heard.afterBelow.miner.row <= 0,
    true,
    "specs/world.md: the miner stands on the camp ground, above the ground line",
  );
  assertGreaterThan(
    heard.afterAbove.miner.fuel / heard.afterAbove.miner.maxFuel,
    LOW_FUEL_FRACTION,
    "the tank the first window ran at",
  );
  assertGreaterThan(
    LOW_FUEL_FRACTION,
    heard.afterBelow.miner.fuel / heard.afterBelow.miner.maxFuel,
    "the tank the second window ran at",
  );
  assertEqual(
    heard.above,
    false,
    "specs/character.md: no alarm above the threshold",
  );
  assertEqual(
    heard.below,
    true,
    "specs/character.md: the alarm plays below the threshold at the camp too",
  );
});
