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
//
// UNDER THIS ENGINE THE READING IS A COUNT, not a cue name: an engineless build
// writes its own audio layer, so what `audio/probe.ts` can see is a sound being
// started rather than which cue it was. The music bed is one long-running source
// and starts nothing new, so a window that starts a sound at all is the alarm
// coming on.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { FUEL_TANK_MAX, LOW_FUEL_FRACTION } from "../constants";
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
import { armAudio, soundsOver } from "./probe";

/** Each window, in seconds, and the frames it is driven in. */
const WINDOW = 2;
const FRAMES = 120;

/** How far either side of the threshold the tank is posed, as a fraction. */
const CLEAR = 0.05;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds the fuel alarm below the threshold with the miner at the camp", async () => {
  const armed = await armAudio(h);
  await openScene(h);
  await layCamp(h);
  await standAtCamp(h);
  await pinMiner(h);
  await pinDrill(h);
  await h.advance(2);

  const max = FUEL_TANK_MAX[0];
  const heard = await captureReplay(h, "alarm", async () => {
    await h.debug.setFuel((LOW_FUEL_FRACTION + CLEAR) * max);
    const above = await soundsOver(h, WINDOW, FRAMES);
    const afterAbove = await h.snapshot();
    await h.debug.setFuel((LOW_FUEL_FRACTION - CLEAR) * max);
    const below = await soundsOver(h, WINDOW, FRAMES);
    const afterBelow = await h.snapshot();
    return { above, below, afterAbove, afterBelow };
  });

  assertEqual(armed, true, "specs/assets.md");
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
    0,
    "specs/character.md: no alarm above the threshold",
  );
  assertGreaterThan(
    heard.below,
    0,
    "specs/character.md: the alarm plays below the threshold at the camp too",
  );
});
