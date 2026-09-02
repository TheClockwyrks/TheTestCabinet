// instrumentation/overlay-sources — the shown overlay reports every
// registered diagnostic with the live value the snapshot reports.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md (Diagnostics):
// "Register at least the current `screen`, the run clock, the level with `xp`
// over `xpToNext`, `hp` over `maxHp`, the kill count, the lamplighter's
// position and facing, the enemy count with the spawn window index, the
// projectile and zone counts, the gem count, the held weapons with their
// levels and cooldowns, the held passives with their levels,
// `pendingLevelUps`, and the seven driver switches, the same facts the
// snapshot reports".
//
// HOW IT IS READ. The overlay is text the frame draws, so the panel's
// contribution is the multiset difference between a frame with it shown and a
// frame with it hidden; the HUD, drawn alike in both, cancels out, so a HUD
// that shows hp cannot answer for a panel that omits it. The scene is posed
// and then PAUSED, so a queued level-up and a posed tick sit still while
// frames are read, and every figure is distinctive enough to read as a token.
// Neither wording nor layout is fixed, so tokens are all this may ask for of a
// number the spec names as a number: the clock is accepted as m:ss, whole
// seconds, or ticks. A value whose rendering is free (facing, a level a panel
// may write as "L8", a cooldown, a switch) is read instead as the panel's
// stable lines CHANGING when that one value is flipped through the surface,
// the panel re-read against a fresh hidden frame each time so the game's own
// text never stands in for it.

import { afterEach, beforeEach, it } from "vitest";
import { assertNotEqual, assertTrue } from "../assert";
import { clockText } from "../constants";
import {
  captureStill,
  createHarness,
  hasToken,
  holdPassive,
  holdWeapon,
  isolate,
  minusLines,
  pressToggle,
  spawnEnemyAt,
  spawnGemAt,
  type Harness,
} from "../harness";
import { frameText, stableLines } from "./helpers";

/** The posed figures, each distinctive enough to read back as a token. */
const TICK = 6000;
const LEVEL = 7;
const XP = 12;
const HP = 43;
const KILLS = 321;
const POSITION = { x: 300, y: -120 };
const ENEMIES_POSED = 4;
const PROJECTILES = 6;
const GEMS = 5;
const EMBER_LEVEL = 8;
const EMBER_LEVEL_B = 3;
const SOOT_LEVEL = 1;
const SOOT_LEVEL_B = 2;
const PENDING = 2;
const COOLDOWN_A = 0.75;
const COOLDOWN_B = 0.25;

/**
 * The panel's stable lines, read with the overlay currently shown: hide it
 * for a baseline frame, show it again, and keep what two shown frames agree
 * on beyond that baseline. Sorted and joined, so two readings compare as one
 * string.
 */
