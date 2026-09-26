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
//   The yard behind. The canvas is sampled on a lattice over the corner
//   structure's whole `2` by `2` footprint, and then sampled again at the same
//   points with the yard emptied. If the yard is drawn behind the menu, some
//   point of the footprint reads differently; if the menu paints over it, every
//   point reads the same colour. The whole footprint rather than one point,
//   because `specs/ui.md` fixes that the yard is visible and nothing about which
//   pixels of a structure differ from the ground under it: a head whose middle
//   is as dark as the substrate is as visible as any other by its outline, and a
//   scrim that dims the yard scales that one point's difference down with it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { drewText } from "../case-harness/text";
import { FOOTPRINT, PAUSE_ITEMS, structureCenter, TILE } from "../constants";
import {
  captureStill,
  ConstantClock,
  createHarness,
  lattice,
  maxDistance,
  openYard,
  standComponent,
  type Harness,
  type Rect,
} from "../harness";

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
 * How far apart the two samplings must read, at their furthest point, before the
 * structure counts as visible behind the menu.
 *
 * The floor any presence reading in this project clears, and nothing over it.
 * `specs/ui.md` asks for a yard that is "visible" behind the menu and says
 * nothing about how strongly, so a build that dims the whole yard under a scrim
 * is conforming and its structure is still there to be seen. What this rules out
 * is a menu that paints the yard away entirely, which leaves every point of the
 * two samplings identical.
 */
const VISIBLE_MIN = 8;

/** How far apart the footprint is sampled, in logical units. */
const FOOTPRINT_STEP = 4;

/** The `2` by `2` footprint of the structure anchored at `(col, row)`. */
function footprintOf(col: number, row: number): Rect {
  const centre = structureCenter(col, row);
  return {
    x: centre.x - TILE,
    y: centre.y - TILE,
    w: FOOTPRINT * TILE,
    h: FOOTPRINT * TILE,
  };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ clock: new ConstantClock(1000 / FROZEN_HZ) });
});

afterEach(async () => {
  await h.dispose();
});

it("draws its three entries over a yard that is visible and frozen", async () => {
  await openYard(h, { wave: 6 });
  await standComponent(h, "discharge", 5, CORNER.col, CORNER.row);

  await h.debug.setScreen("paused");
  const calls = await h.frameCalls();
  await captureStill(h, "pause");

  const opened = await h.snapshot();
  assertEqual(opened.screen, "paused", "the pause menu showing (specs/ui.md)");

  for (const item of PAUSE_ITEMS) {
    assertEqual(
      drewText(calls, item),
      true,
      `the pause menu to draw its ${item} entry (specs/ui.md)`,
    );
  }

  // The yard behind: the corner structure is still on the canvas.
  const footprint = lattice(
    footprintOf(CORNER.col, CORNER.row),
    FOOTPRINT_STEP,
  );
  const withStructure = await h.pixels(footprint);
  await h.debug.clearStructures();
  await h.frameCalls();
  const withoutStructure = await h.pixels(footprint);
  assertGreaterThan(
    maxDistance(withStructure, withoutStructure),
    VISIBLE_MIN,
    "some point of a structure's footprint to change colour when the yard is " +
      "emptied under the pause menu, because the yard is visible behind it " +
      "(specs/ui.md)",
  );

  // And frozen: the simulation clock does not move while the menu is up.
  const before = (await h.snapshot()).simTime;
  await h.advance(frozenFrames(FROZEN_SECONDS));
  assertEqual(
    (await h.snapshot()).simTime,
    before,
    "the simulation clock across ten seconds of frames with the pause menu " +
      "open, which advances by nothing (specs/controls.md)",
  );
});
