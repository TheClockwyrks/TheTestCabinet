// pickups/draft-attracts-all — a draft attracts every gem on the field,
// whatever its distance.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Pickups") tables the draft's
// effect, "Every gem on the field becomes attracted", and ("Attraction and
// flight") repeats it: "A draft attracts every gem on the field at once, as the
// pickups section below states." The rule names no distance, so the reading is
// taken at three that straddle every distance the game itself uses: `NEAR`
// (500), `MID` (1500), and `DISTANT` (3000) units, each far outside
// `PICKUP_RADIUS` (48), the last more than twice the 1280-unit width of the
// view. The draft is collected under specs/world.md ("Collection"), a distance
// "less than `PICKUP_ITEM_RADIUS` (`16`) plus `PLAYER_RADIUS`", which it meets
// at the lamplighter's own center.
//
// THE WORLD. An isolated `playing` run: nothing alive, nothing else on the
// ground, no weapon and no passive held, every driver switch off, so nothing
// else can attract a gem. No Lure is held, so `pickupRadius` is the base 48 and
// all three gems lie far outside it: each reads `attracted` false before the
// tick, and any that reads true after it was attracted by the draft rather than
// by the radius rule. The three lie along three different directions, so none
// can be mistaken for another.
//
// WHAT IS READ. All three gems' `attracted` after the single tick that
// collected the draft, each true, with the draft gone from the field.
//
// TOLERANCE. None: `attracted` is a boolean, and the nearest gem is ten times
// `pickupRadius` from the lamplighter.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { PICKUP_RADIUS } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  spawnGemAt,
  spawnPickupAt,
  type Harness,
  type Point,
} from "../harness";
import { gemOf } from "./night";

/** Where the three gems lie, each far outside PICKUP_RADIUS (48). */
const NEAR = 500;
const MID = 1500;
const DISTANT = 3000;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("attracts gems 500, 1500, and 3000 units out on the tick a draft is collected", async () => {
  const posed = isolate(h);
  assertLength(posed.run.passives, 0, "passives held, so no Lure");
  const { player } = posed.run;
  const at: readonly Point[] = [
    { x: player.x + NEAR, y: player.y },
    { x: player.x, y: player.y + MID },
    { x: player.x - DISTANT, y: player.y },
  ];
  const gems = at.map((point) => spawnGemAt(h, "small", point.x, point.y));
  spawnPickupAt(h, "draft", player.x, player.y);
  const placed = h.snapshot();
  for (const gem of gems) {
    assertEqual(
      gemOf(placed, gem).attracted,
      false,
      `the attracted flag of a gem outside ${PICKUP_RADIUS} before the draft`,
    );
  }

  const after = await h.tick(1);
  captureStill(h, "draft");

  assertLength(after.run.pickups, 0, "pickups left after the collecting tick");
  gems.forEach((gem, index) => {
    assertEqual(
      gemOf(after, gem).attracted,
      true,
      `the attracted flag of the gem ${[NEAR, MID, DISTANT][index]} units out after the draft`,
    );
  });
});
