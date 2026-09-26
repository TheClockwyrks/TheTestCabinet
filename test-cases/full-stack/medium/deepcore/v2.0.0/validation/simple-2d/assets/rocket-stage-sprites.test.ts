// assets/rocket-stage-sprites — the rocket is produced at all six states.
//
// `specs/assets.md`: `assets/rocket/stageN.png` holds "The rocket with `N`
// components installed, `stage0` through `stage5`", and the environment-sprite
// list asks for "The rocket at each of its six assembly states, from the bare pad
// to the launch-ready rocket, so the player reads the win progress from the pad".
//
// So all six must be there and all six must be different drawings: a build that
// ships one picture six times, or repeats a stage, leaves the player unable to
// read progress off the pad even though every file is present. Which stage is
// drawn at which count is a different requirement and its own point; the still
// here is the pad partway through, which is what a reviewer compares the six files
// against.
//
// THE STILL IS EVIDENCE ONLY. The verdict is read off the files, so the pose
// that puts the game beside them is guarded: a build whose debug surface
// cannot take the pose loses the picture and keeps the point, and no still is
// recorded over the un-posed frame.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  layCamp,
  openScene,
  pinDrill,
  standAtBuilding,
  type Harness,
} from "../harness";
import { allDistinct, readPicture, type Picture } from "./produced";
import { ROCKET_STAGES } from "../constants";

/** The count the still shows the pad at: partway up the checklist. */
const SHOWN = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("produces six distinct rocket assembly sprites", async () => {
  const missing: string[] = [];
  const pictures: Picture[] = [];
  for (let stage = 0; stage < ROCKET_STAGES; stage += 1) {
    const picture = await readPicture("rocket", `stage${stage}.png`);
    if (picture === null) missing.push(`assets/rocket/stage${stage}.png`);
    else pictures.push(picture);
  }

  try {
    openScene(h);
    layCamp(h);
    pinDrill(h);
    standAtBuilding(h, "launch-pad");
    h.debug.setPanel(null);
    h.debug.setRocketInstalled(SHOWN);
    await h.advance(2);
    captureStill(h, "stages");
  } catch (error) {
    // Evidence only; the readings below carry the verdict.
    console.warn(
      `deepcore: could not pose the still for \`stages\`, so none is recorded: ${String(error)}`,
    );
  }

  assertEqual(missing.join(", "), "", "specs/assets.md");
  assertEqual(allDistinct(pictures), true, "specs/assets.md");
});
