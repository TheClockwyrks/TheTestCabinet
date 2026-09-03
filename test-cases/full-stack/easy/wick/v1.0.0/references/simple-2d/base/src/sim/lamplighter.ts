// Wick — the lamplighter (specs/world.md "The lamplighter", "Contact
// damage", "Fallen and dawn").

import {
  CONTACT_COOLDOWN,
  CUES,
  DAWN_TIME,
  ENEMIES,
  HURT_FLASH,
  MIN_DAMAGE_TAKEN,
  PLAYER_RADIUS,
  TICK_DT,
  TICK_HZ,
} from "../constants";
import { armor, maxHp, moveSpeed, recovery } from "../stats";
import type { Held, TickContext } from "./context";
import { circlesOverlap, unit, type Vec } from "./geometry";
import { countDown, isDue } from "./timers";

/** The tick on which the night ends: `DAWN_TIME × TICK_HZ`. */
export const DAWN_TICK = DAWN_TIME * TICK_HZ;

/** The unit movement direction the held actions sum to, or `null`. */
export function movementDirection(held: Held): Vec | null {
  return unit({ x: held.right - held.left, y: held.down - held.up });
}

/** Phase 2: the lamplighter moves and `facing` updates. */
export function moveLamplighter(ctx: TickContext): void {
  const { run, held } = ctx;
  const dir = movementDirection(held);
  run.moving = dir !== null;
  if (dir === null) return;
  const speed = moveSpeed(run.passives);
  run.player.x += dir.x * speed * TICK_DT;
  run.player.y += dir.y * speed * TICK_DT;
  run.movedTicks += 1;
  if (dir.x < 0) run.player.facing = "left";
  else if (dir.x > 0) run.player.facing = "right";
}

/** Phase 3: recovery, capped at the `maxHp` in force. */
export function recover(ctx: TickContext): void {
  const { run } = ctx;
  run.player.hp = Math.min(
    maxHp(run.passives),
    run.player.hp + recovery(run.passives) * TICK_DT,
  );
}

/** Add `amount` health, capped at the `maxHp` in force. */
export function heal(ctx: TickContext, amount: number): void {
  const { run } = ctx;
  run.player.hp = Math.min(maxHp(run.passives), run.player.hp + amount);
}

/**
 * Phase 7: every enemy's contact cooldown and the lamplighter's hurt flash
 * count down, and, while `enemyContact` is on, an overlapping enemy whose
 * cooldown is due hits. A tick on which any hit lands arms the flash again,
 * whatever the number of hits; nothing else sets it.
 */
export function contact(ctx: TickContext): void {
  const { run, state } = ctx;
  const reduction = armor(run.passives);
  run.hurtFlash = countDown(run.hurtFlash);
  for (const enemy of run.enemies) {
    enemy.contactCooldown = countDown(enemy.contactCooldown);
    if (!state.enemyContact) continue;
    if (!isDue(enemy.contactCooldown)) continue;
    const def = ENEMIES[enemy.type];
    if (!circlesOverlap(enemy, def.radius, run.player, PLAYER_RADIUS)) continue;
    run.player.hp -= Math.max(MIN_DAMAGE_TAKEN, def.damage - reduction);
    enemy.contactCooldown = CONTACT_COOLDOWN;
    run.hurtFlash = HURT_FLASH;
    ctx.cues.add(CUES.hurt);
  }
}

/**
 * Phase 11: the endings. Dawn is checked first; a run that ends leaves
 * `playing` for the end screen, its run kept.
 */
export function endings(ctx: TickContext): boolean {
  const { run, state } = ctx;
  if (run.tick === DAWN_TICK) {
    state.screen = "dawn";
    state.menuIndex = 0;
    ctx.cues.add(CUES.dawn);
    return true;
  }
  if (run.player.hp <= 0) {
    state.screen = "fallen";
    state.menuIndex = 0;
    ctx.cues.add(CUES.fallen);
    return true;
  }
  return false;
}
