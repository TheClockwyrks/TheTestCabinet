// Refract — pointer/targets-are-finger-sized: every pointer target is at least
// TARGET_MIN_W by TARGET_MIN_H and sits inside the stage.
//
// specs/controls.md fixes both figures as what a fingertip needs at the stage
// size, which is the whole of what makes the game playable by touch: a target
// smaller than that is a control a finger cannot reliably hit, however well it
// is drawn. The rectangles are read off the build's own snapshot, so what is
// measured is the geometry the build hit-tests against rather than anything
// inferred from the picture.

import { afterEach, beforeEach, it } from "vitest";
import { TARGET_MIN_H, TARGET_MIN_W } from "../constants";
import { STAGE_H, STAGE_W } from "../notation";
import { R9_UNIQUE } from "../fixtures";
import { assertGreaterThanOrEqual, assertTruthy } from "../assert";
import {
  captureStill,
  createHarness,
  loadBoard,
  startCampaign,
  type TargetSnapshot,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

type Target = TargetSnapshot;

/** Every screen this check walks, and how it gets there. */
async function screens(): Promise<{ name: string; targets: Target[] }[]> {
  await h.debug.reset({ seed: 1 });
  await h.advance(1);
  const walked: { name: string; targets: Target[] }[] = [
    { name: "title", targets: (await h.snapshot()).targets },
  ];

  await startCampaign(h);
  walked.push({ name: "select", targets: (await h.snapshot()).targets });
  // The still is the grid, not whatever screen the walk ends on.
  await captureStill(h, "select");

  await loadBoard(h, R9_UNIQUE);
  walked.push({ name: "playing", targets: (await h.snapshot()).targets });

  return walked;
}

it("gives every target at least TARGET_MIN_W by TARGET_MIN_H inside the stage", async () => {
  const walked = await screens();

  for (const screen of walked) {
    assertGreaterThanOrEqual(
      screen.targets.length,
      1,
      `the ${screen.name} screen carries pointer targets ` +
        "(specs/controls.md, Pointer targets)",
    );
    for (const target of screen.targets) {
      assertGreaterThanOrEqual(
        target.w,
        TARGET_MIN_W,
        `${screen.name}/${target.id} is at least TARGET_MIN_W wide`,
      );
      assertGreaterThanOrEqual(
        target.h,
        TARGET_MIN_H,
        `${screen.name}/${target.id} is at least TARGET_MIN_H tall`,
      );
      assertTruthy(
        target.x >= 0 &&
          target.y >= 0 &&
          target.x + target.w <= STAGE_W &&
          target.y + target.h <= STAGE_H,
        `${screen.name}/${target.id} lies wholly within the stage`,
      );
    }
  }

});
