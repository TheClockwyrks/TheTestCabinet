// evolutions/chandelier-rehit-interval — each Chandelier lantern re-hits every
// LANTERN_REHIT.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Chandelier"): "Each
// lantern is a touching effect with re-hit interval `LANTERN_REHIT` (`0.5`),
// timed per lantern per enemy." `specs/weapons.md` ("Persistent effects"): "A
// touching effect ... damages an enemy on any tick the two overlap, at most
// once per re-hit interval per effect per enemy." `specs/world.md`
// ("Timers"): "An interval of `s` seconds anywhere in this specification is
// likewise `round(s × TICK_HZ)` ticks", so the interval is `round(0.5 × 60)` =
// 30 ticks. `CHANDELIER_STATS` gives damage 25, and with no Wick held
// `damageMul` is 1 (`specs/passives.md`), so each hit removes exactly 25
// (`specs/weapons.md`, Hits and death).
//
// So, counting from the tick the hound is posed under a standing lantern: it
// is hit on tick 1; nothing touches it on ticks 2 through 30, while the entry
// the hit wrote counts down; and on tick 31 the entry is due and the lantern
// hits again, taking its `hp` down another 25.
//
// WHY `effectMotion` IS OFF. The review item names it: with the switch off
// "every lantern holds its angle" while "`ttl` and every re-hit entry still
// count, and hits still resolve" (`specs/instrumentation.md`), so the lantern
// stays over the hound for the whole span and what is read is the re-hit
// schedule rather than a lantern orbiting away and back.
//
// WHY THE ENEMY IS A HOUND, AND WHERE IT STANDS. Its 120 base `hp`
// (`specs/enemies.md`) outlasts both hits, so the second is read as a fall in
// `hp` rather than as a death. It is posed at the lantern's own center, read
// off the snapshot, so the two circles overlap at distance 0 whatever radii
// the build gave them; the four lanterns sit `120 × sqrt(2)` ≈ 170 units
// apart on their circle, far outside the `20 + 18` at which a second lantern's
// circle could reach it (`specs/weapons.md`, Shapes and overlap), so exactly
// one lantern is over it. A posed enemy "first moves, first hits, and first
// pulses on the next tick" (`specs/instrumentation.md`), so the lantern's
// first opportunity against it is tick 1.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding nothing but
// Chandelier and that hound, every driver switch off: `enemyMotion` keeps the
// hound under the lantern, `enemyContact` keeps contact damage out, and
// `weaponFire` keeps anything else from firing.
//
// THE TOLERANCE. `REAL_EPS` on each `hp`, the posed value less one or two
// hits of 25; none on the ticks, which the interval rule fixes exactly. A hit
// one tick early or late differs by a whole 25 of damage.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertDefined,
  assertEqual,
  assertNear,
} from "../assert";
import {
  CHANDELIER_STATS,
  ENEMIES,
  LANTERN_REHIT,
  REAL_EPS,
  ticksOf,
} from "../constants";
import {
  advanceTicks,
  captureReplay,
  createHarness,
  distance,
  placeEnemy,
  type Harness,
} from "../harness";
import { hpOf, placeChandelier, wasHit } from "./evolved";

/** Ticks between one lantern's hits on one enemy: `round(0.5 × 60)` = 30. */
const INTERVAL = ticksOf(LANTERN_REHIT);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("hits a hound under a Chandelier lantern on tick 1 and again on tick 31, and on no tick between", async () => {
  const placed = await placeChandelier(h);
  assertEqual(
    placed.lanterns.length,
    CHANDELIER_STATS.amount,
    "the Chandelier lanterns standing after the placing tick (specs/evolutions.md, Chandelier)",
  );
  const lantern = placed.lanterns[0];
  assertDefined(lantern, "a lantern of the standing set");

  // The lantern the hound stands under must be the only one that can reach it.
  const reach = CHANDELIER_STATS.radius + ENEMIES.hound.radius;
  for (const other of placed.lanterns) {
    if (other.id === lantern.id) continue;
    if (!(distance(other, lantern) >= reach)) {
      throw new Error("two lanterns of the set can reach the same enemy");
    }
  }

  const hound = placeEnemy(h, "hound", lantern.x, lantern.y);
  const full = hpOf(h.snapshot(), hound);

  const trace = await captureReplay(h, "rehit", async () => {
    const first = await advanceTicks(h, 1);
    const firstHp = hpOf(first, hound);

    // The ticks between, one at a time, so a hit on any of them is seen.
    const early: number[] = [];
    let hp = firstHp;
    for (let tick = 2; tick <= INTERVAL; tick += 1) {
      const s = await advanceTicks(h, 1);
      if (wasHit(s, hound, hp)) early.push(tick);
      hp = hpOf(s, hound);
    }

    const due = await advanceTicks(h, 1);
    return { firstHp, early, dueHp: hpOf(due, hound), dueTick: due.run.tick };
  });

  assertNear(
    trace.firstHp,
    full - CHANDELIER_STATS.damage,
    REAL_EPS,
    `the hound's hp after tick 1 under the lantern, one hit of ${CHANDELIER_STATS.damage} from ${full} (specs/weapons.md, Persistent effects)`,
  );
  assertDeepEqual(
    trace.early,
    [],
    `the ticks from 2 to ${INTERVAL} on which the hound was hit again (specs/evolutions.md, Chandelier)`,
  );
  assertNear(
    trace.dueHp,
    full - 2 * CHANDELIER_STATS.damage,
    REAL_EPS,
    `the hound's hp after tick ${INTERVAL + 1}, the lantern's re-hit (specs/evolutions.md, Chandelier)`,
  );
});
