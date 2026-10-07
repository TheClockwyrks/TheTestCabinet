// audio/thrust-loop — the jetpack cue sounds while it is firing and not otherwise.
//
// `specs/assets.md`: the `thrust` cue plays looping while the jetpack fires. So
// three windows of the same length are measured on one falling miner — falling,
// thrusting, falling again — and the build must be silent, then sounding, then
// silent. `specs/character.md` makes the first and third windows genuinely
// silent: falling costs no fuel and carries no cue of its own.
//
// The cue is read BY NAME off the engine's audio bus, so a build that sounds
// something else while thrust is held fails rather than passing on the noise. A
// cue held as one looping source and a cue re-triggered while the key is down both
// pass; `specs/assets.md` fixes only that it plays while the jetpack fires.
//
// The mine is cleared and the miner is left high above the Core chamber with its
// drill held, so nothing is cut, nothing is landed on, and the only thing that can
// sound is the jetpack.

import { afterEach, beforeEach, it } from "vitest";
import { CUES, PLAYABLE_COL_MIN, TILE } from "../constants";
import { assertEqual, assertGreaterThan } from "../assert";
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
import { audibleOver, loopingNow, watchAudio } from "./cues";

const ROW = 100;
const COL = PLAYABLE_COL_MIN + 8;

/** Each window, in seconds, and the frames it is driven in. */
const WINDOW = 1;
const FRAMES = 120;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sounds the thrust cue while thrust is held and not either side of it", async () => {
  openScene(h);
  pinDrill(h);
  placeAt(h, minerXOn(COL), ROW * TILE);

  const log = watchAudio(h);
  const heard = await captureReplay(h, "thrust", async () => {
    const before = await audibleOver(h, log, CUES.thrust, WINDOW, FRAMES);
    h.hold(ACTION_KEY.up);
    const during = await audibleOver(h, log, CUES.thrust, WINDOW, FRAMES);
    h.release(ACTION_KEY.up);
    // The key-up reaches the game on the frame that follows it, and a loop ends
    // on the frame its condition changed — so the settling frame is driven before
    // the window opens, and what the window reads is silence rather than the tail
    // of the cut.
    await h.advance(1);
    const after = await audibleOver(h, log, CUES.thrust, WINDOW, FRAMES);
    return { before, during, after, snapshot: h.snapshot() };
  });

  assertGreaterThan(heard.snapshot.miner.fuel, 0, "specs/character.md");
  assertEqual(heard.before, false, "specs/assets.md");
  assertEqual(heard.during, true, "specs/assets.md");
  assertEqual(heard.after, false, "specs/assets.md");
  assertEqual(loopingNow(log, CUES.thrust), false, "specs/assets.md");
});
