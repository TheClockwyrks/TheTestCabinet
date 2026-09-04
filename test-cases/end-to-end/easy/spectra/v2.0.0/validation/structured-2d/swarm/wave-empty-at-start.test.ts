// swarm/wave-empty-at-start — a stage's live wave opens on a field no drone
// stands on.
//
// specs/swarm.md, "The wave and its entrance": "The drone roster holds every
// drone of the wave from that moment, each in phase `entering`, at its own
// starting point above `FIELD_TOP`, so no drone stands inside the play field when
// the wave opens." specs/stages.md says the same from the stage's side: "The
// field is empty for that hold: no drone stands on it and no bullet of either
// side is in flight, so a stage always opens on a clear field."
//
// So this reads the roster the instant the wave opens and requires every drone to
// be ABOVE the play field. It does not require the roster to be EMPTY: the wave's
// drones are on it from that moment, waiting above the field for their group's
// release, which is what `swarm/drones-enter` watches them fly in from.
//
// THE WAVE IS THE GAME'S OWN, opened by running the stage intro out with
// `startStage`, because the requirement is about the wave the game BUILDS. A
// posed field could not decide it: nothing was built, so there would be nothing
// to look at. `startPosed` clears the field and shuts the dive gate and the
// ship's contact test first, and the wave's OWN entry gate is turned back on
// before the intro is run out, because the wave this point reads is the one the
// game releases.
//
// WHY THE READING ALLOWS ONE FRAME'S TRAVEL. The intro hold gives way inside a
// driven frame, so the earliest a check can read the field is the end of that
// frame — by which time a build that released its first group as the wave opened
// has legitimately carried it one frame further down. One frame of entrance
// travel is the whole of that allowance; a drone that started inside the field
// is hundreds of units past it.

import { afterEach, beforeEach, it } from "vitest";
import { ENTER_SPEED, FIELD_TOP, droneSpeedScale } from "../constants";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  seconds,
  startPosed,
  startStage,
  type Harness,
} from "../harness";

/** The stage the wave is opened at: the first, which is a standard wave. */
const STAGE = 1;

/**
 * How far below `FIELD_TOP` a drone's centre may read, in logical units.
 *
 * One frame of entrance travel at the stage's own entrance speed —
 * `ENTER_SPEED` (260) times `droneSpeedScale(1)` (1), over the 0.01 s frame this
 * suite drives — because the reading is taken at the end of the frame the intro
 * hold gave way in. It is the frame's own arithmetic rather than a tolerance on
 * the rule: a drone that opened the wave standing in the field reads hundreds of
 * units past this.
 */
const OPENING_FRAME_TRAVEL = ENTER_SPEED * droneSpeedScale(STAGE) * seconds(1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens a stage's live wave with every drone still above FIELD_TOP", async () => {
  // A clean field with the two faculties that would move it on under the reading
  // shut: no dive is launched out of the formation that is about to assemble, and
  // nothing that reaches the ship costs a life. The wave's OWN entry gate goes
  // back on before the intro runs out, because the wave this point reads is the
  // one the game releases.
  startPosed(h);
  h.debug.setWaveEntry(true);
  await startStage(h, STAGE);

  const opened = h.snapshot();
  captureStill(h, "empty");

  assertEqual(
    opened.screen,
    "inWave",
    "the stage intro to have given way to the live wave (specs/stages.md)",
  );
  for (const drone of opened.drones) {
    assertLessThanOrEqual(
      drone.y - FIELD_TOP,
      OPENING_FRAME_TRAVEL,
      `how far drone ${drone.id} (${drone.kind}) stood BELOW FIELD_TOP ` +
        `(${FIELD_TOP}) in the frame the wave opened (specs/swarm.md)`,
    );
  }
});
