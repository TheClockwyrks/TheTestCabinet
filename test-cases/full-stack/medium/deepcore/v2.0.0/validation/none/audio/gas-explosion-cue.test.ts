// audio/gas-explosion-cue — a detonating pocket sounds, drilled or blasted.
//
// `specs/assets.md`: the `gas-explosion` cue plays when a gas pocket detonates.
// `specs/hazards.md` gives the two ways one detonates — the drill takes its last
// point of health, or an explosives blast catches it — and states that a
// detonation triggered by a blast is resolved exactly as a drilled one. So both
// are driven, over the same posed pocket, and both must sound.
//
// The pockets are posed in the topsoil, where `specs/hazards.md`'s depth curve
// puts the damage at its `GAS_DAMAGE_MIN` (`60`) floor, and the hull tier is
// raised, so the miner survives two detonations and neither reading is cut short
// by a death. The miner's travel is held so the blasts move it nowhere and the
// second pose is the one it was given.
//
// The blast half is counted through the page's own running total rather than by
// frame, because `useItem` is a control that runs BETWEEN frames and a sound it
// emits falls outside every frame's bracket.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { HULL_MAX, PLAYABLE_COL_MIN } from "../constants";
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
  watchCues,
  type Harness,
} from "../harness";
import { armAudio, countSounds } from "./probe";

/** A topsoil row, where a detonation costs the least hull `specs/hazards.md` states. */
const ROW = 20;
const COL = PLAYABLE_COL_MIN + 8;

/** Frames either side of the break the drilled cue may land on. */
const SLACK = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds when a pocket is drilled through and when one is blasted", async () => {
  const armed = await armAudio(h);
  await openScene(h);
  // The tier raises the maximum; `setTier` leaves the value where it stood, so
  // the hull is filled to the new maximum too. Two detonations at the topsoil
  // floor cost `120` hull, which a tier-1 hull of `100` does not survive.
  await stageTiers(h, { hull: 5 });
  await h.debug.setHull(HULL_MAX[4]);
  await layFloor(h, ROW);
  await standOn(h, COL, ROW);
  await pinMiner(h);
  await h.debug.setTile(COL, ROW, "gas");

  const cues = watchCues(h);
  const heard = await captureReplay(h, "blast", async () => {
    const cut = await driveCut(h, "down", { col: COL, row: ROW });
    const broke = h.frame();
    await h.advance(SLACK);
    const drilled = cues.filter(
      (cue) => Math.abs(cue.frame - broke) <= SLACK,
    ).length;

    // And again, this time caught in a charge. The pocket sits beside the miner's
    // own cell, inside Dynamite's radius of one.
    await h.debug.setTile(COL + 1, ROW - 1, "gas");
    await stageItems(h, { dynamite: 1 });
    const blasted = await countSounds(h, async () => {
      await h.debug.useItem("dynamite");
      await h.advance(2);
    });

    return { cut, drilled, blasted, snapshot: await h.snapshot() };
  });

  assertEqual(armed, true, "specs/assets.md");
  assertEqual(heard.cut.broke, true, "specs/hazards.md");
  assertEqual(
    (await h.tileAt(COL + 1, ROW - 1)).kind,
    "tunnel",
    "specs/items.md",
  );
  assertGreaterThan(heard.snapshot.miner.hull, 0, "specs/hazards.md");
  assertGreaterThan(heard.drilled, 0, "specs/assets.md");
  assertGreaterThan(heard.blasted, 0, "specs/assets.md");
});
