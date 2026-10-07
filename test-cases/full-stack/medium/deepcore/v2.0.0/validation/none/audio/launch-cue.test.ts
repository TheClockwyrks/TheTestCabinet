// audio/launch-cue — the launch sounds.
//
// `specs/assets.md`: the `launch` cue plays when the rocket launches.
// `specs/rocket.md` fixes what launching is — with all five components installed
// the Launch Pad shows `LAUNCH`, and launching plays the rocket lifting off with
// the launch cue and takes the game to the Victory screen. So the five components
// are posed installed, the miner stands at the pad, and `launch` is run; the
// screen turning to `victory` says the launch actually happened.
//
// A silent window is measured first over the same standing miner, so the sound
// belongs to the launch rather than to anything the camp was already doing. The
// count is taken through the page's own running total, because `launch` is a
// control that runs BETWEEN frames and a sound it emits falls outside every
// frame's bracket.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { ROCKET_COMPONENTS } from "../constants";
import {
  captureReplay,
  createHarness,
  layCamp,
  openScene,
  pinDrill,
  standAtBuilding,
  type Harness,
} from "../harness";
import { armAudio, countSounds, soundsOver } from "./probe";

/** The quiet window, in seconds, and the frames it is driven in. */
const WINDOW = 1;
const FRAMES = 120;

/** How long the lift-off is given to reach the Victory screen. */
const LIFT_OFF_SECONDS = 15;
const LIFT_OFF_FRAMES = 150;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds when the rocket launches", async () => {
  const armed = await armAudio(h);
  await openScene(h);
  await layCamp(h);
  await pinDrill(h);
  await standAtBuilding(h, "launch-pad");
  await h.debug.setRocketInstalled(ROCKET_COMPONENTS.length);

  const heard = await captureReplay(h, "roar", async () => {
    const before = await soundsOver(h, WINDOW, FRAMES);
    const launching = await countSounds(h, async () => {
      await h.debug.launch();
      await h.advance(4);
    });
    // `specs/rocket.md` has the rocket lifting off and the game arriving at the
    // Victory screen; how long the lift-off plays is the build's, so the scene is
    // run on generously rather than to a figure this specification never fixed.
    await h.advanceSeconds(LIFT_OFF_SECONDS, LIFT_OFF_FRAMES);
    return { before, launching, snapshot: await h.snapshot() };
  });

  assertEqual(armed, true, "specs/assets.md");
  assertEqual(heard.snapshot.screen, "victory", "specs/rocket.md");
  assertEqual(heard.before, 0, "specs/assets.md");
  assertGreaterThan(heard.launching, 0, "specs/assets.md");
});
