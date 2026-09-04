// Wick — instrumentation/switch-drops: with `setDrops(false)`, a moth killed by
// a puddle leaves neither its gem nor a pickup and draws nothing; with the
// switch back on, the next kill leaves its gem.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`, the
// switch table, `drops`: on, "An enemy that dies leaves what `specs/world.md`
// gives it: a common's gem and the bread or draft its roll draws, and an
// elite's chest"; off, "A death leaves nothing on the field and draws nothing
// from the generator. The enemy still dies, still counts as a kill, and still
// sounds." "turning one back on resumes that faculty from the next tick".
// `specs/world.md`, "Gems": "While `drops` is on, every common enemy drops one
// gem of the tier `specs/enemies.md` lists for its type, at the enemy's
// position, on the tick it dies", which for a moth is `small`
// (`specs/enemies.md`, the moth row).
//
// WHAT IS READ, AND WHY IN THREE PARTS. The switch's claim is that the DEATH
// still happens and only what it LEAVES is held, so the off half reads that
// `kills` rose, that the field carries no gem, and that it carries no pickup.
// A build that held the death itself rather than its drop fails on the first
// of those, which is what tells this point apart from a build that stopped
// killing.
//
// WHY THE GENERATOR IS READ. "draws nothing from the generator" is the half of
// the rule the field cannot show: a build that rolled for bread and discarded
// the result leaves the same empty field and a moved `rngState`, and every
// seeded scenario after it draws a different sequence. With every switch off
// the only source of a draw on a `playing` tick is the drop roll — a spawn's
// angle and type, an offer draw, a puddle's landing point, a strike's target,
// a swarm's direction, and a chest's item all belong to faculties this world
// holds — so `rngState` across the killing tick is exactly the draw the death
// made.
//
// THE DRIVE. An isolated run with every switch off. A moth is posed at the
// damage of a level-1 Oil Splash puddle standing on its own center, which
// "pulses first on the next tick" whatever the switches hold and deals its
// row's damage to every enemy overlapping it (`specs/instrumentation.md`,
// `spawnPuddle`; `specs/weapons.md`, Oil Splash), so the next tick takes the
// moth to `0` and the death is that tick's. Both moths stand `AWAY` (`1000`)
// units out, far outside `pickupRadius` (`48` with no Lure held) and the
// collection distance, so a drop that landed would still be lying there when
// the snapshot is read.
//
// THE TOLERANCE. None: list lengths, a whole kill count, and a generator state
// compared for equality.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNotEqual } from "../assert";
import { ENEMIES, OIL_SPLASH_LEVELS } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  enable,
  isolate,
  placeEnemy,
  placePuddle,
  type Harness,
  type WickSnapshot,
} from "../harness";

/** A level-1 Oil Splash puddle's damage, which meets a moth's posed `hp`. */
const PULSE_DAMAGE = OIL_SPLASH_LEVELS[0].damage;

/** Far enough from the lamplighter that nothing a death leaves is collected. */
const AWAY = 1000;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/** Kill one moth at `(x, 0)` on the next tick; the tick before and after it. */
async function killAt(x: number): Promise<[WickSnapshot, WickSnapshot]> {
  const moth = placeEnemy(h, "moth", x, 0);
  h.debug.setEnemyHp(moth, Math.min(PULSE_DAMAGE, ENEMIES.moth.hp));
  placePuddle(h, "oil-splash", x, 0);
  const before = h.snapshot();
  return [before, await advanceTicks(h, 1)];
}

it("leaves a death empty-handed while off and drops the gem when on", async () => {
  isolate(h);

  const [before, killed] = await killAt(AWAY);
  captureStill(h, "held");
  assertEqual(
    killed.run.kills,
    before.run.kills + 1,
    "the kills after the tick that killed a moth with drops off",
  );
  assertLength(killed.run.gems, 0, "the gems that death left with drops off");
  assertLength(
    killed.run.pickups,
    0,
    "the pickups that death left with drops off",
  );
  assertEqual(
    killed.rngState,
    before.rngState,
    "rngState across the killing tick with drops off (specs/instrumentation.md: draws nothing from the generator)",
  );

  enable(h, "drops");
  const [held, dropped] = await killAt(-AWAY);
  captureStill(h, "dropped");
  assertEqual(
    dropped.run.kills,
    held.run.kills + 1,
    "the kills after the tick that killed a moth with drops on",
  );
  assertLength(dropped.run.gems, 1, "the gems that death left with drops on");
  assertEqual(
    dropped.run.gems[0]?.tier,
    ENEMIES.moth.gem,
    "the tier of the gem a moth's death dropped (specs/enemies.md, the moth row)",
  );
  assertNotEqual(
    dropped.rngState,
    held.rngState,
    "rngState across the killing tick with drops on (specs/world.md, The drop roll: a common's death draws)",
  );
});
