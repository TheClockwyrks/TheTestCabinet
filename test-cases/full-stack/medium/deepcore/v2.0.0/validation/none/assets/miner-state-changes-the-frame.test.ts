// assets/miner-state-changes-the-frame — each state draws its own miner.
//
// `specs/assets.md` asks for one produced cycle per animation state and describes
// what each carries: standing at rest, a readable walk, braced downward, thrusting,
// dropping limp. `specs/overview.md` states the requirement those descriptions
// serve: "The miner ... the same character in every animation state, and its
// current state is readable from the frame on screen."
//
// So the miner is driven into five of its states in turn — the five ordinary play
// moves through — and the pixels over its BOX are read in each. Every pair has to
// be drawn differently: a build playing one cycle for everything draws the same
// picture five times and fails, whatever it shipped under `assets/miner/`.
//
// THE BOX, NOT THE SPRITE'S FOOTPRINT. `specs/character.md` fixes the box at
// `MINER_W` by `MINER_H` and puts the miner's feet at its bottom edge, so the box
// holds the miner and nothing of the floor beneath it. That is what keeps the
// comparison about the miner: a reading that took in the ground would separate a
// standing miner from a falling one on the ground alone.
//
// Each state is reached by doing the thing rather than by posing a state, and the
// snapshot's own `state` is asserted before each reading, so a build whose state
// machine is wrong fails its own points rather than quietly passing this one.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { MINER_H, MINER_W, PLAYABLE_COL_MIN, TILE } from "../constants";
import {
  ACTION_KEY,
  captureStill,
  createHarness,
  layFloor,
  minerXOn,
  openScene,
  placeAt,
  standOn,
  worldToStage,
  type Harness,
} from "../harness";
import { boxChanged, sampleBox } from "./drawn";

const ROW = 200;
const COL = PLAYABLE_COL_MIN + 8;

/** Frames held before a reading, so the miner is doing the thing rather than starting it. */
const LEAD = 12;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws a different miner in each of five states", async () => {
  await openScene(h);
  await layFloor(h, ROW);

  /** Read the miner's box wherever it currently is, and report its state. */
  const read = async (): Promise<{ state: string; pixels: number[] }> => {
    const snapshot = await h.snapshot();
    const at = worldToStage(snapshot, snapshot.miner.x, snapshot.miner.y);
    return {
      state: snapshot.miner.state,
      pixels: await sampleBox(h, {
        x: at.x,
        y: at.y,
        w: MINER_W,
        h: MINER_H,
      }),
    };
  };

  const seen: Record<string, number[]> = {};
  const states: string[] = [];

  const take = async (): Promise<void> => {
    const taken = await read();
    seen[taken.state] = taken.pixels;
    states.push(taken.state);
  };

  // Standing.
  await standOn(h, COL, ROW);
  await h.advance(LEAD);
  await take();

  // Walking along the floor.
  await standOn(h, COL, ROW);
  await h.hold(ACTION_KEY.right);
  await h.advance(LEAD);
  await take();
  await h.release(ACTION_KEY.right);

  // Cutting the floor underfoot.
  await standOn(h, COL, ROW);
  await h.hold(ACTION_KEY.down);
  await h.advance(LEAD);
  await take();
  await h.release(ACTION_KEY.down);
  await captureStill(h, "states");

  // Thrusting in open air.
  await placeAt(h, minerXOn(COL), (ROW - 6) * TILE);
  await h.hold(ACTION_KEY.up);
  await h.advance(LEAD);
  await take();
  await h.release(ACTION_KEY.up);

  // And falling through it.
  await placeAt(h, minerXOn(COL), (ROW - 6) * TILE);
  await h.advance(LEAD);
  await take();

  const same: string[] = [];
  const drawn = Object.entries(seen);
  for (const [at, [state, pixels]] of drawn.entries()) {
    for (const [other, otherPixels] of drawn.slice(at + 1)) {
      if (boxChanged(pixels, otherPixels) === 0) same.push(`${state}/${other}`);
    }
  }

  assertEqual(
    states.join(", "),
    "idle, walk, drill-down, jetpack, fall",
    "specs/character.md",
  );
  assertEqual(same.join(", "), "", "specs/assets.md");
});
