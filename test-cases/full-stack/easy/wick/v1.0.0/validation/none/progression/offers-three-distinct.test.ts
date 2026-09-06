// progression/offers-three-distinct — an overlay offers OFFER_COUNT distinct
// candidates.
//
// WHERE THE THRESHOLD COMES FROM. specs/progression.md ("The draw"): "Offers
// per overlay | `OFFER_COUNT` | `3`", and "The overlay offers `OFFER_COUNT`
// distinct candidates drawn uniformly at random from the pool WITHOUT
// REPLACEMENT ... `offers` holds the drawn ids in the order they are listed."
// specs/instrumentation.md reports the pool the draw is made from, "so `offers`
// is a subset of it". So over any pool of at least `OFFER_COUNT` candidates the
// overlay presents exactly three ids, no id twice, and every one a candidate.
//
// WHY THE WORLD IS POSED AS IT IS. Two arrangements, each an isolated night
// with every faculty held and nothing alive. First a run with no slot held,
// over which six overlays are opened in turn, each left through
// `setScreen("playing")` so the slots stand: the pool is all twenty candidates
// and six independent draws are read rather than one, since a build that
// repeats an id does it on some draws and not others. Then a pool of exactly
// `OFFER_COUNT`, built by filling both slot kinds and leaving exactly three
// items one level under their maxima, which is the boundary where a draw
// without replacement must consume the pool whole. The overlays are reached by
// the real path, a queued level-up and the tick that opens it.
//
// THE TOLERANCE. None: a count is exact, and an id is a candidate or it is not.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEachIn,
  assertEqual,
  assertGreaterThanOrEqual,
  assertLength,
} from "../assert";
import {
  MAX_WEAPON_LEVEL,
  OFFER_COUNT,
  PASSIVES,
  type OfferId,
} from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  holdWeapon,
  isolate,
  openLevelUp,
  poseScreen,
  type Harness,
  type WickSnapshot,
} from "../harness";
import { FULL_PASSIVES, FULL_WEAPONS } from "./stage";

/** How many draws are read over the wide pool. */
const WIDE_DRAWS = 6;

/** The two passives left one level under their maxima in the narrow pool. */
const NARROW_PASSIVES: readonly OfferId[] = ["mirror", "bellows"];

/** Read one overlay's draw against its own pool. */
function assertDraw(overlay: WickSnapshot, context: string): void {
  assertEqual(overlay.screen, "levelup", `the screen ${context}`);
  assertGreaterThanOrEqual(
    overlay.run.pool.length,
    OFFER_COUNT,
    `the candidates in the pool ${context}`,
  );
  assertLength(overlay.run.offers, OFFER_COUNT, `the offers drawn ${context}`);
  assertEachIn(
    overlay.run.offers,
    overlay.run.pool,
    `each offer against the pool ${context}`,
  );
  assertEqual(
    new Set(overlay.run.offers).size,
    overlay.run.offers.length,
    `the distinct offers among those drawn ${context}`,
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws three distinct candidates, over a wide pool and over one of exactly three", async () => {
  await isolate(h);
  for (let draw = 1; draw <= WIDE_DRAWS; draw += 1) {
    const overlay = await openLevelUp(h);
    assertDraw(overlay, `the overlay opened over the whole pool, draw ${draw}`);
    await poseScreen(h, "playing");
  }

  await isolate(h);
  for (const id of FULL_WEAPONS) {
    await holdWeapon(
      h,
      id,
      id === "taper" ? MAX_WEAPON_LEVEL - 1 : MAX_WEAPON_LEVEL,
    );
  }
  for (const id of FULL_PASSIVES) {
    const max = PASSIVES[id].maxLevel;
    await holdPassive(h, id, NARROW_PASSIVES.includes(id) ? max - 1 : max);
  }
  const narrow = await openLevelUp(h);
  await captureStill(h, "offers");
  assertDraw(narrow, "the overlay opened over a pool of exactly three");
});
