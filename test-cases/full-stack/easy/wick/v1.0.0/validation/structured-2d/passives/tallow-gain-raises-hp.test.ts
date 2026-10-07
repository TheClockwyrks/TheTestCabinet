// passives/tallow-gain-raises-hp — gaining a Tallow level raises `hp` by
// `TALLOW_HP_PER_LEVEL` on the same tick the maximum rises.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md`, Max health: "Each time
// Tallow rises by one level, whether it is gained at level `1` or leveled from
// any level below its max, and through whichever path grants it, the
// lamplighter's current `hp` rises by `TALLOW_HP_PER_LEVEL` on the same tick
// that `maxHp` does." `specs/progression.md` says the same of the overlay:
// "Gaining a Tallow level raises `hp` by `TALLOW_HP_PER_LEVEL` (`15`) at the
// same time as `maxHp`, whichever path grants it." With `BASE_MAX_HP` (`100`)
// and `hp` at `100`, the first level reads `115` and `115`, and the second
// `130` and `130`.
//
// WHY THE PATH IS THE OVERLAY. This is the level-up path of the requirement:
// "Accepting an offer applies it on the spot" (`specs/progression.md`,
// Choosing), so both figures are read at the `choose` call with no tick
// between. The chest path is `tallow-gain-via-chest`'s.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding no weapon and no
// passive, so a passive slot is free and Tallow "not held" is a candidate of
// the pool, then held below its max and a candidate again. `setNextOffers`
// names Tallow alone, and is "accepted when every id is a candidate of the
// pool at that moment" (`specs/instrumentation.md`), so the overlay presents
// exactly it and the acceptance is not a draw. `openLevelUp` runs the one
// `playing` tick that opens the overlay; every driver switch is off, so
// nothing else touches `hp` on it, and with no Tinder held recovery is
// `BASE_RECOVERY` (`0`).
//
// THE TOLERANCE. `REAL_EPS` on `hp` and `maxHp`, sums of whole figures; a
// build that raised the maximum alone reports `100` where `115` is required.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNear } from "../assert";
import { BASE_MAX_HP, REAL_EPS, maxHpOf } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

/** The two levels gained, in order. */
const LEVELS = [1, 2] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("raises hp and maxHp to 115 and then to 130 as Tallow is accepted twice", async () => {
  const start = isolate(h);
  assertNear(
    start.run.player.hp,
    BASE_MAX_HP,
    REAL_EPS,
    "hp before the first Tallow level (specs/world.md, The lamplighter)",
  );

  for (const level of LEVELS) {
    h.debug.setNextOffers(["tallow"]);
    const overlay = await openLevelUp(h, 1);
    assertEqual(
      overlay.screen,
      "levelup",
      `the screen the ${level === 1 ? "first" : "second"} queued level-up opened (specs/progression.md)`,
    );
    assertDeepEqual(
      overlay.run.offers,
      ["tallow"],
      "the offers the overlay presented (specs/instrumentation.md, setNextOffers)",
    );

    h.debug.choose(0);
    const accepted = h.snapshot();
    assertDeepEqual(
      accepted.run.passives,
      [{ id: "tallow", level }],
      `the passives after accepting Tallow level ${level} (specs/progression.md, Choosing)`,
    );
    assertNear(
      accepted.run.maxHp,
      maxHpOf(level),
      REAL_EPS,
      `maxHp at Tallow ${level} (specs/passives.md, Max health)`,
    );
    assertNear(
      accepted.run.player.hp,
      maxHpOf(level),
      REAL_EPS,
      `hp at the moment Tallow ${level} was accepted (specs/passives.md, Max health)`,
    );
  }

  await h.frameDraw();
  captureStill(h, "raised");
});
