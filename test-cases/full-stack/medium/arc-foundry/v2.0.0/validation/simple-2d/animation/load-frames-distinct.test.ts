// Arc Foundry — animation/load-frames-distinct: a Load type's idle cycle is
// more than one picture repeated.
//
// THE REQUIREMENT, from `specs/assets.md`: an idle cycle "loops while its subject
// is on the yard", and what the cycles must deliver is "that the Load visibly
// crackles".
//
// WHAT A CYCLE HAS TO DELIVER, AND WHAT IT DOES NOT. `specs/assets.md` states the
// floor itself: "A body may be reused across tints; what the cycles must deliver
// is that the Load visibly crackles, a firing structure visibly charges and
// discharges, and the Dynamo visibly seethes." That is a requirement on what the
// cycle DOES when it is played, and it is the only thing the specification fixes
// about the frames inside one. A cycle that holds two pictures delivers it — a
// ping-pong loops as movement frame after frame, and a hold-strike-hold stamps
// once a loop — and a cycle whose four frames are ONE picture delivers nothing
// however fast it is played. So what is asked here is that the cycle not be one
// picture repeated, and nothing about how many of the four are distinct.
//
// COMPARED AS PIXELS, NOT AS BYTES. Two encodings of one picture are one picture,
// and `./images.ts` decodes each frame and compares the decoded RGBA. Frames of
// different sizes are different pictures by definition.
//
// WHETHER THE CYCLE IS PLAYED AT ALL is a separate point:
// `animation/load-cycle-animates` reads the pixels over a held unit, and
// `animation/fire-cycle-plays-on-a-shot` reads the footprint of one that fires.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import { createHarness, type Harness, openYard, releaseUnit } from "../harness";
import { cycleFrames, decodeAll, evidence, onePicture } from "./images";
import { SPAWN_TYPES } from "../constants";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds more than one picture in each Load type's cycle", async () => {
  await evidence(h, "cycle", async () => {
    openYard(h);
    releaseUnit(h, "slug", { tile: { col: 24, row: 16 }, frozen: true });
    await h.advance(1);
  });

  const still: string[] = [];
  for (const type of SPAWN_TYPES) {
    const frames = await decodeAll(cycleFrames(`load/${type}`));
    if (onePicture(frames)) still.push(`load/${type}`);
  }
  assertDeepEqual(
    still,
    [],
    "every Load cycle to hold more than one picture, so the unit visibly " +
      "crackles (specs/assets.md); these cycles are one picture four times",
  );
});
