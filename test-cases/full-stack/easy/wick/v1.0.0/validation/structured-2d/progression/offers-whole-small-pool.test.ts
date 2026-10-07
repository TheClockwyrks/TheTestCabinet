// Wick — progression/offers-whole-small-pool: a pool smaller than
// `OFFER_COUNT` is offered whole.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/progression.md`, "The draw":
// "every candidate in a pool smaller than `OFFER_COUNT` is offered", with
// `OFFER_COUNT` (`3`). The pool rules of "The candidate pool" decide which
// candidates those are.
//
// THE POSE. An isolated `playing` run with every slot of both kinds filled and
// every held item at its maximum but two: Taper one level below
// `MAX_WEAPON_LEVEL`, and Brass one level below its own max of `3`. Both slot
// kinds being full removes every new item, and every other held item standing
// at its max removes every other `+1 level` offer, so the pool is exactly the
// two. A build that pads a short pool, repeats a candidate, or falls back to
// lamp oil rather than offering what it has fails here.
//
// THE TOLERANCE. Exact: two lists of ids compared as sets of the same size.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import { MAX_WEAPON_LEVEL, PASSIVES, type OfferId } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";
import { fillPassives, fillWeapons } from "./loadout";

/** The only two items the pose leaves below a maximum. */
const POOL: OfferId[] = ["taper", "brass"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("offers both candidates of a two-item pool and nothing else", async () => {
  isolate(h);
  fillWeapons(h, { taper: MAX_WEAPON_LEVEL - 1 });
  fillPassives(h, { brass: PASSIVES.brass.maxLevel - 1 });

  const overlay = await openLevelUp(h, 1);
  await h.frameDraw();
  captureStill(h, "small");

  assertEqual(overlay.screen, "levelup", "screen after the opening tick");
  assertDeepEqual(
    overlay.run.pool,
    POOL,
    "run.pool with two items left below a maximum (specs/progression.md)",
  );
  assertLength(
    overlay.run.offers,
    POOL.length,
    "run.offers over a pool of two (specs/progression.md, The draw)",
  );
  assertDeepEqual(
    [...overlay.run.offers].sort(),
    [...POOL].sort(),
    "the ids offered over a pool of two",
  );
});
