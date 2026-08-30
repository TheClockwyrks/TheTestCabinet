// audio/material-chime-cue — banking a material sounds its own chime, not the ore cue.
//
// `specs/assets.md`: the `material-chime` cue plays when a material is banked, and
// is richer than the ore pickup. `specs/mining.md` fixes when that is — the drill
// breaks a material node and the material goes into the satchel — so the reading is
// taken on the frame the node broke, and the satchel's count says the bank
// happened.
//
// WHICH CUE IT WAS IS READABLE HERE. The engine announces a play by the name the
// game asked for (`engine/audio.md`), and `src/constants.ts` gives `material-chime`
// and `ore-pickup` two names, so "its own chime" is decided rather than left to the
// reviewer's ear: the chime must sound at the break and the ore pickup must not. A
// build that plays the ore cue at a material node fails here.
//
// Whether the chime is RICHER than the pickup is not readable from the bus — the
// engine reports the name, the frame and the gain, and richness is the waveform's
// — so that half stays the reviewer's, off the produced files.

import { afterEach, beforeEach, it } from "vitest";
import { CUES, PLAYABLE_COL_MIN } from "../../src/constants";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureReplay,
  createHarness,
  driveCut,
  layFloor,
  layMaterial,
  openScene,
  pinMiner,
  standOn,
  type Harness,
} from "../harness";
import { playsIn, watchAudio } from "./cues";

/** A rockbed row, the band `specs/world.md` puts the Resonite node in. */
const ROW = 200;
const COL = PLAYABLE_COL_MIN + 8;
const MATERIAL = "resonite" as const;

/** Frames either side of the break the cue may land on. */
const SLACK = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sounds the material chime on the frame the material is banked", async () => {
  openScene(h);
  layFloor(h, ROW);
  layMaterial(h, COL, ROW, MATERIAL);
  standOn(h, COL, ROW);
  pinMiner(h);

  const log = watchAudio(h);
  const opened = h.frame();
  const banked = await captureReplay(h, "chime", async () => {
    const cut = await driveCut(h, "down", { col: COL, row: ROW });
    const broke = h.frame();
    await h.advance(SLACK);
    return { cut, broke, snapshot: h.snapshot() };
  });

  const around = { from: banked.broke - SLACK - 1, to: banked.broke + SLACK };
  const chimed = playsIn(log, CUES.materialChime, around);
  const beforeChime = playsIn(log, CUES.materialChime, {
    from: opened,
    to: around.from,
  });
  const pickup = playsIn(log, CUES.orePickup, { from: opened, to: around.to });

  assertEqual(banked.cut.broke, true, "specs/mining.md");
  assertEqual(banked.snapshot.satchel[MATERIAL], 1, "specs/mining.md");
  assertGreaterThan(chimed.length, 0, "specs/assets.md");
  assertEqual(beforeChime.length, 0, "specs/assets.md");
  assertEqual(pickup.length, 0, "specs/assets.md");
});
