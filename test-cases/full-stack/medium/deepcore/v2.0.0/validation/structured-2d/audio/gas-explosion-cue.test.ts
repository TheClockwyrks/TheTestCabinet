// audio/gas-explosion-cue — a detonating pocket sounds its cue, drilled or blasted.
//
// `specs/assets.md`: the `gas-explosion` cue plays when a gas pocket detonates.
// `specs/hazards.md` gives the two ways one detonates — the drill takes its last
// point of health, or an explosives blast catches it — and states that a
// detonation triggered by a blast is resolved exactly as a drilled one. So both
// are driven, over the same posed pocket, and both must sound the cue BY NAME.
//
// The pockets are posed in the topsoil, where `specs/hazards.md`'s depth curve
// puts the damage at its `GAS_DAMAGE_MIN` (`60`) floor, and the hull tier is
// raised, so the miner survives two detonations and neither reading is cut short
// by a death. The miner's travel is held so the blasts move it nowhere and the
// second pose is the one it was given.
//
// A CONTROL RUNS BETWEEN FRAMES. `useItem` is a pose rather than a frame, so the
// cue it raises sounds on the update that follows it; the window is opened before
// the control and closed after the frames that carry it.

import { afterEach, beforeEach, it } from "vitest";
import { CUES, HULL_TIERS, PLAYABLE_COL_MIN } from "../constants";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureReplay,
  createHarness,
  driveCut,
  layFloor,
  openScene,
  pinMiner,
  stageItems,
  stageTiers,
  standOn,
  type Harness,
} from "../harness";
import { over, playsIn, watchAudio } from "./cues";

/** A topsoil row, where a detonation costs the least hull `specs/hazards.md` states. */
const ROW = 20;
const COL = PLAYABLE_COL_MIN + 8;

/** Frames either side of the break the drilled cue may land on. */
const SLACK = 1;

/** Frames driven after a control, so the update it raised a cue on runs. */
const SETTLE = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sounds the explosion cue when a pocket is drilled and when one is blasted", async () => {
  openScene(h);
  // The tier raises the maximum; `setTier` leaves the value where it stood, so
  // the hull is filled to the new maximum too. Two detonations at the topsoil
  // floor cost `120` hull, which a tier-1 hull of `100` does not survive.
  stageTiers(h, { hull: 5 });
  h.debug.setHull(HULL_TIERS[4]);
  layFloor(h, ROW);
  standOn(h, COL, ROW);
  pinMiner(h);
  h.debug.setTile(COL, ROW, "gas");

  const log = watchAudio(h);
  const heard = await captureReplay(h, "blast", async () => {
    const cut = await driveCut(h, "down", { col: COL, row: ROW });
    const broke = h.frame();
    await h.advance(SLACK);
    const drilled = playsIn(log, CUES.gasExplosion, {
      from: broke - SLACK - 1,
      to: broke + SLACK,
    });

    // And again, this time caught in a charge. The pocket sits beside the miner's
    // own cell, inside Dynamite's radius of one.
    h.debug.setTile(COL + 1, ROW - 1, "gas");
    stageItems(h, { dynamite: 1 });
    const window = await over(h, async () => {
      h.debug.useItem("dynamite");
      await h.advance(SETTLE);
    });
    const blasted = playsIn(log, CUES.gasExplosion, window);

    return { cut, drilled, blasted, snapshot: h.snapshot() };
  });

  assertEqual(heard.cut.broke, true, "specs/hazards.md");
  assertEqual(h.tileAt(COL + 1, ROW - 1).kind, "tunnel", "specs/items.md");
  assertGreaterThan(heard.snapshot.miner.hull, 0, "specs/hazards.md");
  assertGreaterThan(heard.drilled.length, 0, "specs/assets.md");
  assertGreaterThan(heard.blasted.length, 0, "specs/assets.md");
});
