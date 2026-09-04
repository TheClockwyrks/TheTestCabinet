// Deepcore — putting the miner in one animation state, for the points about its
// produced cycles. CASE-PROVIDED.
//
// `specs/character.md` fixes what each of the eight animation states IS — standing
// on solid ground, moving laterally, braced and cutting below, braced and cutting
// beside, holding thrust, descending without thrust, taking damage, below the
// surface with fuel at `0` — and `specs/assets.md` asks for one produced cycle per
// state. So a check about a cycle reaches its state by DOING the thing rather than
// by posing a state the surface does not carry: the key goes down and the game's
// own rules decide what the miner is.
//
// Each pose opens its own scene, so nothing a check before it did carries over,
// and every key it put down is let up first. What it leaves is the miner in the
// state, still doing whatever puts it there, so the frame on screen is the cycle's.

import {
  HULL_TIERS,
  MINER_H,
  MINER_W,
  PLAYABLE_COL_MIN,
  TILE,
} from "../../src/constants";
import type { MinerState } from "../../src/constants";
import {
  ACTION_KEY,
  layCamp,
  layFloor,
  minerXOn,
  openScene,
  pinDrill,
  pinMiner,
  placeAt,
  stageTiers,
  standAtCamp,
  standOn,
  worldToStage,
  type Harness,
} from "../harness";
import type { Box } from "./drawn";

/** A rockbed row, whose eight points of health outlast every lead below. */
export const MINER_ROW = 200;
export const MINER_COL = PLAYABLE_COL_MIN + 8;

/** Frames held before a reading, so the miner is doing the thing rather than starting it. */
export const LEAD = 24;

/** How finely a window over the miner is sampled, in frames per second. */
export const SAMPLE_HZ = 120;

/** How high above the floor a state in open air is posed, in tiles. */
const AIR_TILES = 6;

/**
 * Put the miner in `state` and leave it there, in a scene of its own.
 *
 * Nothing here asserts the state it reached: a check that is ABOUT the state reads
 * the snapshot itself, and a check that is about the produced FILES only wants the
 * miner on screen doing the thing.
 */
export async function showMiner(
  h: Harness,
  state: MinerState,
): Promise<void> {
  h.releaseAll();
  openScene(h);

  if (state === "fuel-out") {
    // `specs/character.md`: below the surface with fuel at `0`.
    layFloor(h, MINER_ROW);
    standOn(h, MINER_COL, MINER_ROW);
    pinDrill(h);
    h.debug.setFuel(0);
    await h.advance(1);
    return;
  }

  if (state === "hurt") {
    // `specs/hazards.md` shakes the screen on a detonation, a blast and a hard
    // landing; a lava touch is the one blow on its list that shakes nothing, so
    // the miner is drawn where it stands. The cell is turned back straight after,
    // so the flinch runs from one blow rather than being re-armed every frame.
    layFloor(h, MINER_ROW);
    standOn(h, MINER_COL, MINER_ROW);
    pinDrill(h);
    pinMiner(h);
    stageTiers(h, { hull: 5 });
    h.debug.setHull(HULL_TIERS[4]);
    h.debug.setNoticeFired("lava", true);
    await h.advance(1);
    h.debug.setTile(MINER_COL, MINER_ROW - 1, "lava");
    await h.advance(1);
    h.debug.setTile(MINER_COL, MINER_ROW - 1, "tunnel");
    await h.advance(1);
    return;
  }

  if (state === "jetpack" || state === "fall") {
    pinDrill(h);
    placeAt(h, minerXOn(MINER_COL), (MINER_ROW - AIR_TILES) * TILE);
    if (state === "jetpack") h.hold(ACTION_KEY.up);
    await h.advance(LEAD);
    return;
  }

  layFloor(h, MINER_ROW);
  standOn(h, MINER_COL, MINER_ROW, "east");

  if (state === "idle") {
    pinDrill(h);
    await h.advance(LEAD);
    return;
  }

  if (state === "walk") {
    // A cleared run to walk along, so the miner is moving laterally rather than
    // already flush against something and cutting it.
    pinDrill(h);
    h.hold(ACTION_KEY.right);
    await h.advance(LEAD);
    return;
  }

  if (state === "drill-down") {
    pinMiner(h);
    h.hold(ACTION_KEY.down);
    await h.advance(LEAD);
    return;
  }

  // `drill-side`: a wall in the cell the miner's box would move into, walked up to
  // and then cut.
  h.debug.setTile(MINER_COL + 1, MINER_ROW - 1, "rock");
  h.hold(ACTION_KEY.right);
  await h.advance(LEAD);
}

/** Where the miner's box is drawn on the stage, right now. */
export function minerBox(h: Harness): Box {
  const snapshot = h.snapshot();
  const at = worldToStage(snapshot, snapshot.miner.x, snapshot.miner.y);
  return { x: at.x, y: at.y, w: MINER_W, h: MINER_H };
}

/** Where the centre of the miner's box is drawn on the stage, right now. */
export function minerCentre(h: Harness): { x: number; y: number } {
  const snapshot = h.snapshot();
  return worldToStage(
    snapshot,
    snapshot.miner.x + MINER_W / 2,
    snapshot.miner.y + MINER_H / 2,
  );
}

/** The camp, with the miner standing on it, for a state read at the surface. */
export function showAtCamp(h: Harness): void {
  h.releaseAll();
  openScene(h);
  layCamp(h);
  standAtCamp(h);
  pinDrill(h);
}
