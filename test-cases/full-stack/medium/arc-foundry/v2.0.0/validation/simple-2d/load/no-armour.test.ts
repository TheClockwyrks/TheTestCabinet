// load/no-armour — every firing type removes health from every unit type.
//
// specs/enemies.md, among the rules every unit obeys: "Every firing component
// hits ground and flying units alike. There is no armor and no damage type: a
// shot removes health from any unit, and no unit resists or is immune."
// specs/components.md gives seven of the eight base types a range, a cadence and
// a damage figure, and the eighth — the Regulator — "never fires", so the matrix
// this check drives is those seven against the roster's six.
//
// SIX PAIRS AT ONCE, EACH OUT OF EVERY OTHER'S REACH. A round stands six towers of
// ONE firing type, one at each anchor, and holds one unit of each of the six
// roster types `40` units from its own tower's center. The anchors are `240` apart
// in both directions: the longest reach in the table is the Discharge Rig's `160`,
// so the nearest foreign unit, `200` away, is outside it, and the longest splash
// and the longest chain leap are shorter still. Every tower therefore has exactly
// one unit it can fire at, and the health that unit loses came from that tower.
//
// SEVEN ROUNDS, ONE PER FIRING TYPE, with the yard cleared of structures and units
// between them — so each round's towers are freshly stood up and each round's six
// pairs are the whole of what is on the yard. Every unit is held, so none walks out
// of reach, and the wave is deep enough that the health posed is far past what one
// shot of a Scrap-tier component removes: what is read is that health FELL, which
// is the rule, rather than by how much, which is the components' own checks.
//
// WHY THE ROUNDS ARE THE FIRING TYPES AND NOT THE UNIT TYPES. Each of the seven has
// to land six shots, one on each roster type, and a cadence is a wait between two
// shots of the SAME tower: six shots from one Discharge Rig is six turns of the
// slowest cadence in the table, twelve seconds of simulation for one row of the
// matrix. Six Rigs land those six shots in one turn. The sample is unchanged — the
// same forty-two pairs, each still decided by a real shot from a real structure —
// and what goes is the waiting.
//
// A ROUND ENDS THE FRAME THE LAST OF ITS SIX IS STRUCK, rather than at a fixed
// wait, so a build whose structures fire as soon as they have a target pays the
// flight of a shot and nothing more. The CEILING each round is bounded by is that
// type's own honest worst case, computed from this project's constants: a full turn
// of ITS cadence — for a build that arms a freshly placed structure with a full
// cooldown — plus the flight of its shot over {@link REACH}. A tower that never
// fires at all still fails, by name, with the pair it broke on.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  FIRING_TYPES,
  LOAD_TYPES,
  PROJECTILE_SPEED,
  componentFireRate,
  type ComponentType,
  type LoadType,
  structureCenter,
} from "../constants";
import {
  captureReplay,
  createHarness,
  emptyYard,
  type Harness,
  openYard,
  parkUnit,
  standComponent,
  TICK_HZ,
  unitById,
} from "../harness";

/**
 * Six anchors, `240` units apart in both directions and clear of the
 * Substation's platforms, its entry and its collector.
 */
const ANCHORS = [
  { col: 5, row: 8 },
  { col: 17, row: 8 },
  { col: 29, row: 8 },
  { col: 41, row: 8 },
  { col: 5, row: 20 },
  { col: 17, row: 20 },
];

/** How far a unit stands from its own tower's center. */
const REACH = 40;

/** A wave whose health is far past what one shot of Scrap tier removes. */
const WAVE = 45;

/** How long a shot fired at a unit {@link REACH} away is in flight, in seconds. */
const FLIGHT = REACH / PROJECTILE_SPEED;

/** Frames between two readings of a round. */
const POLL = 2;

/**
 * The ceiling a round of `type` is bounded by: one full turn of that type's
 * cadence, for a build that arms a freshly placed structure with a full cooldown,
 * plus the flight of its shot, in whole frames with one frame's grace.
 */
function strikeFrames(type: ComponentType): number {
  return Math.ceil((1 / componentFireRate(type) + FLIGHT) * TICK_HZ) + 1;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("removes health from every Load type with every firing type", async () => {
  openYard(h, { wave: WAVE });

  const struck = await captureReplay(h, "matrix", async () => {
    const rows: { unit: LoadType; gun: string; lost: number }[] = [];
    for (const gun of FIRING_TYPES) {
      emptyYard(h);
      const posed = LOAD_TYPES.map((unit, index) => {
        const anchor = ANCHORS[index]!;
        const center = structureCenter(anchor.col, anchor.row);
        standComponent(h, gun, 1, anchor.col, anchor.row);
        return {
          unit,
          id: parkUnit(h, unit, { x: center.x + REACH, y: center.y }),
        };
      });
      const opening = h.snapshot();
      const hpAt = new Map(
        posed.map(({ id }) => [id, unitById(opening, id).hp]),
      );
      // Stops the frame the last of the six is struck; the ceiling is what a
      // build whose towers never fire is failed against.
      const swept = await h.until(
        (s) =>
          posed.every(({ id }) => {
            const live = s.units.find((view) => view.id === id);
            return live === undefined || live.hp < hpAt.get(id)!;
          }),
        { maxFrames: strikeFrames(gun), poll: POLL },
      );
      const after = swept.snapshot;
      for (const { unit, id } of posed) {
        rows.push({
          unit,
          gun,
          lost:
            hpAt.get(id)! -
            (after.units.some((live) => live.id === id)
              ? unitById(after, id).hp
              : 0),
        });
      }
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
      `a ${row.gun} at Scrap removes health from a ${row.unit} within a full ` +
        `turn of its own cadence and the flight of its shot; it removed ` +
        `${row.lost}`,
    );
  }
});
