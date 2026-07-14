/**
 * Sunfront — fog-of-war vision (specs/playfield.md).
 *
 * Vision is a **union of circular discs** around a side's own base, Reliquary, and
 * every live unit (and its Aegis): base/Reliquary reveal a radius of `180`, each unit
 * `140`. This module is pure `(x, z)` math with no THREE and no DOM, so the renderer's
 * fog overlay, the enemy-entity visibility gate, AND the AI's "what it has seen crossing
 * the sand" observation all read the same source of truth — and it is testable headless.
 *
 * The player's vision drives what the human sees (the renderer draws enemy units, the
 * enemy base, and the enemy Reliquary only while they fall inside a player disc, never as
 * stale ghosts); the enemy's vision drives the AI's observations (it does not cheat by
 * reading the player's hidden yard — it reacts only to what it can see).
 */

import type { Team } from "./types";
import type { World } from "./sim/world";
import { VISION_BASE, VISION_RELIQUARY, VISION_UNIT } from "./constants";

/** One reveal disc: everything within `r` of `(x, z)` is visible to its owner. */
export interface VisionSource {
  readonly x: number;
  readonly z: number;
  readonly r: number;
}

/**
 * Collect `team`'s vision discs this frame: its standing base and Reliquary (radius
 * `180`), each of its live units (radius `140`), and each of its live Aegis (radius
 * `180` — the fortress sees far). Dead/destroyed sources contribute nothing.
 */
export function collectVision(world: World, team: Team): VisionSource[] {
  const out: VisionSource[] = [];
  const base = world.bases[team];
  if (!base.dead && base.hp > 0) out.push({ x: base.x, z: base.z, r: VISION_BASE });
  const rel = world.reliquaries[team];
  if (!rel.dead && rel.hp > 0) out.push({ x: rel.x, z: rel.z, r: VISION_RELIQUARY });
  for (const u of world.units) {
    if (u.team === team && !u.dead) out.push({ x: u.x, z: u.z, r: VISION_UNIT });
  }
  for (const a of world.aegis) {
    if (a.team === team && !a.dead) out.push({ x: a.x, z: a.z, r: VISION_BASE });
  }
  return out;
}

/** Is the ground point `(x, z)` inside ANY of the vision discs (i.e. currently seen)? */
export function pointVisible(sources: readonly VisionSource[], x: number, z: number): boolean {
  for (const s of sources) {
    const dx = x - s.x;
    const dz = z - s.z;
    if (dx * dx + dz * dz <= s.r * s.r) return true;
  }
  return false;
}
