// Arc Foundry — effects/bolt-trail: a travelling bolt trails between the head and
// the target.
//
// THE REQUIREMENT, from `specs/assets.md`: the arc bolt is spawned while "a
// Capacitor, Choke, Rectifier, or Discharge Rig projectile travels", it carries "a
// crackling bolt trail from the head to the target", and it is spawned "at the
// position of the event that raised it: ... the bolt along the line from a firing
// head to its target".
//
// WHAT IS READ, AND HOW THE PROJECTILE ITSELF IS KEPT OUT OF IT. The line between
// the head and the target is exactly the line the projectile travels down, so a
// reading taken while the shot is passing through the sampled span would be
// satisfied by the `12 x 12` projectile sprite of `specs/assets.md` alone — a build
// that plays no trail at all would pass. The span sampled is therefore the near
// half of the line, and readings are kept only on the frames the projectile has
// already passed twenty units beyond its far end. What can be drawn on that span at
// that moment is the trail and nothing else.
//
// THE COMPARISON IS AGAINST THE SAME LINE BEFORE THE SHOT, which is the second
// half of the requirement — "none are drawn on that line before the shot". The
// yard holds one Charged Capacitor and one held Slug and nothing else, so the line
// is empty ground until the structure fires.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { structureCenter } from "../constants";
import {
  captureReplay,
  createHarness,
  openYard,
  parkUnit,
  standComponent,
  ticks,
  type Harness,
} from "../harness";
import { read, scanWhen } from "./region";

/** Clear ground, well away from the map's waypoint platforms and its chain. */
const ANCHOR = { col: 21, row: 17 };
const HEAD = structureCenter(ANCHOR.col, ANCHOR.row);

/** A hundred and five units away, inside the Charged Capacitor's stated range of `116`. */
const AT = { x: HEAD.x + 105, y: HEAD.y };

/** The near half of the line, clear of the structure's own `2` by `2` footprint. */
const SPAN = { from: 26, to: 54 };
const POINTS = (() => {
  const points: { x: number; y: number }[] = [];
  for (let d = SPAN.from; d <= SPAN.to; d += 4) {
    points.push({ x: HEAD.x + d, y: HEAD.y });
  }
  return points;
})();

/** How far past the span the shot must be before a reading counts. */
const CLEAR = 20;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws on the line behind a travelling shot, and nothing on it before", async () => {
  await openYard(h, { wave: 1 });
  await standComponent(h, "capacitor", 3, ANCHOR.col, ANCHOR.row);
  await parkUnit(h, "slug", AT);
  await h.advance(1);
  const before = await read(h, POINTS);

  const flight = await captureReplay(h, "bolt", async () => {
    const shot = await h.until((s) => s.projectiles.length > 0, {
      maxFrames: ticks(3),
    });
    const readings = await scanWhen(h, POINTS, ticks(0.25), (s) =>
      s.projectiles.some(
        (projectile) => projectile.x > HEAD.x + SPAN.to + CLEAR,
      ),
    );
    return { fired: shot.hit, readings };
  });

  assertEqual(
    flight.fired,
    true,
    "a Charged Capacitor with a unit inside its range to fire within three " +
      "seconds (specs/components.md)",
  );
  assertGreaterThan(
    flight.readings.length,
    0,
    "the shot to travel past the sampled span while still in flight, so the " +
      "line can be read behind it (specs/components.md)",
  );
  assertGreaterThan(
    flight.readings.filter((reading) => reading !== before).length,
    0,
    "the line between the head and the target to be drawn on while the shot " +
      "travels down it, having been bare before the shot, so a bolt trail is " +
      "played along it (specs/assets.md)",
  );
});
