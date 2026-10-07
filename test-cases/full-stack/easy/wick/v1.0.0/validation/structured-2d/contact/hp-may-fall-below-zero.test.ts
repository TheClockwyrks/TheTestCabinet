// contact/hp-may-fall-below-zero — a hit carries hp below zero rather than
// stopping at it.
//
// THE SPEC LINE. `specs/world.md`, "Health and recovery": "`hp` is a real
// number at most `maxHp`; a hit may take it below `0`, which ends the run."
// And the snapshot on an end screen reports "the run that just ended on
// `fallen` and `dawn`" (`specs/instrumentation.md`, Snapshot shape), so what
// the hit left is what the fallen screen's snapshot reads.
//
// THE FIGURE. `hp` posed to `2` through `setHp`, which has "no lower bound"
// and applies the ending "at the end of the next `playing` tick" only for a
// value at or below `0`, so `2` starts a live tick. A hound's damage is `20`
// (`specs/enemies.md`) and no Brass is held, so the hit removes `20` and the
// reading is `2 − 20 = −18`, not `0`.
//
// WHAT THIS POINT DECIDES. The figure alone. That the run ended is
// `fallen-at-zero`'s point, and the picture shows whichever screen the build
// went to; a build that clamps to `0` fails here whatever screen it shows.
//
// THE POSE. One hound overlapping the lamplighter (its radius `18` plus
// `PLAYER_RADIUS` `12` bounds overlap at `30`), spawn cooldown `0`,
// `enemyMotion` off, `enemyContact` on, no weapon and no recovery.
//
// THE TOLERANCE. `2 − 20`, held to `REAL_EPS`.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import { ENEMIES, REAL_EPS } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  enable,
  isolate,
  placeEnemyNear,
  type Harness,
} from "../harness";

/** The hp posed before the hit. */
const POSED_HP = 2;

/** The hound's center distance: inside its `18 + 12` overlap bound. */
const OFFSET = 15;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads hp −18 after a hound's hit of 20 lands on hp 2", async () => {
  isolate(h);
  h.debug.setHp(POSED_HP);
  placeEnemyNear(h, "hound", OFFSET, 0);
  enable(h, "enemyContact");

  const after = await advanceTicks(h, 1);
  captureStill(h, "below");

  assertNear(
    after.run.player.hp,
    POSED_HP - ENEMIES.hound.damage,
    REAL_EPS,
    `hp after a hound's hit of ${ENEMIES.hound.damage} on hp ${POSED_HP} (specs/world.md, Health and recovery)`,
  );
});
