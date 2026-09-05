// assets/particle-on-death — the burst plays where the miner dies.
//
// `specs/assets.md`: `death-burst.json` fires when "The miner dies" and carries "A
// burst of venting suit and debris". `specs/modes.md` enumerates the deaths and
// `specs/character.md` states how the simplest of them is reached: hull standing at
// `0` destroys the miner, and the check is continuous rather than only at the blow
// — so an emptied hull becomes a death on the next update rather than at the pose.
//
// So the drawing around the miner is counted over the standing scene and again
// once the hull has been emptied and the game's own check has run. The mine is
// cleared and the drill is held, so nothing else near the miner can be playing,
// and the death is the only thing that changes between the two readings.

import { afterEach, beforeEach, it } from "vitest";
import {
  MINER_H,
  MINER_W,
  PLAYABLE_COL_MIN,
  TILE,
} from "../constants";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureReplay,
  createHarness,
  layFloor,
  openScene,
  pinDrill,
  standOn,
  worldToStage,
  type Harness,
} from "../harness";
import { peakNear } from "./effects";

const ROW = 200;
const COL = PLAYABLE_COL_MIN + 8;

/** Frames each reading is taken over. */
const BEFORE_FRAMES = 12;
const AFTER_FRAMES = 40;

/** How long the expedition is run on for after the blow, and in how many frames. */
const ENDING_SECONDS = 8;
const ENDING_FRAMES = 80;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws more at the miner once it dies", async () => {
  openScene(h);
  pinDrill(h);
  layFloor(h, ROW);
  standOn(h, COL, ROW);
  await h.advance(2);

  const snapshot = h.snapshot();
  const at = worldToStage(
    snapshot,
    snapshot.miner.x + MINER_W / 2,
    snapshot.miner.y + MINER_H / 2,
  );
  const where = (): { x: number; y: number } => at;

  const alive = await peakNear(h, BEFORE_FRAMES, TILE * 3, where);

  const dead = await captureReplay(h, "burst", async () => {
    h.debug.setHull(0);
    const peak = await peakNear(h, AFTER_FRAMES, TILE * 3, where);
    await h.advanceSeconds(ENDING_SECONDS, ENDING_FRAMES);
    return { peak, snapshot: h.snapshot() };
  });

  assertEqual(
    dead.snapshot.summary?.deathCause ?? null,
    "hull-destroyed",
    "specs/modes.md",
  );
  assertGreaterThan(dead.peak, alive, "specs/assets.md");
});
