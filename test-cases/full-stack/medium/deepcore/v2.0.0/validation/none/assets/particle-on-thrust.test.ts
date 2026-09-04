// assets/particle-on-thrust — the exhaust plays under a thrusting miner.
//
// `specs/assets.md`: `jetpack-exhaust.json` fires while "The miner is thrusting"
// and carries "A downward plume of hot exhaust and sparks, pulsing with the hold".
// So the drawing under the miner is counted twice over one cleared shaft: falling
// with nothing held, and climbing with thrust held. `specs/character.md` makes the
// first genuinely quiet — falling costs no fuel and carries no effect of its own —
// so the difference is the plume.
//
// The point measured MOVES with the miner, because that is what the requirement
// says: the plume is under the jetpack rather than at the place the climb started.
// It is re-read before every frame of both readings.
//
// The mine is cleared and the drill is held, so nothing is cut, nothing is landed
// on, and no other effect can be playing.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { MINER_H, MINER_W, PLAYABLE_COL_MIN, TILE } from "../constants";
import {
  ACTION_KEY,
  captureReplay,
  createHarness,
  minerXOn,
  openScene,
  pinDrill,
  placeAt,
  worldToStage,
  type Harness,
} from "../harness";
import { peakNear } from "./effects";

const ROW = 200;
const COL = PLAYABLE_COL_MIN + 8;

/** Frames each reading is taken over. */
const FRAMES = 20;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws more under the miner while thrusting than while falling", async () => {
  await openScene(h);
  await pinDrill(h);
  await placeAt(h, minerXOn(COL), ROW * TILE);
  await h.advance(2);

  /** The point under the miner's feet, wherever it is now. */
  const under = async (): Promise<{ x: number; y: number }> => {
    const snapshot = await h.snapshot();
    return worldToStage(
      snapshot,
      snapshot.miner.x + MINER_W / 2,
      snapshot.miner.y + MINER_H,
    );
  };

  const falling = await peakNear(h, FRAMES, TILE, under);

  const thrusting = await captureReplay(h, "exhaust", async () => {
    await h.hold(ACTION_KEY.up);
    const peak = await peakNear(h, FRAMES, TILE, under);
    const snapshot = await h.snapshot();
    await h.release(ACTION_KEY.up);
    return { peak, snapshot };
  });

  assertEqual(thrusting.snapshot.miner.state, "jetpack", "specs/character.md");
  assertGreaterThan(thrusting.peak, falling, "specs/assets.md");
});
