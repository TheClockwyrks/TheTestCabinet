// movement/state-is-fuel-out — a dry miner below the surface reads `fuel-out`.
//
// `specs/character.md`'s animation-state table: `fuel-out` is "Below the surface
// with fuel at `0`", and the file's precedence list puts it above `jetpack`,
// `fall`, `walk` and `idle`, so a miner standing on solid rock underground with
// an empty tank is in that state rather than in `idle`.
//
// ONE STATE PER POINT. `assets/miner-state-changes-the-frame` reads the five
// states ordinary play walks through; a stranded miner is not one of them, so
// without this point a build that never reaches `fuel-out` keeps every mark.
//
// THE TANK IS EMPTIED, NOT THE STATE POSED. `specs/instrumentation.md`'s
// `setFuel` sets the fuel the miner holds, which is the precondition the rule is
// written over, and the state that follows is the build's own.
//
// ISOLATION. A floor deep in the mine and a miner standing on it, with the drill
// gated and no key held, so `drill-down`, `drill-side`, `hurt` and `jetpack` —
// every state the precedence list puts above `fuel-out` — are all out of reach.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  layFloor,
  openScene,
  pinDrill,
  standOn,
  type Harness,
} from "../harness";

/** Well below `SURFACE_Y`, so the miner is unambiguously underground. */
const ROW = 200;
const COL = 12;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reads fuel-out while the miner stands underground with an empty tank", async () => {
  openScene(h);
  layFloor(h, ROW);
  standOn(h, COL, ROW, "east");
  pinDrill(h);

  h.debug.setFuel(0);
  await h.advance(2);
  captureStill(h, "stranded");

  assertEqual(
    h.snapshot().miner.state,
    "fuel-out",
    "specs/character.md: the state of a miner below the surface with fuel at 0",
  );
});
