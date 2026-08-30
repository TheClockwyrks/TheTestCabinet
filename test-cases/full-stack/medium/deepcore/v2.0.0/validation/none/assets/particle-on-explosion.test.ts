// assets/particle-on-explosion — the blast plays at a detonating pocket.
//
// `specs/assets.md`: `gas-explosion.json` fires when "A gas pocket detonates" and
// carries "A violent burst larger than the cell: a hard flash, a fast shockwave
// ring, an outward shell, and flying debris". So the drawing around one posed
// pocket is counted before it goes up and again after, over the same world with
// nothing else in it.
//
// THE POCKET IS BLASTED RATHER THAN DRILLED, deliberately. `specs/items.md` has an
// explosives charge detonate every pocket inside it and `specs/hazards.md` resolves
// such a detonation exactly as a drilled one, so this reads the blast without a
// drill running — and without the drill's own effect near the same cell.
//
// The pocket is posed in the topsoil, where `specs/hazards.md`'s depth curve puts
// the damage at its `GAS_DAMAGE_MIN` floor, and the hull is filled to a raised
// tier's maximum, so the miner survives and the reading is not cut short by a
// death. Its travel is held, so the knockback moves it nowhere and the point being
// read stays where it was computed.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { HULL_MAX, PLAYABLE_COL_MIN, TILE } from "../constants";
import {
  captureReplay,
  cellCenter,
  createHarness,
  layFloor,
  openScene,
  pinDrill,
  pinMiner,
  stageItems,
  stageTiers,
  standOn,
  worldToStage,
  type Harness,
} from "../harness";
import { peakNear } from "./effects";

/** A topsoil row, where a detonation costs the least hull `specs/hazards.md` states. */
const ROW = 20;
const COL = PLAYABLE_COL_MIN + 8;

/** The pocket sits beside the miner's own cell, inside Dynamite's radius of one. */
const POCKET_COL = COL + 1;

/** Frames each reading is taken over. */
const BEFORE_FRAMES = 8;
const AFTER_FRAMES = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws more at the pocket once it detonates", async () => {
  await openScene(h);
  await pinDrill(h);
  await stageTiers(h, { hull: 5 });
  await h.debug.setHull(HULL_MAX[4]);
  await layFloor(h, ROW);
  await standOn(h, COL, ROW);
  await pinMiner(h);
  await h.debug.setNoticeFired("gas", true);
  await h.debug.setTile(POCKET_COL, ROW - 1, "gas");
  await stageItems(h, { dynamite: 1 });
  await h.advanceSeconds(0, 1);

  const snapshot = await h.snapshot();
  const centre = cellCenter(POCKET_COL, ROW - 1);
  const pocket = worldToStage(snapshot, centre.x, centre.y);
  const where = async (): Promise<{ x: number; y: number }> => pocket;

  const before = await peakNear(h, BEFORE_FRAMES, TILE * 2, where);

  const blasted = await captureReplay(h, "burst", async () => {
    await h.debug.useItem("dynamite");
    const peak = await peakNear(h, AFTER_FRAMES, TILE * 2, where);
    return { peak, snapshot: await h.snapshot() };
  });

  assertEqual(
    (await h.tileAt(POCKET_COL, ROW - 1)).kind,
    "tunnel",
    "specs/items.md",
  );
  assertGreaterThan(blasted.snapshot.miner.hull, 0, "specs/hazards.md");
  assertGreaterThan(blasted.peak, before, "specs/assets.md");
});
