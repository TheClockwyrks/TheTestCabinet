// abilities/rectifier-burn-rate — the burn takes half the shot off, every second.
//
// specs/components.md fixes the rate: "The Rectifier's hit applies a burn of
// `shotDamage * RECTIFIER_BURN_FRAC` (`0.5`) per second", flat at every tier, so
// the burn climbs with the shot. specs/enemies.md fixes what a burn does: "While
// `now < burnUntil` the unit loses `burnDps` health per second, integrated against
// the update's delta time."
//
// The Rectifier is taken off the yard the moment its shot lands, because it fires
// again roughly every nine-tenths of a second and a fresh hit would reset the
// figure being measured. Two readings decide it: the `burnDps` the unit carries is
// exactly half the shot's damage, and the health it actually loses over the next
// second is that figure. The health reading carries the slack one update of
// integration can leave, which is what "integrated against the update's delta
// time" costs a check that fixes no update rate.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertCloseTo } from "../assert";
import {
  componentDamage,
  RECTIFIER_BURN_DUR,
  RECTIFIER_BURN_FRAC,
} from "../constants";
import {
  captureReplay,
  createHarness,
  type Harness,
  openYard,
  parkUnit,
  standComponent,
  structureById,
  unitById,
} from "../harness";
import { awaitEffect } from "./impact";

const ANCHOR = { col: 10, row: 10 };

/** Inside the Charged Rectifier's `112`. */
const TARGET_RANGE = 60;

/** The tier the rate is read at: an `18` shot, so a `9` a second burn. */
const TIER = 3;

/** The window the health is watched over, inside the burn's own duration. */
const WINDOW = 1;

/** The burn a tier 3 Rectifier applies. */
const DPS = componentDamage("rectifier", TIER) * RECTIFIER_BURN_FRAC;

/** What one update of integration can leave either side of the figure. */
const SLACK = DPS * 0.05;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("burns at half the shot's damage a second for as long as it is watched", async () => {
  openYard(h, { wave: 1 });
  const id = standComponent(h, "rectifier", TIER, ANCHOR.col, ANCHOR.row);
  const structure = structureById(h.snapshot(), id);
  const target = parkUnit(h, "dynamo", {
    x: structure.cx + TARGET_RANGE,
    y: structure.cy,
  });

  const burnt = await captureReplay(h, "burn", async () => {
    const struck = await awaitEffect(h, target, (unit) => unit.burnDps > 0);
    // Nothing may refresh the burn while its own rate is being measured.
    h.debug.clearStructures();
    h.debug.clearProjectiles();
    const opened = unitById(h.snapshot(), target);
    await h.advanceSeconds(WINDOW);
    return { struck, opened, closed: unitById(h.snapshot(), target) };
  });

  assertCloseTo(
    unitById(burnt.struck, target).burnDps,
    DPS,
    6,
    `the burn a tier ${TIER} Rectifier applies: its ` +
      `${componentDamage("rectifier", TIER)} shot times ` +
      `${RECTIFIER_BURN_FRAC} (specs/components.md)`,
  );
  assertBetween(
    burnt.opened.hp - burnt.closed.hp,
    DPS * WINDOW - SLACK,
    DPS * WINDOW + SLACK,
    `the health the burn removed over ${WINDOW}s of its ` +
      `${RECTIFIER_BURN_DUR}s, at ${DPS} a second (specs/enemies.md)`,
  );
});
