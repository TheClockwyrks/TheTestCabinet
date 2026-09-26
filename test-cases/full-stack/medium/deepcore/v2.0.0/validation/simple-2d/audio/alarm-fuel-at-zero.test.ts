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

import { afterEach, beforeEach, it } from "vitest";
import { CUES } from "../constants";
import { assertEqual } from "../assert";
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

/** The window, in seconds, and the frames it is driven in. */
const WINDOW = 2;
const FRAMES = 240;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sounds the fuel alarm on a dry tank at the camp, and survives it", async () => {
  openScene(h);
  layCamp(h);
  standAtCamp(h);
  pinMiner(h);
  pinDrill(h);
  await h.advance(2);

  const log = watchAudio(h);
  const heard = await captureReplay(h, "dry", async () => {
    h.debug.setFuel(0);
    const alarm = await audibleOver(h, log, CUES.alarmFuel, WINDOW, FRAMES);
    return { alarm, after: h.snapshot() };
  });

  assertEqual(heard.after.miner.fuel, 0, "the tank the window ran on");
  assertEqual(
    heard.after.screen,
    "in-mine",
    "specs/modes.md: a dry tank above the ground line is not a death",
  );
  assertEqual(
    heard.alarm,
    true,
    "specs/character.md: zero is below LOW_FUEL_FRACTION, so the alarm plays",
  );
});
