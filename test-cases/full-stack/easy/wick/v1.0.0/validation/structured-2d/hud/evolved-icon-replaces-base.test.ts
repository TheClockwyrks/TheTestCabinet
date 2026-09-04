// hud/evolved-icon-replaces-base — an evolved weapon's slot draws the evolved
// weapon's icon, not the base weapon's.
//
// THE REQUIREMENT. `specs/evolutions.md` — "What an evolution is": "On the HUD
// the slot shows the evolved weapon's icon in place of the base weapon's." The
// icons themselves are two of the produced files `specs/assets.md` lists.
//
// THE DRIVE, AND WHY IT IS THE REAL EVOLUTION. `specs/evolutions.md` — "The
// recipe": a base weapon evolves when "it is held at `MAX_WEAPON_LEVEL` (`8`)",
// "the passive its recipe names is held, at any level", and "the player opens a
// chest"; the recipe table gives Taper's evolution as Pyre, through Wick. So the
// scenario holds Taper at `8` and Wick at `1` and collects a chest, which is the
// path a run reaches this state by, and the evolution rule replaces Taper with
// Pyre "in the same slot". Nothing here poses Pyre into the slot: what this
// point is about is the slot the game itself evolved.
//
// WHY THE OVERLAY IS CLOSED FIRST. A collected chest opens the `chest` overlay
// (`specs/progression.md`), and the HUD this point is about is the `playing`
// screen's. `setScreen("playing")` from `chest` sets `screen` alone, leaving
// `chestResult` standing (`specs/instrumentation.md`), which is the way a
// player leaves it.
//
// HOW THE SLOT IS READ. `specs/assets.md` produces one icon file per weapon, so
// the two icons are told apart by the PRODUCED FILE each blit's bytes came from,
// never by a colour or a coordinate. One weapon is held, so the frame's only
// weapon icon is that slot's: it must be Pyre's, and Taper's must be nowhere on
// the frame.

import { afterEach, beforeEach, it } from "vitest";
import { MAX_WEAPON_LEVEL } from "../constants";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertLength,
} from "../assert";
import {
  captureStill,
  createHarness,
  holdPassive,
  holdWeapon,
  isolate,
  openChest,
  poseScreen,
  type Harness,
} from "../harness";
import { iconBlits } from "./slots";

/** Taper's recipe: the base weapon, the passive it needs, and what it becomes. */
const BASE = "taper";
const PASSIVE = "wick";
const EVOLVED = "pyre";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws the evolved weapon's icon in the slot its base held", async () => {
  isolate(h);
  const slot = holdWeapon(h, BASE, MAX_WEAPON_LEVEL);
  assertEqual(slot, 0, `the slot ${BASE} took`);
  holdPassive(h, PASSIVE, 1);

  const opened = await openChest(h);
  assertEqual(opened.screen, "chest", "the screen the collected chest opened");
  assertDeepEqual(
    opened.run.chestResult,
    { kind: "evolve", weapon: EVOLVED },
    "the result the chest reported",
  );

  const playing = poseScreen(h, "playing");
  assertEqual(playing.screen, "playing", "the screen the closed overlay left");
  assertDeepEqual(
    playing.run.weapons.map((weapon) => weapon.id),
    [EVOLVED],
    "the weapons the run holds after the evolution",
  );

  const blits = await h.frameBlits();
  captureStill(h, "icon");

  assertLength(
    iconBlits(blits, BASE),
    0,
    `blits of ${BASE}'s icon after it evolved`,
  );
  assertGreaterThan(
    iconBlits(blits, EVOLVED).length,
    0,
    `blits of ${EVOLVED}'s icon in the slot`,
  );
});
