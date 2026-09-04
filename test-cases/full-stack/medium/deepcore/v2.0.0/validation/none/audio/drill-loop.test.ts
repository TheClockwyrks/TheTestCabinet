// audio/drill-loop — the drill sounds while it is cutting and not otherwise.
//
// `specs/assets.md`: the `drill` cue plays looping while the miner is cutting. So
// three windows of the same length are measured over one posed cell — standing
// still before the cut, holding the cut, and standing still after it — and the
// build must be silent, then sounding, then silent again.
//
// WHAT THAT CAN AND CANNOT SEPARATE. Only the START of a sound is observable from
// outside an engineless build, so "stops when the cut stops" is read as nothing
// further being emitted once the key is up. A cue held as one looping source and
// a cue re-triggered on every hit both pass, because `specs/assets.md` fixes
// neither; a build that sounds while nothing is happening, or that never sounds
// while cutting, fails.
//
// The cell is a coreshell one, whose `BAND_HEALTH` (`16`) takes sixteen hits at
// tier 1 — two seconds — so the cut runs for the whole of its window without the
// cell breaking and the break's own cue confusing the reading. The miner's travel
// is held so it neither sinks into the cut nor walks out of it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { BAND_HEALTH, PLAYABLE_COL_MIN } from "../constants";
import {
  ACTION_KEY,
  captureReplay,
  createHarness,
  layFloor,
  openScene,
  pinMiner,
  standOn,
  type Harness,
} from "../harness";
import { armAudio, soundsOver } from "./probe";

/** A coreshell row at the Standard size, whose rock takes two seconds to cut. */
const ROW = 450;
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

it("sounds while a cut is held and is silent either side of it", async () => {
  const armed = await armAudio(h);
  await openScene(h);
  await layFloor(h, ROW);
  await standOn(h, COL, ROW);
  await pinMiner(h);

  const heard = await captureReplay(h, "drill", async () => {
    const before = await soundsOver(h, WINDOW, FRAMES);
    await h.hold(ACTION_KEY.down);
    const during = await soundsOver(h, WINDOW, FRAMES);
    await h.release(ACTION_KEY.down);
    const after = await soundsOver(h, WINDOW, FRAMES);
    return { before, during, after, tile: await h.tileAt(COL, ROW) };
  });

  assertEqual(armed, true, "specs/assets.md");
  assertEqual(heard.tile.maxHealth, BAND_HEALTH.coreshell, "specs/world.md");
  assertEqual(heard.before, 0, "specs/assets.md");
  assertGreaterThan(heard.during, 0, "specs/assets.md");
  assertEqual(heard.after, 0, "specs/assets.md");
});
