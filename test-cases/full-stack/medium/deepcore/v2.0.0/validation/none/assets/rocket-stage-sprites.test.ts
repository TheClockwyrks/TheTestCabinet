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
// drawn at which count is a different requirement and its own point.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { allDistinct, readPicture, type Picture } from "./produced";
import { ROCKET_STAGES } from "../constants";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("produces six distinct rocket assembly sprites", async () => {
  const missing: string[] = [];
  const pictures: Picture[] = [];
  for (let stage = 0; stage < ROCKET_STAGES; stage += 1) {
    const picture = await readPicture(h, "rocket", `stage${stage}.png`);
    if (picture === null) missing.push(`assets/rocket/stage${stage}.png`);
    else pictures.push(picture);
  }
  await captureStill(h, "stages");

  assertEqual(missing.join(", "), "", "specs/assets.md");
  assertEqual(allDistinct(pictures), true, "specs/assets.md");
});
