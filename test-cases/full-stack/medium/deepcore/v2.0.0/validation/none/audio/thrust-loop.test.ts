// audio/thrust-loop — the jetpack sounds while it is firing and not otherwise.
//
// `specs/assets.md`: the `thrust` cue plays looping while the jetpack fires. So
// three windows of the same length are measured on one falling miner — falling,
// thrusting, falling again — and the build must be silent, then sounding, then
// silent. `specs/character.md` makes the first and third windows genuinely
// silent: falling costs no fuel and carries no cue of its own.
//
// Only the START of a sound is observable from outside an engineless build, so
// "stops when it is released" is read as nothing further being emitted once the
// key is up. The mine is cleared and the miner is left high above the Core
// chamber with its drill held, so nothing is cut, nothing is landed on, and the
// only thing that can sound is the jetpack.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { PLAYABLE_COL_MIN, TILE } from "../constants";
import {
  ACTION_KEY,
  captureReplay,
  createHarness,
  minerXOn,
  openScene,
  pinDrill,
  placeAt,
  type Harness,
} from "../harness";
import { armAudio, soundsOver } from "./probe";

const ROW = 100;
const COL = PLAYABLE_COL_MIN + 8;

/** Each window, in seconds, and the frames it is driven in. */
const WINDOW = 1;
const FRAMES = 120;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds while thrust is held and is silent either side of it", async () => {
  const armed = await armAudio(h);
  await openScene(h);
  await pinDrill(h);
  await placeAt(h, minerXOn(COL), ROW * TILE);

  const heard = await captureReplay(h, "thrust", async () => {
    const before = await soundsOver(h, WINDOW, FRAMES);
    await h.hold(ACTION_KEY.up);
    const during = await soundsOver(h, WINDOW, FRAMES);
    await h.release(ACTION_KEY.up);
    const after = await soundsOver(h, WINDOW, FRAMES);
    return { before, during, after, snapshot: await h.snapshot() };
  });

  assertEqual(armed, true, "specs/assets.md");
  assertGreaterThan(heard.snapshot.miner.fuel, 0, "specs/character.md");
  assertEqual(heard.before, 0, "specs/assets.md");
  assertGreaterThan(heard.during, 0, "specs/assets.md");
  assertEqual(heard.after, 0, "specs/assets.md");
});
