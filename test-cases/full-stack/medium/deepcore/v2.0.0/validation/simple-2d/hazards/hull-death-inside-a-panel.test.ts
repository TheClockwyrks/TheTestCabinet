// hazards/hull-death-inside-a-panel — a panel does not suspend the empty-hull
// check.
//
// `specs/character.md`: "An empty hull is never a state the expedition continues
// from, and no open panel or overlay suspends the check: a hull emptied by a
// field supply used from the inventory ends the expedition exactly as one
// emptied in the mine does." `specs/modes.md` adds what follows from that: "A
// death takes effect the moment its cause holds and cannot be undone. Play does
// not resume from it."
//
// So the scenario is the one the specification names. The inventory overlay is
// open, and what empties the hull is a charge used from inside it: Dynamite
// clears the `3x3` block centred on the miner's cell, a gas pocket in that block
// detonates, and the miner stands at the centre of the blast with a hull the
// detonation is bigger than.
//
// The Regenerative Nanobots are then used, after the hull has already stood at
// `0` for a frame. They repair `NANOBOT_HULL`, which is more than the hull that
// was posed, so a build that had not yet taken the death would be carried back
// into live play by them. The expedition must end all the same.
//
// Both faculties are held off: the detonation shoves the miner away and opens
// the ground under it, and nothing here is about where it ends up or about its
// drill.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import { NANOBOT_HULL } from "../../src/constants";
import {
  captureReplay,
  createHarness,
  fillBlock,
  openScene,
  pinDrill,
  pinMiner,
  standOn,
  type Harness,
} from "../harness";
import { bandRow, fractionOf, gasDamageAt, HAZARD_COL } from "./scene";

/** The hull the charge has to get through: less than the blast, less than a repair. */
const THIN_HULL = 15;

/** How far out from the miner's cell the pocket's surroundings are laid solid. */
const PAD = 2;

/** Repairs attempted after the hull stood at zero. */
const REPAIRS = 3;

/**
 * Game time the death is given to reach the Game Over screen, and the frames it
 * is run in.
 *
 * `specs/modes.md` fixes that a death ends the expedition at the Game Over
 * screen and fixes nothing about how long whatever a build plays on the way
 * takes, so the check gives it a generous bounded span.
 */
const DEATH_SECONDS = 15;
const DEATH_FRAMES = 150;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("ends the expedition when a supply used from the inventory empties the hull", async () => {
  openScene(h);
  pinMiner(h);
  pinDrill(h);

  const row = bandRow(h.snapshot(), "rockbed");
  fillBlock(
    h,
    {
      fromCol: HAZARD_COL - PAD,
      toCol: HAZARD_COL + PAD,
      fromRow: row - PAD,
      toRow: row + PAD,
    },
    "rock",
  );
  h.debug.setTile(HAZARD_COL, row, "tunnel");
  standOn(h, HAZARD_COL, row + 1);
  h.debug.setTile(HAZARD_COL + 1, row, "gas");

  h.debug.setHull(THIN_HULL);
  h.debug.setItemCount("dynamite", 1);
  h.debug.setItemCount("nanobots", REPAIRS);
  h.debug.setPanel("inventory");
  await h.advance(1);
  const armed = h.snapshot();

  const run = await captureReplay(h, "death", async () => {
    h.debug.useItem("dynamite");
    await h.advance(1);
    const struck = h.snapshot();

    // The hull has already stood at zero for a frame. Repairing it now is the
    // thing `specs/modes.md` says cannot put the expedition back.
    for (let i = 0; i < REPAIRS; i += 1) h.debug.useItem("nanobots");
    await h.advanceSeconds(DEATH_SECONDS, DEATH_FRAMES);
    return { struck, ended: h.snapshot() };
  });

  assertEqual(armed.panel, "inventory", "the overlay is open before the charge");
  assertGreaterThan(
    gasDamageAt(fractionOf(armed, row)),
    THIN_HULL,
    "specs/hazards.md, the detonation is bigger than the hull posed",
  );
  assertGreaterThan(
    NANOBOT_HULL,
    THIN_HULL,
    "specs/items.md, a repair is bigger than the hull posed",
  );
  assertLessThanOrEqual(
    run.struck.miner.hull,
    0,
    "specs/character.md, the charge emptied the hull with the overlay open",
  );
  assertEqual(run.ended.screen, "game-over", "specs/modes.md");
  assertEqual(run.ended.summary?.deathCause, "hull-destroyed", "specs/modes.md");
});
