// audio/death-cue — every death sounds the death cue.
//
// `specs/assets.md`: the `death` cue plays when the miner dies. `specs/modes.md`
// enumerates the three deaths — fuel reaching `0` below the surface ground line,
// hull standing at `0`, and the Core Sample's timer expiring while it is carried
// — so each is driven in a fresh scene and each must sound the cue BY NAME.
//
// EACH DEATH IS POSED ONE STEP SHORT AND THEN LET HAPPEN. `specs/character.md`
// says a hull posed to `0` is not itself a death: the game's own continuous check
// is what ends the expedition, on the next update. So the pose is the state, the
// two frames after it are the death, and the cue is read over exactly those two.
// The scene is then run on until the expedition has ended, and the summary's
// `deathCause` says which of the three actually ran.
//
// Because the cue carries its name, nothing else the death raises — the alarm the
// emptying tank was already sounding, the blast a detonating Sample throws — can
// be mistaken for it.

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
  standOn,
  ticks,
  type Harness,
} from "../harness";
import { over, playsIn, watchAudio, type AudioLog } from "./cues";

const ROW = 200;
const COL = PLAYABLE_COL_MIN + 8;

/** The seconds left on the Sample when the countdown death is driven. */
const NEARLY_UP = 0.05;

/** Frames the death itself is read over, once whatever arms it has run. */
const BLOW_FRAMES = 2;

/**
 * Frames the Core Sample's death is read over.
 *
 * Its blow is not the pose: `specs/hazards.md` has a carried Sample detonate when
 * its timer reaches zero, so the window has to span the `NEARLY_UP` seconds the
 * timer was posed with as well as the frames the death itself takes.
 */
const CORE_BLOW_FRAMES = ticks(NEARLY_UP) + BLOW_FRAMES;

/** How long the expedition is run on for after the blow, and in how many frames. */
const ENDING_SECONDS = 8;
const ENDING_FRAMES = 80;

let h: Harness;
let log: AudioLog;

beforeEach(async () => {
  h = await createHarness();
  log = watchAudio(h);
});

afterEach(() => {
  h?.dispose();
});

it("sounds the death cue on each of the three deaths", async () => {
  const die = async (
    arm: () => Promise<void>,
    blow: () => void,
    blowFrames: number = BLOW_FRAMES,
  ): Promise<{ cues: number; screen: string; cause: string | null }> => {
    openScene(h);
    pinDrill(h);
    layFloor(h, ROW);
    standOn(h, COL, ROW);
    await arm();
    const window = await over(h, async () => {
      blow();
      await h.advance(blowFrames);
    });
    await h.advanceSeconds(ENDING_SECONDS, ENDING_FRAMES);
    const { screen, summary } = h.snapshot();
    return {
      cues: playsIn(log, CUES.death, window).length,
      screen,
      cause: summary?.deathCause ?? null,
    };
  };

  const nothing = async (): Promise<void> => undefined;

  const deaths = await captureReplay(h, "death", async () => ({
    hull: await die(nothing, () => {
      h.debug.setHull(0);
    }),
    fuel: await die(
      async () => {
        // Settled under the low-fuel threshold first, so the alarm the tank
        // raises is already sounding and the counted frames carry the death alone.
        h.debug.setFuel(FUEL_TIERS[0] * LOW_FUEL_FRACTION * 0.5);
        await h.advanceSeconds(1, 60);
      },
      () => {
        h.debug.setFuel(0);
      },
    ),
    core: await die(
      nothing,
      () => {
        h.debug.setCoreCarried(true);
        h.debug.setCoreTimer(NEARLY_UP);
      },
      CORE_BLOW_FRAMES,
    ),
  }));

  assertEqual(deaths.hull.cause, "hull-destroyed", "specs/modes.md");
  assertEqual(deaths.fuel.cause, "fuel-out", "specs/modes.md");
  assertEqual(deaths.core.cause, "core-detonation", "specs/modes.md");
  assertEqual(deaths.hull.screen, "game-over", "specs/modes.md");
  assertGreaterThan(deaths.hull.cues, 0, "specs/assets.md");
  assertGreaterThan(deaths.fuel.cues, 0, "specs/assets.md");
  assertGreaterThan(deaths.core.cues, 0, "specs/assets.md");
});
