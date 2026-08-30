// audio/material-chime-cue — banking a material sounds on the frame it is banked.
//
// `specs/assets.md`: the `material-chime` cue plays when a material is banked, and
// is richer than the ore pickup. `specs/mining.md` fixes when that is — the drill
// breaks a material node and the material goes into the satchel — so the reading
// is taken on the frame the node broke, and the satchel's count says the bank
// happened.
//
// WHICH CUE IT WAS IS NOT OBSERVABLE HERE. `audio-init.js` watches the two doors a
// browser emits sound through and counts what goes through them; an engineless
// build has no cue bus to name what it played. So a build that plays the ore
// pickup at a material node passes this point and is caught by the reviewer's ear.
// What is decided here is that banking a material sounds at all, and sounds on the
// frame it was banked rather than somewhere in the cut before it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { PLAYABLE_COL_MIN } from "../constants";
import {
  captureReplay,
  createHarness,
  driveCut,
  layFloor,
  layMaterial,
  openScene,
  pinMiner,
  standOn,
  watchCues,
  type Harness,
} from "../harness";
import { armAudio } from "./probe";

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

afterEach(async () => {
  await h.dispose();
});

it("sounds on the frame the material is banked", async () => {
  const armed = await armAudio(h);
  await openScene(h);
  await layFloor(h, ROW);
  await layMaterial(h, COL, ROW, MATERIAL);
  await standOn(h, COL, ROW);
  await pinMiner(h);

  const cues = watchCues(h);
  const banked = await captureReplay(h, "chime", async () => {
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
  assertEqual(banked.snapshot.satchel[MATERIAL], 1, "specs/mining.md");
  assertGreaterThan(atBreak.length, 0, "specs/assets.md");
  assertEqual(justBefore.length, 0, "specs/assets.md");
});
