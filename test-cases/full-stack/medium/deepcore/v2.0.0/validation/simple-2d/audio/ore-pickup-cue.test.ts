// audio/ore-pickup-cue — banking ore sounds its own cue, on the frame it is banked.
//
// `specs/assets.md`: the `ore-pickup` cue plays when an ore or gemstone is banked.
// `specs/mining.md` fixes when that is — the drill breaks an ore cell and one unit
// goes into the bay — so the reading is taken on the frame the cell broke.
//
// TWO THINGS THE ENGINE'S BUS MAKES READABLE. Which cue it was, because the engine
// announces a play by name (`engine/audio.md`), and when it was, because the play
// carries the frame it happened on. So a build that sounds its drill cue at the
// break and nothing else fails, and so does one that sounds the pickup somewhere
// in the cut before it.
//
// The cut runs for sixteen hits before the break, and the drill's own cue has been
// sounding the whole way — a different name, so it never enters this reading. What
// is required of `ore-pickup` is that it sounded within a frame of the break and
// at no point before it.
//
// One ore cell is posed in an otherwise empty mine, so the unit banked is that
// cell's and the bay's count says the bank happened. The miner's travel is held so
// it cuts the cell it was posed over rather than sinking through it.

import { afterEach, beforeEach, it } from "vitest";
import { CUES, PLAYABLE_COL_MIN } from "../../src/constants";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureReplay,
  createHarness,
  driveCut,
  layFloor,
  layOre,
  openScene,
  pinMiner,
  standOn,
  type Harness,
} from "../harness";
import { playsIn, watchAudio } from "./cues";

/** A coreshell row, so the cut is long and the break is unmistakably its end. */
const ROW = 450;
const COL = PLAYABLE_COL_MIN + 8;
const ORE = "cindrite" as const;

/** Frames either side of the break the cue may land on. */
const SLACK = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sounds the ore-pickup cue on the frame the ore is banked", async () => {
  openScene(h);
  layFloor(h, ROW);
  layOre(h, COL, ROW, ORE);
  standOn(h, COL, ROW);
  pinMiner(h);

  const log = watchAudio(h);
  const opened = h.frame();
  const banked = await captureReplay(h, "pickup", async () => {
    const cut = await driveCut(h, "down", { col: COL, row: ROW });
    const broke = h.frame();
    await h.advance(SLACK);
    return { cut, broke, snapshot: h.snapshot() };
  });

  const atBreak = playsIn(log, CUES.orePickup, {
    from: banked.broke - SLACK - 1,
    to: banked.broke + SLACK,
  });
  const before = playsIn(log, CUES.orePickup, {
    from: opened,
    to: banked.broke - SLACK - 1,
  });

  assertEqual(banked.cut.broke, true, "specs/mining.md");
  assertEqual(banked.snapshot.cargo.ore[ORE], 1, "specs/mining.md");
  assertGreaterThan(atBreak.length, 0, "specs/assets.md");
  assertEqual(before.length, 0, "specs/assets.md");
});
