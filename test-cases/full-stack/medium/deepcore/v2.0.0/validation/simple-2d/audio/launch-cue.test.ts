// audio/launch-cue — the launch sounds its roar.
//
// `specs/assets.md`: the `launch` cue plays when the rocket launches.
// `specs/rocket.md` fixes what launching is — with all five components installed
// the Launch Pad shows `LAUNCH`, and launching plays the rocket lifting off with
// the launch cue and takes the game to the Victory screen. So the five components
// are posed installed, the miner stands at the pad, and `launch` is run; the
// screen turning to `victory` says the launch actually happened.
//
// A silent window is measured first over the same standing miner, so the cue
// belongs to the launch rather than to anything the camp was already doing, and it
// is read BY NAME off the engine's bus. `launch` is a control that runs BETWEEN
// frames, so the window is opened before it and closed after the frames that carry
// the cue it raised.

import { afterEach, beforeEach, it } from "vitest";
import { CUES, ROCKET_COMPONENTS } from "../../src/constants";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureReplay,
  createHarness,
  layCamp,
  openScene,
  pinDrill,
  standAtBuilding,
  type Harness,
} from "../harness";
import { audibleOver, over, playsIn, watchAudio } from "./cues";

/** The quiet window, in seconds, and the frames it is driven in. */
const WINDOW = 1;
const FRAMES = 120;

/** Frames driven after the control, so the update it raised its cue on runs. */
const SETTLE = 4;

/** How long the lift-off is given to reach the Victory screen. */
const LIFT_OFF_SECONDS = 15;
const LIFT_OFF_FRAMES = 150;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sounds the launch cue when the rocket launches", async () => {
  openScene(h);
  layCamp(h);
  pinDrill(h);
  standAtBuilding(h, "launch-pad");
  h.debug.setRocketInstalled(ROCKET_COMPONENTS.length);

  const log = watchAudio(h);
  const heard = await captureReplay(h, "roar", async () => {
    const before = await audibleOver(h, log, CUES.launch, WINDOW, FRAMES);
    const window = await over(h, async () => {
      h.debug.launch();
      await h.advance(SETTLE);
    });
    // `specs/rocket.md` has the rocket lifting off and the game arriving at the
    // Victory screen; how long the lift-off plays is the build's, so the scene is
    // run on generously rather than to a figure this specification never fixed.
    await h.advanceSeconds(LIFT_OFF_SECONDS, LIFT_OFF_FRAMES);
    return {
      before,
      launching: playsIn(log, CUES.launch, window).length,
      snapshot: h.snapshot(),
    };
  });

  assertEqual(heard.snapshot.screen, "victory", "specs/rocket.md");
  assertEqual(heard.before, false, "specs/assets.md");
  assertGreaterThan(heard.launching, 0, "specs/assets.md");
});
