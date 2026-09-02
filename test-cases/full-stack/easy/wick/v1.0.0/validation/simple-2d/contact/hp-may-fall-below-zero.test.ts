// contact/hp-may-fall-below-zero — a hit carries hp below 0 rather than
// stopping at 0: hp 2 less a hound's 20 reads −18.
//
// THE RULE, FROM THE SPEC. specs/world.md, Health and recovery: "hp is a real
// number at most maxHp; a hit may take it below 0, which ends the run." Contact
// damage: "hp falls by max(MIN_DAMAGE_TAKEN, enemy damage − armor)", and a
// hound's damage is 20 (specs/enemies.md), so from 2 with no Brass held hp
// falls to 2 − 20 = −18. The end screen's snapshot reports "the run that just
// ended" (specs/instrumentation.md, Snapshot shape), so the −18 is read there.
//
// THE POSE. An isolated night with enemyContact on: hp posed to 2 through
// setHp, whose domain has "no lower bound" and whose values at or above 0 leave
// the run playing; one hound posed 10 units along +x, inside the 30 its radius
// 18 plus PLAYER_RADIUS sum to, held there with enemyMotion off. Its cooldown
// is 0 at spawn, so the hit lands on the first tick; that tick ends the run
// fallen, which is what puts the reading on the end screen.
//
// THE TOLERANCE is FIGURE_TOLERANCE: exact arithmetic on stated figures. A
// build that clamped at 0 reads 0, 18 units away.

import { afterEach, beforeEach, it } from "vitest";
import { assertWithin } from "../assert";
import { ENEMIES, FIGURE_TOLERANCE } from "../constants";
import {
  captureStill,
  createHarness,
  enable,
  isolate,
  spawnEnemyNear,
  type Harness,
} from "../harness";

/** The enemy that hits: damage 20, radius 18. */
const TYPE = "hound";

/** Where the hound is posed: 10 units along +x, inside the overlap. */
const OFFSET = 10;

/** The hp posed before the hit. */
const POSED_HP = 2;

/** 2 − 20 = −18. */
const EXPECTED_HP = POSED_HP - ENEMIES[TYPE].damage;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reads hp −18 after the hound's 20 lands on hp 2", async () => {
  isolate(h);
  enable(h, "enemyContact");
  h.debug.setHp(POSED_HP);
  spawnEnemyNear(h, TYPE, OFFSET, 0);

  const after = await h.tick(1);
  captureStill(h, "below");

  assertWithin(
    after.run.player.hp,
    EXPECTED_HP,
    FIGURE_TOLERANCE,
    "hp after the hit that ended the run",
  );
});
