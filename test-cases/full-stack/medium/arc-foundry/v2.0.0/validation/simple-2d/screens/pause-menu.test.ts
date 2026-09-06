// screens/pause-menu — the pause menu covers a frozen yard.
//
// THE REQUIREMENT. `specs/ui.md`, of `paused`: "The pause menu, over a yard that
// is visible and frozen behind it. It offers `RESUME`, `RESTART`, and
// `QUIT TO MENU`." `specs/controls.md` fixes the freezing half: with "the pause
// menu open" the simulation clock advances by nothing. Three claims, and all three
// are read here, because a build that shows the right three entries over a black
// rectangle has lost the yard, and one that shows them over a yard that keeps
// running has not paused anything.
//
// HOW IT IS DECIDED. A run is posed with one component standing in the bottom-left
// corner of the yard, well away from where a centred menu would fall, and the
// pause menu is opened directly through the operation that reaches a screen
// "exactly as reaching it in play does".
//
//   The entries. The frame's own text draws carry all three, by substring and
//   ignoring case, because the layout, the palette and the type are the build's.
//   The freeze. Ten seconds of frames are driven and the simulation clock is read.
//   The yard behind. The canvas is sampled at the corner structure's own centre,
//   and then sampled again at the same point with the yard emptied. If the yard
//   is drawn behind the menu the two readings differ; if the menu paints over it,
//   they are the same colour.

import { ConstantClock } from "@clockwyrks/simple-2d";
import { afterEach, beforeEach, it } from "vitest";
import { drewText } from "../case-harness/text";
import { PAUSE_ITEMS, structureCenter } from "../constants";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  colorDistance,
  createHarness,
  type Harness,
  openYard,
  sampleColor,
  standComponent,
} from "../harness";
import { SAMPLE_SPREAD } from "./reading";

/** A corner of the yard a centred pause menu does not reach. */
const CORNER = { col: 2, row: 29 };

/**
 * The frame rate the frozen span is driven at: `10` Hz, a twelfth of this
 * project's default.
 *
 * What is read across the span is one number that must not move — the simulation
 * clock, which `specs/controls.md` says "advances by nothing" while the pause menu
 * is open. Nothing positional, no projectile and no rate is measured over it, so
 * no bound on the size of a frame arises; `specs/instrumentation.md` fixes none,
 * and `instrumentation/frame-division-movement` and
 * `instrumentation/frame-division-projectile` are the two items that decide that
 * guarantee. The ten seconds the claim is stated over are unchanged; the frames
 * they are divided into are a hundred rather than twelve hundred.
 */
const FROZEN_HZ = 10;

/** Frames of that clock covering `s` seconds, rounded up. */
function frozenFrames(seconds: number): number {
  return Math.ceil(seconds * FROZEN_HZ);
}

/** How long the frozen yard is watched for. */
const FROZEN_SECONDS = 10;

/**
 * How far apart the two samples must sit before the structure counts as visible
 * behind the menu.
 *
 * The floor any presence reading in this project clears, and nothing over it.
 * `specs/ui.md` asks for a yard that is "visible" behind the menu and says
 * nothing about how strongly, so a build that dims the whole yard under a scrim
 * is conforming and its structure is still there to be seen. What this rules out
 * is a menu that paints the yard away entirely, which leaves the two samples
 * identical.
 */
const VISIBLE_MIN = 8;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ clock: new ConstantClock(1000 / FROZEN_HZ) });
});

afterEach(() => {
  h.dispose();
});

it("draws its three entries over a yard that is visible and frozen", async () => {
  openYard(h, { wave: 6 });
  standComponent(h, "discharge", 5, CORNER.col, CORNER.row);

  h.debug.setScreen("paused");
  const calls = await h.frameCalls();
  captureStill(h, "pause");

  const opened = h.snapshot();
  assertEqual(opened.screen, "paused", "the pause menu showing (specs/ui.md)");

  for (const item of PAUSE_ITEMS) {
    assertEqual(
      drewText(calls, item),
      true,
      `the pause menu to draw its ${item} entry (specs/ui.md)`,
    );
  }

  // The yard behind: the corner structure is still on the canvas.
  const centre = structureCenter(CORNER.col, CORNER.row);
  const withStructure = sampleColor(h, centre.x, centre.y, SAMPLE_SPREAD);
  h.debug.clearStructures();
  await h.frameCalls();
  const withoutStructure = sampleColor(h, centre.x, centre.y, SAMPLE_SPREAD);
  assertGreaterThan(
    colorDistance(withStructure, withoutStructure),
    VISIBLE_MIN,
    "the colour at a structure's own centre to change when the yard is " +
      "emptied under the pause menu, because the yard is visible behind it " +
      "(specs/ui.md)",
  );

  // And frozen: the simulation clock does not move while the menu is up.
  const before = h.snapshot().simTime;
  await h.advance(frozenFrames(FROZEN_SECONDS));
  assertEqual(
    h.snapshot().simTime,
    before,
    "the simulation clock across ten seconds of frames with the pause menu " +
      "open, which advances by nothing (specs/controls.md)",
  );
});
