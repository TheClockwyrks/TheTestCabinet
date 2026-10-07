// audio/alarm-fuel-at-zero — a dry tank is below the threshold like any other.
//
// `specs/character.md`: "Below `LOW_FUEL_FRACTION` (`0.2`) of the maximum, the
// fuel gauge takes the alert treatment and the low-fuel alarm cue plays." Zero is
// below the threshold, and `specs/character.md` makes a dry tank above the
// surface a state the expedition survives — "Fuel reaching `0` below the surface
// ground line" is what `specs/modes.md` calls a death, so a miner standing at the
// camp on an empty tank is stranded rather than dead, and the alarm is the whole
// of what tells the player so.
//
// The edge case is the boundary itself, which a build reaches by writing the
// alarm's condition as a band with a bottom to it rather than as the threshold
// the specification states. It is its own point because a build can be right
// everywhere else on the curve and silent at exactly the value a player is most
// likely to be looking at.
//
// The scene is `audio/alarm-fuel-at-the-surface`'s: the camp ground laid, the
// miner standing on it with its body and drill held, and nothing else that can
// sound.
//
// UNDER THIS ENGINE THE READING IS A COUNT, not a cue name: an engineless build
// writes its own audio layer, so what `audio/probe.ts` can see is a sound being
// started rather than which cue it was. The music bed is one long-running source
// and starts nothing new, so a window that starts a sound at all is the alarm
// coming on.

import { afterEach, beforeEach, it } from "vitest";
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
import { armAudio, soundsOver } from "./probe";

/** The window, in seconds, and the frames it is driven in. */
const WINDOW = 2;
const FRAMES = 120;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds the fuel alarm on a dry tank at the camp, and survives it", async () => {
  const armed = await armAudio(h);
  await openScene(h);
  await layCamp(h);
  await standAtCamp(h);
  await pinMiner(h);
  await pinDrill(h);
  await h.advance(2);

  const heard = await captureReplay(h, "dry", async () => {
    await h.debug.setFuel(0);
    const alarm = await soundsOver(h, WINDOW, FRAMES);
    return { alarm, after: await h.snapshot() };
  });

  assertEqual(armed, true, "specs/assets.md");
  assertEqual(heard.after.miner.fuel, 0, "the tank the window ran on");
  assertEqual(
    heard.after.screen,
    "in-mine",
    "specs/modes.md: a dry tank above the ground line is not a death",
  );
  assertGreaterThan(
    heard.alarm,
    0,
    "specs/character.md: zero is below LOW_FUEL_FRACTION, so the alarm plays",
  );
});
