// build-panel/inspector-reads-the-selection — the inspector reads what is selected.
//
// `specs/hud.md` fixes what the inspector shows for each kind of selection: for a
// base candidate or component, "its type, its quality tier, a one-line
// description, and its live damage, range, fire rate, and targeting priority,
// plus its kills and total damage dealt when it fires"; for a combination tower,
// "its name, its upgrade level, its one-line description, its live damage, range,
// fire rate, targeting priority, and abilities, and its kills and total damage
// dealt".
//
// Every figure below is the specification's own. `specs/components.md` scales a
// Charged Capacitor to `54` damage over `116` range at a flat `1.6` a second, and
// defaults every firing structure to `first`. `specs/combinations.md` gives the
// Fork Array a reference block of `100` over `118` at `1.8` with `multishot`, and
// scales a level-`2` tower to `damage * 0.78` over `range + 8`. The one-line
// description is not checked: `specs/combinations.md` fixes the twelve towers'
// copy but no constant carries it, and no specification fixes a base component's.
//
// THE TALLIES. Read against what the structure has actually dealt, not against a
// figure this suite posed: one unit is parked in range at a wave deep enough that
// nothing it is shot with can kill it, the game fires for two seconds of its own,
// and the tally the snapshot reports has to be the tally the panel drew. Each
// half runs on a yard holding one structure and one unit and nothing else.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  drawnFigure,
  drew,
  emptyYard,
  figures,
  type Harness,
  openYard,
  PANEL,
  parkUnit,
  standCombo,
  standComponent,
  structureById,
} from "../harness";
import {
  comboDamage,
  comboDef,
  comboRange,
  COMPONENT_NAMES,
  componentDamage,
  componentFireRate,
  componentRange,
  DEFAULT_TARGETING,
  QUALITY_TIERS,
  structureCenter,
} from "../constants";

/** Deep enough that neither structure below can kill what it shoots at. */
const WAVE = 30;
const ANCHOR = { col: 10, row: 10 };
const TARGET = {
  x: structureCenter(10, 10).x + 80,
  y: structureCenter(10, 10).y,
};

/**
 * The rate the two firing spans are driven at.
 *
 * They are frames spent letting a cadence run rather than frames anything is read
 * on, and specs/instrumentation.md guarantees that "an interval of simulation time
 * reaches the same state however it was divided into frames". A shot still steps
 * well inside the `2 * PROJECTILE_HIT_R` window it has to be caught in.
 */
const FIRE_HZ = 60;

/** How long each structure is let fire for, in seconds of simulation. */
const FIRE_SECONDS = 2;

const TYPE = "capacitor";
const TIER = 3;
const COMBO = "forkarray";
const LEVEL = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ hz: FIRE_HZ });
});

afterEach(() => {
  h.dispose();
});

/** Let the selected structure fire on a parked unit for `FIRE_SECONDS`. */
async function fireAt(id: number): Promise<void> {
  parkUnit(h, "dynamo", TARGET);
  await h.advanceSeconds(FIRE_SECONDS);
  h.debug.select(id);
}

it("draws the stats and tallies of a base component and of a tower", async () => {
  openYard(h, { wave: WAVE });

  const component = standComponent(h, TYPE, TIER, ANCHOR.col, ANCHOR.row);
  await fireAt(component);

  const base = await h.frameCalls();
  captureStill(h, "inspector");
  const baseState = structureById(h.snapshot(), component);

  assertEqual(
    drew(base, PANEL, COMPONENT_NAMES[TYPE]),
    true,
    "whether the panel names the type",
  );
  assertEqual(
    drew(base, PANEL, QUALITY_TIERS[TIER - 1]!.name),
    true,
    "whether the panel names the quality tier",
  );
  assertEqual(
    drew(base, PANEL, DEFAULT_TARGETING),
    true,
    "whether the panel names the targeting priority",
  );
  const baseFigures = figures(base, PANEL);
  assertContains(
    baseFigures,
    componentDamage(TYPE, TIER),
    "the panel's figures with a Charged Capacitor selected",
  );
  assertContains(
    baseFigures,
    componentRange(TYPE, TIER),
    "the panel's figures with a Charged Capacitor selected",
  );
  assertContains(
    baseFigures,
    componentFireRate(TYPE),
    "the panel's figures with a Charged Capacitor selected",
  );
  assertContains(baseFigures, baseState.kills, "the kills the panel draws");
  drawnFigure(
    base,
    PANEL,
    baseState.damageDealt,
    "the damage the Capacitor has dealt",
    1,
  );

  // The same again, for a combination tower on a yard cleared back to nothing.
  emptyYard(h);
  const tower = standCombo(h, COMBO, ANCHOR.col, ANCHOR.row, LEVEL);
  await fireAt(tower);

  const combo = await h.frameCalls();
  const towerState = structureById(h.snapshot(), tower);

  assertEqual(
    drew(combo, PANEL, comboDef(COMBO).name),
    true,
    "whether the panel names the combination tower",
  );
  // The ability NAMES are the keys of the tower's ability block
  // (`specs/combinations.md` names each ability and its parameters, and
  // `../constants` transcribes them under those names).
  for (const ability of Object.keys(comboDef(COMBO).abilities)) {
    assertEqual(
      drew(combo, PANEL, ability),
      true,
      `whether the panel names the tower's \`${ability}\` ability`,
    );
  }
  const comboFigures = figures(combo, PANEL);
  assertContains(comboFigures, LEVEL, "the upgrade level the panel draws");
  assertContains(
    comboFigures,
    comboDamage(COMBO, LEVEL),
    "the panel's figures with a level-2 Fork Array selected",
  );
  assertContains(
    comboFigures,
    comboRange(COMBO, LEVEL),
    "the panel's figures with a level-2 Fork Array selected",
  );
  assertContains(
    comboFigures,
    comboDef(COMBO).fireRate,
    "the panel's figures with a level-2 Fork Array selected",
  );
  assertContains(comboFigures, towerState.kills, "the kills the panel draws");
  drawnFigure(
    combo,
    PANEL,
    towerState.damageDealt,
    "the damage the Fork Array has dealt",
    1,
  );
});
