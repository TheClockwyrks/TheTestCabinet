// audio/death-cue — every death sounds.
//
// `specs/assets.md`: the `death` cue plays when the miner dies. `specs/modes.md`
// enumerates the three deaths — fuel reaching `0` below the surface ground line,
// hull standing at `0`, and the Core Sample's timer expiring while it is carried
// — so each is driven in a fresh scene and each must sound.
//
// EACH DEATH IS POSED ONE STEP SHORT AND THEN LET HAPPEN. `specs/character.md`
// says a hull posed to `0` is not itself a death: the game's own continuous check
// is what ends the expedition, on the next update. So the pose is the state, the
// two frames after it are the death, and the sound is counted over exactly those
// two. The scene is then run on until the expedition has ended, and the summary's
// `deathCause` says which of the three actually ran.
//
// THE FUEL DEATH IS SETTLED BEFORE IT IS TRIGGERED. `specs/character.md` has the
// low-fuel alarm sounding below `LOW_FUEL_FRACTION`, and which cue sounded is not
// observable from outside an engineless build, so the tank is emptied to under
// that threshold and left there for a second first. By the time the two counted
// frames run, the alarm is already going and what they catch is the death.

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
  standOn,
  type Harness,
} from "../harness";
import { armAudio, countSounds } from "./probe";

const ROW = 200;
const COL = PLAYABLE_COL_MIN + 8;

/** The seconds left on the Sample when the countdown death is driven. */
const NEARLY_UP = 0.05;

/** How long the expedition is run on for after the blow, and in how many frames. */
const ENDING_SECONDS = 8;
const ENDING_FRAMES = 80;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds on each of the three deaths", async () => {
  const armed = await armAudio(h);

  const die = async (
    settle: () => Promise<void>,
    blow: () => Promise<void>,
  ): Promise<{ sounds: number; screen: string; cause: string | null }> => {
    await openScene(h);
    await pinDrill(h);
    await layFloor(h, ROW);
    await standOn(h, COL, ROW);
    await settle();
    await blow();
    const sounds = await countSounds(h, () => h.advance(2));
    await h.advanceSeconds(ENDING_SECONDS, ENDING_FRAMES);
    const { screen, summary } = await h.snapshot();
    return { sounds, screen, cause: summary?.deathCause ?? null };
  };

  const nothing = async (): Promise<void> => undefined;

  const deaths = await captureReplay(h, "death", async () => ({
    hull: await die(nothing, () => h.debug.setHull(0)),
    fuel: await die(
      async () => {
        await h.debug.setFuel(FUEL_TANK_MAX[0] * LOW_FUEL_FRACTION * 0.5);
        await h.advanceSeconds(1, 60);
      },
      () => h.debug.setFuel(0),
    ),
    core: await die(nothing, async () => {
      await h.debug.setCoreCarried(true);
      await h.debug.setCoreTimer(NEARLY_UP);
    }),
  }));

  assertEqual(armed, true, "specs/assets.md");
  assertEqual(deaths.hull.cause, "hull-destroyed", "specs/modes.md");
  assertEqual(deaths.fuel.cause, "fuel-out", "specs/modes.md");
  assertEqual(deaths.core.cause, "core-detonation", "specs/modes.md");
  assertEqual(deaths.hull.screen, "game-over", "specs/modes.md");
  assertGreaterThan(deaths.hull.sounds, 0, "specs/assets.md");
  assertGreaterThan(deaths.fuel.sounds, 0, "specs/assets.md");
  assertGreaterThan(deaths.core.sounds, 0, "specs/assets.md");
});
