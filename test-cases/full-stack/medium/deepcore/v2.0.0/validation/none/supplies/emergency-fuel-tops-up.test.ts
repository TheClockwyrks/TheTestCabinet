// Deepcore — supplies/emergency-fuel-tops-up: emergency fuel adds a fixed amount,
// and never more than the tank holds.
//
// `specs/items.md`: Emergency Fuel "Adds `EMERGENCY_FUEL` (`30`) fuel, capped at
// the maximum." Two uses decide the one requirement in one direction: one from a
// tank far enough below the maximum for the whole of it to fit, which must add
// exactly `EMERGENCY_FUEL`, and one from a tank within `EMERGENCY_FUEL` of the
// maximum, which must stop at the maximum rather than overfilling.
//
// The scene is the camp with nothing held on the keyboard, which is where nothing
// else touches the tank: `specs/character.md` charges life support only below the
// ground line, thrust and drift only while a key is held, and drilling only per
// hit — and the drill is gated off besides. Each reading is taken on the call
// itself, with no frame between the pose and the use.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { EMERGENCY_FUEL } from "../constants";
import {
  captureStill,
  createHarness,
  standAtCamp,
  type Harness,
} from "../harness";
import { openCampScene } from "./blast-scene";

/** Comfortably more than `EMERGENCY_FUEL` short of the maximum. */
const DEEP_DRAIN = 2 * EMERGENCY_FUEL;

/** Inside `EMERGENCY_FUEL` of the maximum, so the top-up has to be capped. */
const LIGHT_DRAIN = EMERGENCY_FUEL / 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("adds EMERGENCY_FUEL and stops at the maximum", async () => {
  await openCampScene(h);
  await standAtCamp(h);
  await h.debug.setItemCount("emergency-fuel", 2);

  const { miner } = await h.snapshot();
  const maxFuel = miner.maxFuel;

  await h.debug.setFuel(maxFuel - DEEP_DRAIN);
  await h.debug.useItem("emergency-fuel");
  const topped = await h.snapshot();

  await h.debug.setFuel(maxFuel - LIGHT_DRAIN);
  await h.debug.useItem("emergency-fuel");
  const capped = await h.snapshot();

  await h.advance(2);
  await captureStill(h, "field-fuel");

  assertEqual(
    topped.miner.fuel,
    maxFuel - DEEP_DRAIN + EMERGENCY_FUEL,
    "the tank after a top-up with room for the whole of it",
  );
  assertEqual(
    capped.miner.fuel,
    maxFuel,
    "the tank after a top-up inside EMERGENCY_FUEL of the maximum",
  );
});
