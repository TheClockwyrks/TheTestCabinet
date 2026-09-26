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
  resetTo,
  startCampaign,
  type TargetSnapshot,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

type Target = TargetSnapshot;

/** Every screen this check walks, and how it gets there. */
async function screens(): Promise<{ name: string; targets: Target[] }[]> {
  await resetTo(h);
  const walked: { name: string; targets: Target[] }[] = [
    { name: "title", targets: h.snapshot().targets },
  ];

  // Every screen the walk does not arrive at in play is POSED with `setScreen`,
  // which sets `state.screen` alone (specs/instrumentation.md). The geometry
  // measured here belongs to the screen itself, so reaching one through the
  // menus would fail this point for a build whose menus are the broken part.
  h.debug.setScreen("howto");
  await h.advance(1);
  walked.push({ name: "howto", targets: h.snapshot().targets });

  await startCampaign(h);
  walked.push({ name: "select", targets: h.snapshot().targets });
  // The still is the grid, not whatever screen the walk ends on.
  captureStill(h, "select");

  await loadBoard(h, R9_UNIQUE);
  walked.push({ name: "playing", targets: h.snapshot().targets });

  // The posed board stays behind both, as specs/modes/campaign.md has it.
  // `boardIndex` rests at 0, so the solved board is board 1 and the screen
  // offers the next board alongside the replay and the way back.
  h.debug.setScreen("solved");
  await h.advance(1);
  walked.push({ name: "solved", targets: h.snapshot().targets });

  h.debug.setScreen("complete");
  await h.advance(1);
  walked.push({ name: "complete", targets: h.snapshot().targets });

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
