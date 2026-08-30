// audio/ore-pickup-cue — banking ore sounds on the frame it is banked.
//
// `specs/assets.md`: the `ore-pickup` cue plays when an ore or gemstone is banked.
// `specs/mining.md` fixes when that is — the drill breaks an ore cell and one unit
// goes into the bay — so the reading is taken on the frame the cell broke.
//
// The cut runs for sixteen hits before that frame, and the drill's own cue has
// been running the whole way, so what separates the two is WHEN: the frames just
// before the break must be silent and the breaking frame must not be. A build that
// re-triggers its drill cue on every hit still passes, because a hit lands every
// `DRILL_HIT_INTERVAL` (`0.125`) seconds and the frames sampled either side of the
// break are a hundredth of that apart.
//
// One ore cell is posed in an otherwise empty mine, so the unit banked is that
// cell's and the bay's count says the bank happened. The miner's travel is held so
// it cuts the cell it was posed over rather than sinking through it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { PLAYABLE_COL_MIN } from "../constants";
import {
  captureReplay,
  createHarness,
  driveCut,
  layFloor,
  layOre,
  openScene,
  pinMiner,
  standOn,
  watchCues,
  type Harness,
} from "../harness";
import { armAudio } from "./probe";

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

afterEach(async () => {
  await h.dispose();
});

it("sounds on the frame the ore is banked", async () => {
  const armed = await armAudio(h);
  await openScene(h);
  await layFloor(h, ROW);
  await layOre(h, COL, ROW, ORE);
  await standOn(h, COL, ROW);
  await pinMiner(h);

  const cues = watchCues(h);
  const banked = await captureReplay(h, "pickup", async () => {
    const cut = await driveCut(h, "down", { col: COL, row: ROW });
    const broke = h.frame();
    await h.advance(SLACK);
    return { cut, broke, cues: [...cues], snapshot: await h.snapshot() };
  });

  const atBreak = banked.cues.filter(
    (cue) => Math.abs(cue.frame - banked.broke) <= SLACK,
  );
  const justBefore = banked.cues.filter(
    (cue) => cue.frame > banked.broke - 6 && cue.frame < banked.broke - SLACK,
  );

  assertEqual(armed, true, "specs/assets.md");
  assertEqual(banked.cut.broke, true, "specs/mining.md");
  assertEqual(banked.snapshot.cargo.ore[ORE], 1, "specs/mining.md");
  assertGreaterThan(atBreak.length, 0, "specs/assets.md");
  assertEqual(justBefore.length, 0, "specs/assets.md");
});
