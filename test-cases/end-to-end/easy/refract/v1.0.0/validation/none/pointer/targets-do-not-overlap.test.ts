// Refract — pointer/targets-do-not-overlap: no two targets on a screen share
// any area.
//
// specs/controls.md rests the whole of the pointer's screen handling on this:
// a pointer position lies in at most one target, so the rule that decides what
// a press highlights and what a release takes is unambiguous. Two overlapping
// targets make a press mean one thing or the other depending on which the build
// happened to test first, which is exactly the flakiness a player feels as a
// menu that sometimes takes the wrong item.

import { afterEach, beforeEach, it } from "vitest";
import { R9_UNIQUE } from "../fixtures";
import { assertTruthy } from "../assert";
import {
  captureStill,
  createHarness,
  loadBoard,
  startCampaign,
  targetsOverlap,
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

  // Every screen the walk does not arrive at in play is POSED with `setScreen`,
  // which sets `state.screen` alone (specs/instrumentation.md). The geometry
  // measured here belongs to the screen itself, so reaching one through the
  // menus would fail this point for a build whose menus are the broken part.
  await h.debug.setScreen("howto");
  await h.advance(1);
  walked.push({ name: "howto", targets: (await h.snapshot()).targets });

  await startCampaign(h);
  walked.push({ name: "select", targets: (await h.snapshot()).targets });
  // The still is the grid, not whatever screen the walk ends on.
  await captureStill(h, "select");

  await loadBoard(h, R9_UNIQUE);
  walked.push({ name: "playing", targets: (await h.snapshot()).targets });

  // The posed board stays behind both, as specs/modes/campaign.md has it.
  // `boardIndex` rests at 0, so the solved board is board 1 and the screen
  // offers the next board alongside the replay and the way back.
  await h.debug.setScreen("solved");
  await h.advance(1);
  walked.push({ name: "solved", targets: (await h.snapshot()).targets });

  await h.debug.setScreen("complete");
  await h.advance(1);
  walked.push({ name: "complete", targets: (await h.snapshot()).targets });

  return walked;
}

it("leaves no two targets on a screen intersecting", async () => {
  const walked = await screens();

  for (const screen of walked) {
    for (let i = 0; i < screen.targets.length; i++) {
      for (let j = i + 1; j < screen.targets.length; j++) {
        const a = screen.targets[i];
        const b = screen.targets[j];
        if (a === undefined || b === undefined) continue;
        assertTruthy(
          !targetsOverlap(a, b),
          `${screen.name}: ${a.id} and ${b.id} do not overlap ` +
            "(specs/controls.md, Pointer targets)",
        );
      }
    }
  }
});
