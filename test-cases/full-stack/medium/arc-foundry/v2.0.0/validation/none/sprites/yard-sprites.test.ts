// sprites/yard-sprites — the five the yard is drawn from.
//
// `specs/assets.md` fixes each by path and by canvas: `yard/substrate.png`,
// `yard/entry.png`, `yard/collector.png`, and `yard/housing.png` at `40 x 40`,
// and `yard/waypoint.png` at `20 x 20`, all under `assets/` at the repository
// root. `specs/yard.md` is what needs them — a `20`-unit tile, a `2` by `2`
// footprint, a blown feeder vent, a grounding sink, and a transformer box that
// fills a Fixed-blocked tile.
//
// The files themselves are what is read, because these are a deliverable of the
// run rather than a fixture: nothing was handed to the build.
//
// THE STILL IS EVIDENCE ONLY. The verdict is read off the files above the
// drive, so the pose that puts the yard beside them is guarded: a build whose
// debug surface cannot take the pose loses the picture and keeps the point,
// and no still is recorded over the un-posed frame.

import { it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, openYard } from "../harness";
import { YARD_SPRITES, canvasOf } from "./png";

it("produces the yard's five sprites at the sizes specs/assets.md fixes", async () => {
  for (const sprite of YARD_SPRITES) {
    const canvas = canvasOf(sprite);
    assertEqual(
      canvas.width,
      sprite.width,
      `the width of assets/${sprite.path}`,
    );
    assertEqual(
      canvas.height,
      sprite.height,
      `the height of assets/${sprite.path}`,
    );
  }

  const h = await createHarness();
  try {
    await openYard(h, { map: "transformer" });
    await h.advance(1);
    await captureStill(h, "yard");
  } catch (error) {
    // Evidence only; the readings above carry the verdict.
    console.warn(
      `arc foundry: could not pose the still for \`yard\`, so none is recorded: ${String(error)}`,
    );
  } finally {
    await h.dispose();
  }
});
