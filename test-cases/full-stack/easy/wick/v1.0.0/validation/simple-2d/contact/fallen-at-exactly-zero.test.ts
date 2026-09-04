// contact/fallen-at-exactly-zero — hp at exactly 0 ends the run, because the
// condition is "0 or below": hp 5 less a moth's 5 ends the run fallen.
//
// THE RULE, FROM THE SPEC. specs/world.md, Fallen and dawn: the Fallen row's
// condition is "hp is 0 or below", read "at the end of a tick, after every
// other phase of that tick has been applied". A moth's damage is 5
// (specs/enemies.md), so with hp posed to 5 and no Brass held its hit leaves
// hp at exactly 0, and the tick ends the run.
//
// WHY EXACTLY ZERO IS POSED. A build that ended the run on `hp < 0` alone
// leaves this run playing at hp 0, and a player who is out of health keeps
// walking; the boundary is what tells the two apart.
//
// THE POSE. An isolated night with enemyContact on: hp posed to 5, one moth
// posed 5 units along +x inside the 22 its radius 10 plus PLAYER_RADIUS sum to,
// held there with enemyMotion off. Its cooldown is 0 at spawn, so the hit
// lands on the first tick. Recovery is 0 with no Tinder held, so nothing
// raises hp above 0 before the ending reads it.
//
// THE TOLERANCE. The screen is discrete. hp is read within FIGURE_TOLERANCE of
// 0, exact arithmetic on stated figures, to show the scenario reached the
// boundary rather than crossing it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertWithin } from "../assert";
import { ENEMIES, FIGURE_TOLERANCE } from "../constants";
import {
  captureStill,
  createHarness,
  enable,
  isolate,
  spawnEnemyNear,
  type Harness,
} from "../harness";

/** The enemy whose hit lands exactly on the posed hp: damage 5, radius 10. */
const TYPE = "moth";

/** Where the moth is posed: 5 units along +x, inside the overlap. */
const OFFSET = 5;

/** The hp posed: exactly the moth's damage. */
const POSED_HP = ENEMIES[TYPE].damage;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("ends the run fallen on the tick a moth's 5 takes hp 5 to exactly 0", async () => {
  isolate(h);
  enable(h, "enemyContact");
  h.debug.setHp(POSED_HP);
  spawnEnemyNear(h, TYPE, OFFSET, 0);

  const after = await h.tick(1);
  captureStill(h, "exact");

  assertWithin(
    after.run.player.hp,
    0,
    FIGURE_TOLERANCE,
    "hp after the hit: the boundary itself",
  );
  assertEqual(
    after.screen,
    "fallen",
    "screen after the tick that left hp at 0",
  );
});
