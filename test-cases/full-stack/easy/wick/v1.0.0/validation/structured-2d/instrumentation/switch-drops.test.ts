// Wick — instrumentation/switch-drops: with `setDrops(false)`, a moth killed by
// a puddle leaves neither its gem nor a pickup and makes no drop roll; with
// the switch back on, the next kill leaves its gem and the drop its roll
// gives it.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`, the
// switch table, `drops`: on, "An enemy that dies leaves what `specs/world.md`
// gives it: a common's gem and the bread or draft its roll drops, and an
// elite's chest"; off, "A death leaves nothing on the field and makes no drop
// roll, so a posed `nextDrop` stands. The enemy still dies, still counts as a
// kill, and still sounds." "turning one back on resumes that faculty from the
// next tick".
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
// WHY A DROP IS POSED. "makes no drop roll" is the half of the rule the field
// cannot show on its own: a build that rolled for bread and discarded the
// result leaves the same empty field. `setNextDrop("bread")` is what makes
// the roll readable: "The next common enemy killed by a weapon while `drops`
// is on drops that pickup ... and that kill consumes it. A death while
// `drops` is off ... leave[s] it standing" (`specs/instrumentation.md`, Drawn
// outcomes). So the off kill leaves `nextDrop` posed, and the on kill drops
// the bread and consumes it.
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
// THE TOLERANCE. None: list lengths, a whole kill count, and a posed value
// read back.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNull } from "../assert";
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
  h.debug.setNextDrop("bread");

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
    killed.run.nextDrop,
    "bread",
    "nextDrop across the killing tick with drops off (specs/instrumentation.md: makes no drop roll, so a posed nextDrop stands)",
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
  assertLength(
    dropped.run.pickups,
    1,
    "the pickups that death left with drops on, the posed bread",
  );
  assertEqual(
    dropped.run.pickups[0]?.kind,
    "bread",
    "the kind of the pickup the kill dropped, as posed",
  );
  assertNull(
    dropped.run.nextDrop,
    "nextDrop across the killing tick with drops on (specs/instrumentation.md: that kill consumes it)",
  );
});
