// campaign/run-opens — a run opens on its first build phase, at the opening allocation.
//
// specs/campaign.md: "A run begins with a map and a difficulty chosen from the
// menus. It then opens on its first build phase, with `START_CHARGE` Charge,
// `START_INTEGRITY` Grid Integrity, refinement at `R0`, an empty yard, and the
// wave counter at `0`." specs/economy.md fixes the two figures at `10` and `20`,
// and specs/scrap-press.md refreshes the stamp allowance to
// `STAMPS_PER_LEVEL` (`5`) at the start of every build phase, the first one
// included.
//
// The run is entered through `startRun`, which specs/instrumentation.md fixes as
// taking "the same path confirming the difficulty select takes" and giving the
// run "the opening allocation `specs/campaign.md` states and nothing more". It
// is entered that way rather than by pressing through the menus, because a build
// with a broken map select and a correct opening must fail the menu checks and
// pass this one.
//
// Nothing is posed over the top of it: no Charge is set, no wave is set and the
// yard is not emptied, so every figure read here is the one the run opened with.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  difficultyById,
  STAMPS_PER_LEVEL,
  START_CHARGE,
  START_INTEGRITY,
} from "../constants";
import { captureStill, createHarness, type Harness, openRun } from "../harness";

const DIFFICULTY = "medium";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("opens the playing screen in a build phase at the opening allocation", async () => {
  openRun(h, { difficulty: DIFFICULTY });

  await h.advance(1);
  captureStill(h, "opening");

  const s = h.snapshot();
  assertEqual(s.screen, "playing", "a run opens on the yard");
  assertEqual(s.phase, "build", "a run opens on its first build phase");
  assertEqual(s.charge, START_CHARGE, "START_CHARGE");
  assertEqual(s.integrity, START_INTEGRITY, "START_INTEGRITY");
  assertEqual(s.refinement, 0, "refinement opens at R0");
  assertEqual(s.wave, 0, "the wave counter before wave 1");
  assertEqual(
    s.totalWaves,
    difficultyById(DIFFICULTY).waves,
    `the wave count ${DIFFICULTY} runs`,
  );
  assertEqual(s.stampsLeft, STAMPS_PER_LEVEL, "the level's stamp allowance");
  assertLength(s.structures, 0, "an empty yard");
  assertLength(s.units, 0, "the Load waits");
  assertEqual(s.waveActive, false, "no wave is running");
});
