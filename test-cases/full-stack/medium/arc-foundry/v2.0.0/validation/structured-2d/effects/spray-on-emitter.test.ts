// Arc Foundry — effects/spray-on-emitter: an Emitter throws its spark spray.
//
// THE REQUIREMENT, from `specs/assets.md`: the spark spray is spawned when "an
// Emitter fires", it carries "a fast fan of small sparks toward the target", and it
// is spawned at the position of the event that raised it. `specs/components.md`
// makes the Emitter a rapid single-target type, so what marks the event is the
// frame its projectile appears.
//
// THE PRODUCED SYSTEMS REACH THE LOADER THROUGH THE HARNESS, which stands the
// committed `assets/` tree up for every check it builds, so what plays is the
// file the build committed.
//
// WHAT IS READ, AND WHY THE WINDOW IS SHORT. The span sampled is the near stretch
// of the line from the head to the target, clear of the structure's own `2` by `2`
// footprint. The projectile launches "from its center" at `PROJECTILE_SPEED`
// (`520`) units per second (`specs/components.md`), so on the frame of the shot and
// for a few frames after it the shot is still behind the near end of the span: the
// window is exactly those frames, and the `12 x 12` projectile sprite cannot be
// what a reading in it saw.
//
// THE COMPARISON IS AGAINST THE SAME SPAN BEFORE THE SHOT. The yard holds one Scrap
// Emitter and one held Mote and nothing else, so the span is empty ground until the
// structure fires.

import { afterEach, beforeEach, it } from "vitest";
import { type Point, PROJECTILE_SPEED, structureCenter } from "../constants";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureReplay,
  createHarness,
  type Harness,
  openYard,
  parkUnit,
  standComponent,
  TICK_HZ,
  ticks,
} from "../harness";
import { read, scan } from "./region";

/** Clear ground, well away from the map's waypoint platforms and its chain. */
const ANCHOR = { col: 21, row: 17 };
const HEAD = structureCenter(ANCHOR.col, ANCHOR.row);

/** Seventy units away, inside the Scrap Emitter's stated range of `88`. */
const AT = { x: HEAD.x + 70, y: HEAD.y };

/** The near stretch of the line, clear of the `2` by `2` footprint. */
const SPAN = { from: 26, to: 54 };
const POINTS = ((): Point[] => {
  const points: Point[] = [];
  for (let d = SPAN.from; d <= SPAN.to; d += 4) {
    points.push({ x: HEAD.x + d, y: HEAD.y });
  }
  return points;
})();

/**
 * Frames the shot is still short of the span, launched from the centre at
 * `PROJECTILE_SPEED` — the window a reading on the span cannot have seen it in.
 */
const WINDOW = Math.floor((SPAN.from - 6) / (PROJECTILE_SPEED / TICK_HZ));

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws between the head and the target on the frame an Emitter fires", async () => {
  openYard(h, { wave: 1 });
  standComponent(h, "emitter", 1, ANCHOR.col, ANCHOR.row);
  parkUnit(h, "mote", AT);
  await h.advance(1);
  const before = read(h, POINTS);

  const shot = await captureReplay(h, "spray", async () => {
    const fired = await h.until((s) => s.projectiles.length > 0, {
      maxFrames: ticks(2),
    });
    return { fired: fired.hit, readings: await scan(h, POINTS, WINDOW) };
  });

  assertEqual(
    shot.fired,
    true,
    "a Scrap Emitter with a unit inside its range to fire within two seconds, " +
      "at its stated 4.5 shots per second (specs/components.md)",
  );
  assertGreaterThan(
    shot.readings.filter((reading) => reading !== before).length,
    0,
    "the line between an Emitter's head and its target to be drawn on from " +
      "the frame it fires, having been bare before it, so a spark spray is " +
      "played there (specs/assets.md)",
  );
});
