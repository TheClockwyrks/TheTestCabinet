// waves/opening-phase-pays-no-interest — the transition into the opening phase
// pays no interest.
//
// `specs/economy.md` pays interest "On entering a build phase between waves", and
// says so twice: "It is paid only on entering a build phase between waves:
// entering the opening phase pays none". The opening phase is entered exactly
// once in a run, when the run starts (`specs/waves.md`: it "runs before Wave 1"),
// so the transition this point is about is the one a confirmed difficulty row
// makes — `specs/screens.md` sends it to "`playing` in the `opening` phase, on
// Containment at that difficulty".
//
// THE TRANSITION IS REACHED THROUGH THE MENUS, because that is the only way to
// reach it: `setScreen` and `setPhase` "set that field alone and run no entry
// effect. Neither ... pays interest" (`specs/instrumentation.md`), so a posed
// opening phase would answer nothing at all. `startThroughMenus` takes PLAY,
// CONTAINMENT and the difficulty row in turn, so every entry effect the run has
// runs.
//
// THE MONEY ON HAND AT THAT MOMENT IS THE DIFFICULTY'S STARTING MONEY, which
// `specs/modes.md` fixes and this check computes from the specification's own
// table rather than reading back off the build. EASY IS CHOSEN FOR ITS FIGURE:
// `350` on hand would pay `floor(0.08 * 350)` = `28` if the entry paid interest
// at all, and `28` is nothing like `350` and nothing like the `20` that
// Containment Medium's `250` would pay — so a build that pays here reads a number
// this check names exactly, and a build that pays a different rate reads a
// different one again. The figure is well under `INTEREST_CAP` (`40`), so the cap
// is no part of this reading.
//
// WHAT THIS POINT DOES NOT ASSERT. Not the phase, not the wave, not the lives:
// what a started run opens holding is `modes.run-opens-with-its-figures`'s
// requirement. The one reading here is the money, and the one claim is that the
// entry added nothing to it.
//
// WHAT EVERY WRONG MODEL READS. A build that pays interest on every phase entry
// reads `378`; one that pays a flat `INTEREST_CAP` reads `390`; one that pays the
// cap-free percentage reads `378` as well but would part company at Deep Pockets'
// balance, which is `economy.interest-capped`'s business. Each is a different
// number from `350`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { modeFigures } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { startThroughMenus } from "./run";

/** The difficulty the run is started on. */
const DIFFICULTY = "easy";

/**
 * What the run must hold the instant its opening phase is entered: the starting
 * money `specs/modes.md` gives Containment at this difficulty, and not a penny
 * more.
 *
 * There is no tolerance on it and there cannot be one — money is a whole number
 * and the specification fixes both the starting figure and the rule that the
 * entry pays nothing — so the assertion is equality.
 */
const EXPECTED = modeFigures("containment", DIFFICULTY).startMoney;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("adds nothing to the money on hand when the opening phase opens", async () => {
  await startThroughMenus(h, DIFFICULTY);

  await captureStill(h, "balance");

  const opened = await h.snapshot();
  assertEqual(
    opened.phase,
    "opening",
    "precondition: the menus reached the opening phase of a run",
  );
  assertEqual(
    opened.money,
    EXPECTED,
    `the money on hand as Containment ${DIFFICULTY}'s opening phase opened`,
  );
});
