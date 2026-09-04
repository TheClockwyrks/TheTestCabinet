// Wick — the placement, the second part of phase 5 (specs/world.md "One
// tick", specs/weapons.md "Halo", "Lantern", specs/evolutions.md
// "Chandelier", "Corona").
//
// On every `playing` tick, whatever the driver switches hold: the aura of
// Halo or Corona and the lantern set of Chandelier are created on a tick
// their weapon is held and none exists, removed on a tick it is no longer
// held, re-centered about the lamplighter's position of this tick, and
// resized from the level, `areaMul`, and `damageMul` in force. Lantern's
// lanterns ride their orbit about the lamplighter with the figures they
// were created with.

import type { WeaponId } from "../constants";
import type { WeaponSlot, RunState, ZoneState } from "../state";
import { areaMul, damageMul } from "../stats";
import type { TickContext } from "./context";
import { amountOf, makeLantern, placeLantern, rowFor } from "./weapons";

const AURA_WEAPONS: readonly WeaponId[] = ["halo", "corona"];

function heldAmong(
  run: RunState,
  ids: readonly WeaponId[],
): WeaponSlot | undefined {
  return run.weapons.find((weapon) => ids.includes(weapon.id));
}

/** The aura: one zone of kind `aura` while Halo or Corona is held. */
function placeAura(run: RunState): void {
  const held = heldAmong(run, AURA_WEAPONS);
  run.zones = run.zones.filter(
    (zone) => zone.kind !== "aura" || zone.weapon === held?.id,
  );
  if (!held) return;
  let aura = run.zones.find((zone) => zone.kind === "aura");
  if (!aura) {
    aura = {
      id: run.nextId,
      weapon: held.id,
      kind: "aura",
      x: 0,
      y: 0,
      radius: 0,
      damage: 0,
      ttl: null,
      hits: [],
      bornTick: run.tick,
    };
    run.nextId += 1;
    run.zones.push(aura);
  }
  const row = rowFor(held.id, held.level);
  aura.x = run.player.x;
  aura.y = run.player.y;
  aura.radius = (row.radius ?? 0) * areaMul(run.passives);
  aura.damage = row.damage * damageMul(run.passives);
}

/** The Chandelier lanterns in the world, lowest id first. */
function chandelierLanterns(run: RunState): ZoneState[] {
  return run.zones
    .filter((zone) => zone.kind === "lantern" && zone.weapon === "chandelier")
    .sort((a, b) => a.id - b.id);
}

/**
 * Chandelier's set: created on a tick it is held and none exists, in place
 * of any Lantern lanterns; replaced when its amount differs from the count;
 * removed on a tick it is no longer held; resized every tick.
 */
function placeChandelier(run: RunState): void {
  const held = heldAmong(run, ["chandelier"]);
  if (!held) {
    run.zones = run.zones.filter(
      (zone) => !(zone.kind === "lantern" && zone.weapon === "chandelier"),
    );
    return;
  }
  const row = rowFor(held.id, held.level);
  const amount = amountOf(run, held.id, row);
  const orbit = (row.orbit ?? 0) * areaMul(run.passives);
  const radius = (row.radius ?? 0) * areaMul(run.passives);
  const damage = row.damage * damageMul(run.passives);
  let lanterns = chandelierLanterns(run);
  if (lanterns.length === 0) {
    run.zones = run.zones.filter((zone) => zone.kind !== "lantern");
    lanterns = [];
    for (let i = 0; i < amount; i += 1) {
      lanterns.push(
        makeLantern(
          run,
          held.id,
          (i * 360) / amount,
          orbit,
          radius,
          damage,
          null,
        ),
      );
    }
    run.zones.push(...lanterns);
  } else if (lanterns.length !== amount) {
    const from = lanterns[0].angle ?? 0;
    run.zones = run.zones.filter((zone) => !lanterns.includes(zone));
    lanterns = [];
    for (let i = 0; i < amount; i += 1) {
      lanterns.push(
        makeLantern(
          run,
          held.id,
          from + (i * 360) / amount,
          orbit,
          radius,
          damage,
          null,
        ),
      );
    }
    run.zones.push(...lanterns);
  }
  for (const lantern of lanterns) {
    lantern.orbit = orbit;
    lantern.radius = radius;
    lantern.damage = damage;
    placeLantern(run, lantern);
  }
}

/**
 * Phase 5, the placement, on every `playing` tick: the aura and the
 * Chandelier set follow their weapons, and every lantern's center is placed
 * on its orbit about the lamplighter's position of this tick.
 */
export function placePermanents(ctx: TickContext): void {
  const { run } = ctx;
  placeAura(run);
  placeChandelier(run);
  for (const zone of run.zones) {
    if (zone.kind === "lantern" && zone.weapon === "lantern") {
      placeLantern(run, zone);
    }
  }
}
