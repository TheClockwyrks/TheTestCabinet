// Arc Foundry — effects/leak-alarm: a unit grounding out surges at the collector.
//
// THE REQUIREMENT, from `specs/assets.md`: the leak alarm is spawned when "a unit
// grounds out at the collector", it carries "a warning surge at the collector", and
// it is spawned "at the position of the event that raised it: ... the leak alarm at
// the collector".
//
// THE WORLD. One Mote walking the last stretch into the collector, and one further
// Mote held at the map's entry so the wave cannot clear in the middle of the
// reading. There is no structure on the yard at all, so nothing can shoot the
// walker and nothing else can move a pixel near the sink.
//
// WHAT IS READ, AND WHERE. The collector, in the two readings a surge "at the
// collector" can land in: the sink's OWN ground, and the ground either side of
// the last leg. `specs/assets.md` fixes no size for the surge, so a build that
// plays it tight against the sink and a build that throws it out across the
// ground either side have both played it where the item names, and the point asks
// that EITHER reading move — which is the whole of what the item requires, and no
// more. Reading only one of the two asks a build for a reach the specification
// does not fix.
//
// BOTH ARE COMPARISONS AGAINST THEMSELVES. Each region is read once over bare
// ground before the walker is released and once after it has grounded out, and
// what decides the point is a rise in one of them. `specs/yard.md` puts the
// collector on the map's edge and the sink is a thing a build may animate on its
// own — a collector that hums, a flow marker running the last leg — so a region
// that was already moving is asked to move MORE rather than asked to have been
// still. The walking unit's own sprite is out of both readings by the time the
// second is taken: it grounds out and is gone.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { mapById, START_INTEGRITY, tileCenter } from "../constants";
import {
  captureReplay,
  createHarness,
  holdWaveOpen,
  openYard,
  releaseUnit,
  ticks,
  type Harness,
} from "../harness";
import { lattice, motionEach } from "./region";

const SINK = (() => {
  const map = mapById("substation");
  return tileCenter(map.collector.col, map.collector.row);
})();

/**
 * The collector's own ground: a lattice over the `40 x 40` collector of
 * `specs/assets.md` and the ground immediately around it.
 */
const AT_SINK = lattice(SINK, 24, 4);

/**
 * The ground either side of the last leg, above and below the sink and inside
 * the board.
 *
 * Off the route rather than along it: `specs/assets.md` has the build draw "the
 * waypoint order numbers and the flow toward the collector" in code, and a flow
 * marker moving along the route is a legitimate thing for that ground to be doing
 * whether or not a unit ever leaks. The last leg of the substation's chain runs
 * level into the sink, so this reading is taken clear of that leg.
 */
const BESIDE_SINK = (() => {
  const points: { x: number; y: number }[] = [];
  for (let dx = -26; dx <= 6; dx += 4) {
    for (const band of [-1, 1]) {
      for (let d = 26; d <= 54; d += 4) {
        points.push({ x: SINK.x + dx, y: SINK.y + band * d });
      }
    }
  }
  return points;
})();

/** Both readings, in the order the failure names them. */
const REGIONS = [AT_SINK, BESIDE_SINK];

const WINDOW = ticks(0.1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sets the collector moving when a unit grounds out", async () => {
  await openYard(h, { map: "substation", wave: 1 });
  await holdWaveOpen(h);
  await h.advance(1);
  const bare = await motionEach(h, REGIONS, WINDOW);

  // Released heading for the collector and left to walk in on its own legs, so
  // the leak is the game's rather than the reading's.
  await releaseUnit(h, "mote", {
    waypoint: 7,
    at: { x: SINK.x - 60, y: SINK.y },
  });

  const played = await captureReplay(h, "leak", async () => {
    const leaked = await h.until((s) => s.integrity < START_INTEGRITY, {
      maxFrames: ticks(6),
    });
    return {
      leaked: leaked.hit,
      moving: await motionEach(h, REGIONS, WINDOW),
    };
  });

  assertEqual(
    played.leaked,
    true,
    "a Mote released sixty units short of the collector and heading for it to " +
      "ground out within six seconds (specs/pathing.md)",
  );
  const rose = played.moving.some((after, at) => after > bare[at]!);
  assertEqual(
    rose,
    true,
    "whether the collector changed on more frames after a unit grounded out " +
      "than it did while nothing was there, in the sink's own ground or in the " +
      "ground either side of the last leg, so a leak alarm is played at it " +
      `(specs/assets.md); before it read ${bare.join(", ")} of ${WINDOW} ` +
      `frames and after it read ${played.moving.join(", ")}`,
  );
});
