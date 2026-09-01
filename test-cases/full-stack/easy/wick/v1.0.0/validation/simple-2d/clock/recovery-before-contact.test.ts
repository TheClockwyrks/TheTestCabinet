// Wick — clock/recovery-before-contact: recovery applies before contact damage.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/world.md` ("One tick"): phase 3, "Recovery, as Health and recovery
//     states", comes before phase 7, "Contact ... an overlapping enemy whose
//     cooldown is due hits".
//   - `specs/world.md` ("Health and recovery"): "On every tick, before contact
//     damage is applied: `hp = min(maxHp, hp + recovery × TICK_DT)`".
//   - `specs/passives.md` ("Recovery"): "`recovery` is `BASE_RECOVERY` (`0`)
//     plus `TINDER_RECOVERY_PER_LEVEL` per Tinder level", 0.5 at level 1; and
//     ("Max health"): "Every heal and every recovery tick caps `hp` at the
//     `maxHp` in force".
//   - `specs/world.md` ("Contact damage"): "An overlapping enemy whose
//     `contactCooldown` is due lands a hit: `hp` falls by
//     `max(MIN_DAMAGE_TAKEN, enemy damage - armor)`", a moth's damage being
//     `5` and its cooldown `0` at spawn.
//
// WHAT IS READ. Tinder is held, `hp` stands at `maxHp`, and a moth overlaps
// the lamplighter with `enemyContact` on. On the next tick recovery would add
// `0.5 × TICK_DT` but caps at `maxHp`, and the hit then removes 5, so `hp` must
// read `maxHp − 5` exactly. Contact before recovery would read
// `maxHp − 5 + 0.5 × TICK_DT`, about 0.0083 higher, which the tolerance
// refuses.
//
// WHY THE NIGHT IS POSED AS IT IS. One moth, still and overlapping, is the
// only source of damage, and Tinder at level 1 the only source of recovery.
// `enemyMotion` is off so the moth stays where it overlaps, and no weapon is
// held so nothing kills it before it hits.
//
// TOLERANCE. `FIGURE_TOLERANCE` (1e-9) on `hp`, a stated figure less a stated
// figure; the alternative order differs by 8.3e-3.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertWithin } from "../assert";
import { ENEMIES, FIGURE_TOLERANCE } from "../constants";
import {
  captureStill,
  createHarness,
  enable,
  holdPassive,
  isolate,
  spawnEnemyNear,
  type Harness,
} from "../harness";

/** The moth's offset from the lamplighter: inside 10 + 12, so it overlaps. */
const MOTH_DX = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("caps hp by recovery first and takes the moth's damage after", async () => {
  isolate(h);
  holdPassive(h, "tinder");
  const posed = h.snapshot();
  assertEqual(
    posed.run.player.hp,
    posed.run.maxHp,
    "hp at maxHp before the tick",
  );
  spawnEnemyNear(h, "moth", MOTH_DX, 0);
  enable(h, "enemyContact");

  const after = await h.tick(1);
  captureStill(h, "ordered");

  assertWithin(
    after.run.player.hp,
    posed.run.maxHp - ENEMIES.moth.damage,
    FIGURE_TOLERANCE,
    "hp after the tick the moth hit on",
  );
});
