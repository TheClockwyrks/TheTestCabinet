// screens/pause-restart — RESTART begins a fresh run on the same map and
// difficulty.
//
// THE REQUIREMENT. `specs/ui.md`, of `paused`: "`RESTART` begins a fresh run on
// the same map at the same difficulty." `specs/campaign.md` says what a fresh run
// is, exactly: it "opens on its first build phase, with `START_CHARGE` Charge,
// `START_INTEGRITY` Grid Integrity, refinement at `R0`, an empty yard, and the
// wave counter at `0`." Two halves, and both are the point: what is kept is the
// map and the difficulty, and what is thrown away is everything the run had done.
//
// HOW IT IS DECIDED. A run is posed deep into a campaign and far from every
// opening value — on a map and at a difficulty that are not the ones a reset
// leaves behind, seven waves in, with a hoard of Charge, Grid Integrity nearly
// gone, the press refined and structures standing — so that no field can pass by
// having been left alone. The pause menu is opened directly and `RESTART` is found
// by the action it carries and pressed at the centre of the rectangle the build
// itself reported for it. Every one of the opening values is then read, along with
// the two that must have survived.

import { afterEach, beforeEach, it } from "vitest";

import { START_CHARGE, START_INTEGRITY } from "../../src/constants";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  openYard,
  pressMenu,
  standBlocker,
  standComponent,
  type Harness,
} from "../harness";

/** The run that is thrown away: nothing here is an opening value. */
const POSED = {
  map: "switchyard",
  difficulty: "hard",
  wave: 7,
  charge: 900,
  integrity: 3,
  refinement: 5,
} as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("throws the run away and keeps the map and the difficulty", async () => {
  openYard(h, POSED);
  standComponent(h, "capacitor", 4, 10, 0);
  standBlocker(h, 13, 0);

  h.debug.setScreen("paused");
  await pressMenu(h, "restart");
  captureStill(h, "restart");

  const fresh = h.snapshot();
  assertEqual(
    fresh.screen,
    "playing",
    "the screen RESTART begins the fresh run on (specs/ui.md)",
  );
  assertEqual(
    fresh.phase,
    "build",
    "the phase a fresh run opens on (specs/campaign.md)",
  );

  // Kept: the map and the difficulty.
  assertEqual(
    fresh.map,
    POSED.map,
    "the map a restart replays on, which is the same one (specs/ui.md)",
  );
  assertEqual(
    fresh.difficulty,
    POSED.difficulty,
    "the difficulty a restart replays at, which is the same one " +
      "(specs/ui.md)",
  );

  // Thrown away: everything the run had done.
  assertEqual(
    fresh.charge,
    START_CHARGE,
    "the Charge a fresh run opens with (specs/campaign.md)",
  );
  assertEqual(
    fresh.integrity,
    START_INTEGRITY,
    "the Grid Integrity a fresh run opens with (specs/campaign.md)",
  );
  assertEqual(
    fresh.refinement,
    0,
    "the refinement level a fresh run opens at, R0 (specs/campaign.md)",
  );
  assertEqual(
    fresh.wave,
    0,
    "the wave counter of a fresh run (specs/campaign.md)",
  );
  assertLength(
    fresh.structures,
    0,
    "the structures on a fresh run's yard, which is empty " +
      "(specs/campaign.md)",
  );
  assertLength(
    fresh.units,
    0,
    "the units on a fresh run's yard, which is empty (specs/campaign.md)",
  );
});