async function panelStable(h: Harness): Promise<string> {
  await pressToggle(h);
  const hidden = await frameText(h);
  await pressToggle(h);
  const first = minusLines(await frameText(h), hidden);
  const second = minusLines(await frameText(h), hidden);
  return [...stableLines(first, second)].sort().join("\n");
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("shows each registered source with its live value", async () => {
  isolate(h, { level: LEVEL });
  h.debug.setTick(TICK);
  h.debug.setXp(XP);
  h.debug.setKills(KILLS);
  h.debug.setPlayerPosition(POSITION.x, POSITION.y);
  h.debug.setFacing("left");
  holdWeapon(h, "halo", 1);
  const ember = holdWeapon(h, "ember", EMBER_LEVEL);
  h.debug.setWeaponCooldown(ember, COOLDOWN_A);
  const soot = holdPassive(h, "soot", SOOT_LEVEL);
  h.debug.setHp(HP);
  const types = ["moth", "bat", "rat", "beetle"] as const;
  for (let i = 0; i < ENEMIES_POSED; i += 1) {
    spawnEnemyAt(h, types[i], POSITION.x + 400 + i * 50, POSITION.y + 300);
  }
  for (let i = 0; i < PROJECTILES; i += 1) {
    h.debug.spawnProjectile(
      "ember",
      POSITION.x - 400,
      POSITION.y + i * 30,
      0,
      0,
      0,
    );
  }
  for (let i = 0; i < GEMS; i += 1) {
    spawnGemAt(h, "small", POSITION.x, POSITION.y - 400 - i * 20);
  }
  h.debug.spawnPuddle("oil-splash", POSITION.x + 500, POSITION.y - 500);
  await h.tick(1);
  h.debug.setScreen("paused");
  h.debug.setPendingLevelUps(PENDING);
  const live = h.snapshot();

  const before = await frameText(h);
  await pressToggle(h);
  const shown = await frameText(h);
  captureStill(h, "sources");
  const panel = minusLines(shown, before);

  const clock = [
    clockText(live.run.tick),
    String(live.run.time),
    String(live.run.tick),
  ];
  assertTrue(hasToken(panel, live.screen), "the screen on the panel");
  assertTrue(
    clock.some((form) => hasToken(panel, form)),
    "the run clock on the panel",
  );
  assertTrue(hasToken(panel, String(live.run.level)), "the level on the panel");
  assertTrue(hasToken(panel, String(live.run.xp)), "xp on the panel");
  assertTrue(
    hasToken(panel, String(live.run.xpToNext)),
    "xpToNext on the panel",
  );
  assertTrue(hasToken(panel, String(live.run.player.hp)), "hp on the panel");
  assertTrue(hasToken(panel, String(live.run.maxHp)), "maxHp on the panel");
  assertTrue(
    hasToken(panel, String(live.run.kills)),
    "the kill count on the panel",
  );
  assertTrue(
    hasToken(panel, String(live.run.player.x)),
    "the lamplighter's x on the panel",
  );
  assertTrue(
    hasToken(panel, String(live.run.player.y)),
    "the lamplighter's y on the panel",
  );
  assertTrue(
    hasToken(panel, String(live.run.enemies.length)),
    "the enemy count on the panel",
  );
  assertTrue(
    hasToken(panel, String(live.run.spawnWindow)),
    "the spawn window on the panel",
  );
  assertTrue(
    hasToken(panel, String(live.run.projectiles.length)),
    "the projectile count on the panel",
  );
  assertTrue(
    hasToken(panel, String(live.run.zones.length)),
    "the zone count on the panel",
  );
  assertTrue(
    hasToken(panel, String(live.run.gems.length)),
    "the gem count on the panel",
  );
  for (const held of live.run.weapons) {
    assertTrue(
      hasToken(panel, held.id),
      `the held weapon ${held.id} on the panel`,
    );
  }
  for (const held of live.run.passives) {
    assertTrue(
      hasToken(panel, held.id),
      `the held passive ${held.id} on the panel`,
    );
  }
  assertTrue(
    hasToken(panel, String(live.run.pendingLevelUps)),
    "pendingLevelUps on the panel",
  );

  // The values whose rendering is free: the panel's stable lines change when
  // the one value is flipped through the surface, on the paused scene.
  const facingLeft = await panelStable(h);
  h.debug.setFacing("right");
  assertNotEqual(
    await panelStable(h),
    facingLeft,
    "the panel across the facing flip",
  );

  const emberAtEight = await panelStable(h);
  h.debug.setWeapon(ember, "ember", EMBER_LEVEL_B);
  assertNotEqual(
    await panelStable(h),
    emberAtEight,
    "the panel across Ember's level change",
  );

  const cooldownA = await panelStable(h);
  h.debug.setWeaponCooldown(ember, COOLDOWN_B);
  assertNotEqual(
    await panelStable(h),
    cooldownA,
    "the panel across Ember's cooldown change",
  );

  const sootAtOne = await panelStable(h);
  h.debug.setPassive(soot, "soot", SOOT_LEVEL_B);
  assertNotEqual(
    await panelStable(h),
    sootAtOne,
    "the panel across Soot's level change",
  );

  const switchesOff = await panelStable(h);
  h.debug.setSpawning(true);
  assertNotEqual(
    await panelStable(h),
    switchesOff,
    "the panel across a switch flip",
  );
});
