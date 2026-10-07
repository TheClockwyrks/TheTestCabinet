// passives/tallow-gain-raises-hp — gaining a Tallow level from the level-up
// overlay raises current health by the same 15 it raises the maximum by, on the
// tick it is gained.
//
// WHERE THE THRESHOLD COMES FROM. specs/passives.md ("Max health"): "Each time
// Tallow rises by one level, whether it is gained at level 1 or leveled from
// any level below its max, and through whichever path grants it, the
// lamplighter's current `hp` rises by TALLOW_HP_PER_LEVEL on the same tick that
// `maxHp` does", with TALLOW_HP_PER_LEVEL 15 and
// maxHp = BASE_MAX_HP (100) + 15 × tallow. specs/progression.md ("Choosing")
// states the same for the overlay: "Gaining a Tallow level raises `hp` by
// TALLOW_HP_PER_LEVEL (15) at the same time as `maxHp`, whichever path grants
// it", and "Accepting an offer applies it on the spot". So from hp 100 the
// first acceptance reads 115 and 115, and the second 130 and 130.
//
// THE WORLD. An isolated playing run: nothing on the field, no weapon held, no
// passive held, every driver switch off, so hp stands at the BASE_MAX_HP a run
// starts at and nothing but the acceptance can move it. The overlay is reached
// the real way, by queueing one level-up and running the tick that opens it
// ("A `playing` tick that ends with `pendingLevelUps` above 0 runs to
// completion and then opens the overlay", specs/progression.md), with Tallow
// named through `setNextOffers` so the draw is not left to the generator; it is
// a candidate both times, first as a passive not held and then as a held
// passive below its max. The offer is accepted through `choose`, which
// specs/instrumentation.md has act "exactly as moving the highlight there and
// pressing `confirm` would", so no menu key is pressed.
//
// WHAT IS READ. `hp` and `maxHp` immediately after each acceptance, with no
// tick between, which is what "on the same tick" reads as. Twice, because a
// build that adds the 15 only when the passive first enters a slot passes the
// first reading and misses the second.
//
// TOLERANCE. FIGURE_TOLERANCE (1e-9) on each, a sum of stated figures read back
// as a double.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertWithin } from "../assert";
import { FIGURE_TOLERANCE, derived, type HeldPassives } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

/** The passive offered and accepted, twice over. */
const OFFER = "tallow";

/** maxHp after one Tallow level, and after two: 115 and 130. */
const AFTER_ONE = derived.maxHp({ tallow: 1 } satisfies HeldPassives);
const AFTER_TWO = derived.maxHp({ tallow: 2 } satisfies HeldPassives);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("raises hp and maxHp together to 115 and then to 130 as Tallow is accepted twice", async () => {
  const posed = isolate(h);
  assertWithin(
    posed.run.player.hp,
    derived.maxHp({}),
    FIGURE_TOLERANCE,
    "hp before the first Tallow level",
  );

  h.debug.setNextOffers([OFFER]);
  const first = await openLevelUp(h);
  assertEqual(first.screen, "levelup", "the screen the first offer is on");
  assertDeepEqual(first.run.offers, [OFFER], "the first overlay's offers");

  h.debug.choose(0);
  const one = h.snapshot();
  captureStill(h, "raised");
  assertWithin(
    one.run.maxHp,
    AFTER_ONE,
    FIGURE_TOLERANCE,
    "maxHp on the tick the first Tallow level was accepted",
  );
  assertWithin(
    one.run.player.hp,
    AFTER_ONE,
    FIGURE_TOLERANCE,
    "hp on the tick the first Tallow level was accepted",
  );

  h.debug.setNextOffers([OFFER]);
  const second = await openLevelUp(h);
  assertEqual(second.screen, "levelup", "the screen the second offer is on");
  assertDeepEqual(second.run.offers, [OFFER], "the second overlay's offers");

  h.debug.choose(0);
  const two = h.snapshot();
  assertWithin(
    two.run.maxHp,
    AFTER_TWO,
    FIGURE_TOLERANCE,
    "maxHp on the tick the second Tallow level was accepted",
  );
  assertWithin(
    two.run.player.hp,
    AFTER_TWO,
    FIGURE_TOLERANCE,
    "hp on the tick the second Tallow level was accepted",
  );
});
