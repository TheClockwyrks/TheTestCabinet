// economy/selling-is-the-only-source — only the Ore Market pays.
//
// `specs/gameplay.md` fixes one source and four sinks, and names the source:
// "Selling is the only source of Credits." So this point drives the four things
// a player does that most plausibly look like income — drilling an ore cell out
// of the rock, refuelling, using a field supply, and dying — and reads the
// balance after each, then sells and reads it rise. Every non-sale reading is
// held at or below the one before it, so a build that pays for a cut or refunds
// a death is caught on the action that paid.
//
// What a sale is WORTH is `cargo/sell-values`; what this point decides is that
// the sale is the only thing that moves the balance upward at all.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import { NANOBOT_HULL } from "../constants";
import {
  captureReplay,
  createHarness,
  driveCut,
  openScene,
  pinMiner,
  standOn,
  type Harness,
} from "../harness";

/** The cell the ore is posed in, and the cell the miner stands on to cut it. */
const ORE_COL = 8;
const ORE_ROW = 12;

/** The balance every step below is measured against. */
const CREDITS = 1000;

/** A part-empty tank and hull, so the depot and the nanobots both do something. */
const FUEL_BEFORE = 40;
const HULL_BEFORE = 40;

/**
 * Game time the death is given to reach the Game Over screen, and the frames it
 * is run in.
 *
 * `specs/modes.md` fixes that a death ends the expedition at the Game Over
 * screen and fixes nothing about how long whatever a build plays on the way
 * takes, so the check gives it a generous bounded span rather than reading the
 * next frame. Ten seconds of game time in a hundred frames: every rate is
 * integrated against the frame's delta, so the coarser division reaches the same
 * state as ten thousand frames would.
 */
const DEATH_SECONDS = 10;
const DEATH_FRAMES = 100;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves the balance up at the Ore Market and nowhere else", async () => {
  await openScene(h);
  await pinMiner(h);
  await h.debug.setOreTile(ORE_COL, ORE_ROW, "ferron");
  await standOn(h, ORE_COL, ORE_ROW);
  await h.debug.setCredits(CREDITS);
  await h.debug.setFuel(FUEL_BEFORE);
  await h.debug.setHull(HULL_BEFORE);
  await h.debug.setItemCount("nanobots", 1);

  const balances = await captureReplay(h, "balance", async () => {
    const seen: { what: string; credits: number }[] = [];

    // Mining. The cell breaks and banks its unit; the balance must not move.
    const cut = await driveCut(h, "down", { col: ORE_COL, row: ORE_ROW });
    assertEqual(cut.broke, true, "specs/mining.md");
    seen.push({ what: "a cut", credits: cut.snapshot.credits });

    // Refuelling. A sink, so the balance falls.
    await h.debug.setPanel("fuel-depot");
    await h.debug.buyFuel();
    seen.push({ what: "a refuel", credits: (await h.snapshot()).credits });

    // Using a field supply. Neither a source nor a sink.
    await h.debug.setPanel("inventory");
    await h.debug.useItem("nanobots");
    seen.push({ what: "an item use", credits: (await h.snapshot()).credits });

    // The sale, the one action that pays.
    await h.debug.setPanel("ore-market");
    await h.debug.sell();
    const sold = await h.snapshot();

    // And a death, which banks nothing back.
    await h.debug.setPanel(null);
    await h.debug.setHull(0);
    await h.advanceSeconds(DEATH_SECONDS, DEATH_FRAMES);
    const dead = await h.snapshot();
    return { seen, sold, dead };
  });

  // Nothing but the sale ever raised the balance.
  let previous = CREDITS;
  for (const step of balances.seen) {
    assertLessThanOrEqual(
      step.credits,
      previous,
      `specs/gameplay.md, the balance after ${step.what}`,
    );
    previous = step.credits;
  }

  // The cut banked its unit without paying for it, and the item was consumed,
  // so the two readings above really were of the actions they name.
  assertGreaterThan(
    balances.sold.credits,
    previous,
    "specs/gameplay.md, the Ore Market is the source",
  );
  assertEqual(
    balances.dead.credits,
    balances.sold.credits,
    "specs/gameplay.md",
  );
  assertEqual(balances.dead.screen, "game-over", "specs/modes.md");
  assertEqual(
    balances.sold.miner.hull,
    HULL_BEFORE + NANOBOT_HULL,
    "specs/items.md",
  );
});
