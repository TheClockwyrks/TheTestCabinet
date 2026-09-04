// Arc Foundry — effects/leak-alarm: a unit grounding out surges at the collector.
//
// THE REQUIREMENT, from `specs/assets.md`: the leak alarm is spawned when "a unit
// grounds out at the collector", it carries "a warning surge at the collector", and
// it is spawned "at the position of the event that raised it: ... the leak alarm at
// the collector".
//
// THE PRODUCED SYSTEMS ARE SERVED TO THE LOADER HERE, by `./produced.ts`, so what
// plays is the file the build committed.
//
// THE WORLD. One Mote walking the last stretch into the collector, and one further
// Mote held at the map's entry so the wave cannot clear in the middle of the
// reading. There is no structure on the yard at all, so nothing can shoot the
// walker and nothing else can move a pixel near the sink.
//
// WHAT IS READ, AND WHERE. The ground beside the collector, on the side the Load
// arrives from. `specs/yard.md` puts the collector on the map's edge, so the
// reading is taken inside the board rather than as a disc about the sink, and the
// walking unit's own sprite is out of the reading by the time it is taken: the
// unit grounds out and is gone, and the ground is bare again. That is why the
// resting reading is taken before the walker is released — both readings are of
// bare ground, so the only thing that can move the second one is the surge.

import { afterEach, beforeEach, it } from "vitest";

import { START_INTEGRITY } from "../../src/constants";
import {
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
} from "../assert";
import {
  captureReplay,
  createHarness,
  holdWaveOpen,
  mapById,
  openYard,
  releaseUnit,
  ticks,
  tileCenter,
  type Harness,
  type Point,
} from "../harness";
import { serveProducedAssets } from "./produced";
import { motion } from "./region";

const SINK = ((): Point => {
  const map = mapById("substation");
  return tileCenter(map.collector.col, map.collector.row);
})();

/**
 * Around the sink, above and below it, and inside the board.
 *
 * Off the route rather than along it: `specs/assets.md` has the build draw "the
 * waypoint order numbers and the flow toward the collector" in code, and a flow
 * marker moving along the route is a legitimate thing for that ground to be doing
 * whether or not a unit ever leaks. The last leg of the substation's chain runs
 * level into the sink, so the reading is taken clear of that leg, in the two bands
 * above and below it that the surge's own ground still covers.
 */
const POINTS = ((): Point[] => {
  const points: Point[] = [];
  for (let dx = -26; dx <= 6; dx += 4) {
    for (const band of [-1, 1]) {
      for (let d = 26; d <= 54; d += 4) {
        points.push({ x: SINK.x + dx, y: SINK.y + band * d });
      }
    }
  }
  return points;
})();

const WINDOW = ticks(0.1);
const MOVING = WINDOW / 2;

let h: Harness;

beforeEach(async () => {
  serveProducedAssets();
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sets the collector moving when a unit grounds out", async () => {
  openYard(h, { map: "substation", wave: 1 });
  holdWaveOpen(h);
  await h.advance(1);
  const bare = await motion(h, POINTS, WINDOW);

  // Released heading for the collector and left to walk in on its own legs, so
  // the leak is the game's rather than the reading's.
  releaseUnit(h, "mote", {
    waypoint: 7,
    at: { x: SINK.x - 60, y: SINK.y },
  });

  const played = await captureReplay(h, "leak", async () => {
    const leaked = await h.until((s) => s.integrity < START_INTEGRITY, {
      maxFrames: ticks(6),
    });
    return { leaked: leaked.hit, moving: await motion(h, POINTS, WINDOW) };
  });

  assertEqual(
    played.leaked,
    true,
    "a Mote released sixty units short of the collector and heading for it to " +
      "ground out within six seconds (specs/pathing.md)",
  );
  assertGreaterThan(
    played.moving,
    bare,
    "the collector to change on more frames after a unit grounds out than it " +
      `did while nothing was there, so a leak alarm is played at it ` +
      `(specs/assets.md); bare ground changed on ${bare} of ${WINDOW} frames`,
  );
  assertGreaterThanOrEqual(
    played.moving,
    MOVING,
    "the collector to keep changing across the tenth of a second after the " +
      "leak, as a live particle system does (specs/assets.md)",
  );
});
