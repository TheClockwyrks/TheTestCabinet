// Wick — instrumentation/overlay-sources: the debug overlay, once shown,
// reports the registered diagnostics, each with the live value the snapshot
// reports.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "Diagnostics"):
// "Register at least the current `screen`, the run clock, the level with `xp`
// over `xpToNext`, `hp` over `maxHp`, the kill count, the lamplighter's
// position and facing, the enemy count with the spawn window index, the
// projectile and zone counts, the gem count, the held weapons with their
// levels and cooldowns, the held passives with their levels,
// `pendingLevelUps`, and the seven driver switches, the same facts the
// snapshot reports." The run clock is shown "as `m:ss`" (specs/ui.md). The
// overlay's medium is the build's, so what it shows is read as text: the runs
// the toggled frame drew beyond the untoggled one, and any text the document
// gained. The specification fixes the facts and not their wording, so each
// fact is looked for as its value, folded for case, spacing, and dashes.
//
// WHY THE WORLD IS POSED AS IT IS. Every fact is posed to a value that is not
// the fresh run's, so a readout of defaults fails; the run is then paused so
// the frame the toggle runs ticks nothing and the values on show are the ones
// posed. Single-digit counts are posed as well but are weak evidence on their
// own; the named values carry the check.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { clockText, SWITCH_NAMES } from "../constants";
import {
  addedText,
  captureStill,
  createHarness,
  folded,
  holdPassive,
  holdWeapon,
  isolate,
  placeEnemy,
  placeGem,
  placeProjectile,
  placePuddle,
  poseScreen,
  pressOverlayToggle,
  readout,
  type Harness,
} from "../harness";

const POSED = {
  tick: 4500,
  level: 7,
  xp: 12,
  hp: 77,
  kills: 250,
  x: 300,
  y: -120,
  weaponLevel: 3,
  cooldown: 0.7,
  passiveLevel: 2,
  pending: 3,
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("shows the registered diagnostics with their live values", async () => {
  await isolate(h);
  await h.debug.setTick(POSED.tick);
  await h.debug.setLevel(POSED.level);
  await h.debug.setXp(POSED.xp);
  await h.debug.setHp(POSED.hp);
  await h.debug.setKills(POSED.kills);
  await h.debug.setPlayerPosition(POSED.x, POSED.y);
  await h.debug.setFacing("left");
  await placeEnemy(h, "moth", 200, 0);
  await placeEnemy(h, "bat", -200, 0);
  await placeEnemy(h, "rat", 0, 200);
  await placeProjectile(h, "ember", 100, 0, 400, 0, 0);
  await placeProjectile(h, "pin", -100, 0, -600, 0, 1);
  await placePuddle(h, "oil-splash", 50, 50);
  for (let i = 0; i < 4; i += 1) await placeGem(h, "small", 300 + 20 * i, 300);
  const slot = await holdWeapon(h, "ember", POSED.weaponLevel);
  await h.debug.setWeaponCooldown(slot, POSED.cooldown);
  await holdPassive(h, "bellows", POSED.passiveLevel);
  await h.debug.setPendingLevelUps(POSED.pending);
  await h.debug.setDespawning(false);
  const paused = await poseScreen(h, "paused");
  assertEqual(paused.screen, "paused", "the screen the overlay is read on");

  await h.step(1);
  const before = await readout(h);
  await pressOverlayToggle(h);
  const shown = await readout(h);
  await captureStill(h, "sources");
  const text = folded(addedText(before, shown).join("\n"));

  const facts: [string, string][] = [
    ["the screen", "paused"],
    ["the run clock", clockText(POSED.tick)],
    ["the level", String(POSED.level)],
    ["xp", String(POSED.xp)],
    ["xpToNext", String(paused.run.xpToNext)],
    ["hp", String(POSED.hp)],
    ["maxHp", String(paused.run.maxHp)],
    ["the kill count", String(POSED.kills)],
    ["the lamplighter's x", String(POSED.x)],
    ["the lamplighter's y", String(POSED.y)],
    ["facing", "left"],
    ["the spawn window", String(paused.run.spawnWindow)],
    ["the held weapon", "ember"],
    ["the held weapon's cooldown", String(POSED.cooldown)],
    ["the held passive", "bellows"],
    ["pendingLevelUps", String(POSED.pending)],
    ...SWITCH_NAMES.map((name): [string, string] => [`the ${name} switch`, name]),
  ];
  for (const [what, value] of facts) {
    assertTrue(
      text.includes(folded(value)),
      `the overlay showing ${what} as ${JSON.stringify(value)}`,
    );
  }
});
