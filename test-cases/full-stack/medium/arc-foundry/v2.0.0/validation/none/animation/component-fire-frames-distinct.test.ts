// Arc Foundry — animation/component-fire-frames-distinct: a component's firing
// cycle is more than one picture repeated.
//
// THE REQUIREMENT, from `specs/assets.md`: a firing cycle shows "the head's
// charge-and-discharge, played once per shot", and what the cycles must deliver
// is "that a firing structure visibly charges and discharges".
//
// WHAT A CYCLE HAS TO DELIVER, AND WHAT IT DOES NOT. `specs/assets.md` states the
// floor itself: "A body may be reused across tints; what the cycles must deliver
// is that the Load visibly crackles, a firing structure visibly charges and
// discharges, and the Dynamo visibly seethes." That is a requirement on what the
// cycle DOES when it is played, and it is the only thing the specification fixes
// about the frames inside one. A cycle that holds two pictures delivers it — a
// dim head and a bright one, played as a loop, charge and discharge — and a cycle
// whose four frames are ONE picture delivers nothing however fast it is played.
// So what is asked here is that the cycle not be one picture repeated, and
// nothing about how many of the four are distinct.
//
// COMPARED AS PIXELS, NOT AS BYTES. Two encodings of one picture are one picture,
// and `./images.ts` decodes each frame and compares the decoded RGBA.
//
// WHETHER THE CYCLE IS PLAYED AT ALL is the separate point
// `animation/fire-cycle-plays-on-a-shot`, which reads the footprint of a
// structure that fires.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import { COMPONENT_TYPES } from "../constants";
import {
  createHarness,
  openYard,
  standComponent,
  type Harness,
} from "../harness";
import { cycleFrames, decodeAll, evidence, onePicture } from "./images";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds more than one picture in each component's firing cycle", async () => {
  await evidence(h, "cycle", async () => {
    await openYard(h);
    await standComponent(h, "capacitor", 5, 24, 15);
    await h.advance(1);
  });

  const still: string[] = [];
  for (const type of COMPONENT_TYPES) {
    const frames = await decodeAll(cycleFrames(`components/${type}/fire`));
    if (onePicture(frames)) still.push(`components/${type}/fire`);
  }
  assertDeepEqual(
    still,
    [],
    "every component's firing cycle to hold more than one picture, so a " +
      "firing structure visibly charges and discharges (specs/assets.md); " +
      "these cycles are one picture four times",
  );
});
