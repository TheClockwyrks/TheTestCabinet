// load/no-armour — every firing type removes health from every unit type.
//
// specs/enemies.md, among the rules every unit obeys: "Every firing component
// hits ground and flying units alike. There is no armor and no damage type: a
// shot removes health from any unit, and no unit resists or is immune."
// specs/components.md gives seven of the eight base types a range, a cadence and
// a damage figure, and the eighth — the Regulator — "never fires", so the matrix
// this check drives is those seven against the roster's six.
//
// SEVEN PAIRS AT ONCE, EACH OUT OF EVERY OTHER'S REACH. Each of the seven types
// stands with one unit `40` units from its center, and the anchors are `240`
// apart in both directions: the longest reach in the table is the Discharge
// Rig's `160`, so the nearest foreign unit, `200` away, is outside it. Every
// tower therefore has exactly one unit it can fire at, and the health that unit
// loses came from that tower.
//
// The six rounds are the six roster types, one round each, with the yard's units
// cleared between them. The window is three seconds, past the slowest cadence in
// the table — the Discharge Rig's one shot every two seconds — plus the flight
// of the shot it fires. Every unit is held, so none walks out of reach, and the
// wave is deep enough that the health posed is far past what three seconds of a
// Scrap-tier component removes: what is read is that health FELL, which is the
// rule, rather than by how much, which is the components' own checks.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { LOAD_TYPES, type LoadType } from "../../src/constants";
import {
  captureReplay,
  createHarness,
  FIRING_TYPES,
  openYard,
  parkUnit,
  standComponent,
  structureCenter,
  unitById,
  type Harness,
} from "../harness";

/**
 * Seven anchors, `240` units apart in both directions and clear of the
 * Substation's platforms, its entry and its collector.
 */
const ANCHORS = [
  { col: 5, row: 8 },
  { col: 17, row: 8 },
  { col: 29, row: 8 },
  { col: 41, row: 8 },
  { col: 5, row: 20 },
  { col: 17, row: 20 },
  { col: 29, row: 20 },
];

/** How far a unit stands from its own tower's center. */
const REACH = 40;

/** A wave whose health is far past what three seconds of Scrap tier removes. */
const WAVE = 45;

/** Three seconds: past the `0.5` /s cadence of the slowest type, and its flight. */
const WINDOW = 360;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("removes health from every Load type with every firing type", async () => {
  openYard(h, { wave: WAVE });

  const guns = new Map<string, { id: number; x: number; y: number }>();
  for (const [index, type] of FIRING_TYPES.entries()) {
    const anchor = ANCHORS[index]!;
    const center = structureCenter(anchor.col, anchor.row);
    guns.set(type, {
      id: standComponent(h, type, 1, anchor.col, anchor.row),
      x: center.x + REACH,
      y: center.y,
    });
  }

  const struck = await captureReplay(h, "matrix", async () => {
    const rows: { unit: LoadType; gun: string; lost: number }[] = [];
    for (const unit of LOAD_TYPES) {
      const posed = new Map<string, number>();
      for (const type of FIRING_TYPES) {
        const gun = guns.get(type)!;
        posed.set(type, parkUnit(h, unit, { x: gun.x, y: gun.y }));
      }
      const opening = h.snapshot();
      await h.advance(WINDOW);
      const after = h.snapshot();
      for (const type of FIRING_TYPES) {
        const id = posed.get(type)!;
        rows.push({
          unit,
          gun: type,
          lost:
            unitById(opening, id).hp -
            (after.units.some((live) => live.id === id)
              ? unitById(after, id).hp
              : 0),
        });
      }
      h.debug.clearUnits();
      h.debug.clearProjectiles();
    }
    return rows;
  });

  assertEqual(
    struck.length,
    FIRING_TYPES.length * LOAD_TYPES.length,
    "every firing type read against every Load type",
  );
  for (const row of struck) {
    assertGreaterThan(
      row.lost,
      0,
      `a ${row.gun} at Scrap removes health from a ${row.unit}; it removed ` +
        `${row.lost}`,
    );
  }
});
