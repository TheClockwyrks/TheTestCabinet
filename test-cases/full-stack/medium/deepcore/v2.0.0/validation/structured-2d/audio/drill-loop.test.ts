// audio/drill-loop — the drill cue sounds while it is cutting and not otherwise.
//
// `specs/assets.md`: the `drill` cue plays looping while the miner is cutting. So
// three windows of the same length are measured over one posed cell — standing
// still before the cut, holding the cut, and standing still after it — and the
// build must be silent, then sounding, then silent again.
//
// THE CUE IS READ BY NAME. The engine owns the audio bus and announces every play,
// loop start and loop stop with the name the game asked for (`engine/audio.md`),
// so what is decided here is that `drill` sounded while the cut ran and that
// nothing of that name was still sounding once the key was up. A build that holds
// one looping source and a build that re-triggers the cue on every hit both pass,
// because `specs/assets.md` fixes only that it plays while cutting; a build that
// sounds while nothing is happening, or that never sounds while cutting, fails.
//
// The cell is a coreshell one, whose `BAND_HEALTH` (`16`) takes sixteen hits at
// tier 1 — two seconds — so the cut runs for the whole of its window without the
// cell breaking and the break's own cue confusing the reading. The miner's travel
// is held so it neither sinks into the cut nor walks out of it.

import { afterEach, beforeEach, it } from "vitest";
import { BAND_HEALTH, CUES, PLAYABLE_COL_MIN } from "../../src/constants";
import { assertEqual } from "../assert";
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
import { audibleOver, loopingNow, watchAudio } from "./cues";

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

afterEach(() => {
  h?.dispose();
});

it("sounds the drill cue while a cut is held and not either side of it", async () => {
  openScene(h);
  layFloor(h, ROW);
  standOn(h, COL, ROW);
  pinMiner(h);

  const log = watchAudio(h);
  const heard = await captureReplay(h, "drill", async () => {
    const before = await audibleOver(h, log, CUES.drill, WINDOW, FRAMES);
    h.hold(ACTION_KEY.down);
    const during = await audibleOver(h, log, CUES.drill, WINDOW, FRAMES);
    h.release(ACTION_KEY.down);
    // The key-up reaches the game on the frame that follows it, and a loop ends
    // on the frame its condition changed — so the settling frame is driven before
    // the window opens, and what the window reads is silence rather than the tail
    // of the cut.
    await h.advance(1);
    const after = await audibleOver(h, log, CUES.drill, WINDOW, FRAMES);
    return { before, during, after, tile: h.tileAt(COL, ROW) };
  });

  assertEqual(heard.tile.maxHealth, BAND_HEALTH.coreshell, "specs/world.md");
  assertEqual(heard.before, false, "specs/assets.md");
  assertEqual(heard.during, true, "specs/assets.md");
  assertEqual(heard.after, false, "specs/assets.md");
  assertEqual(loopingNow(log, CUES.drill), false, "specs/assets.md");
});
