// director/swarm-geometry — a swarm's 24 gnats stand on a line of `SWARM_LINE`
// units, perpendicular to the direction it comes from and centered
// `SPAWN_DISTANCE` along it.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/enemies.md` ("Scripted events"): "A gnat swarm spawns `SWARM_SIZE`
//     (`24`) gnats on the same tick along a line perpendicular to a direction
//     `d`, a unit vector at an angle drawn uniformly over the full circle.
//     The line is `SWARM_LINE` (`720`) units long, centered `SPAWN_DISTANCE`
//     from the lamplighter along `d`, and the gnats are evenly spaced along it
//     with one at each end: center = player + d * SPAWN_DISTANCE; perp =
//     (-dy, dx); spacing = SWARM_LINE / (SWARM_SIZE - 1); gnat i = center +
//     perp * (i - (SWARM_SIZE - 1) / 2) * spacing".
//   - `specs/enemies.md` ("The life of an enemy"): "an enemy spawned on a tick
//     sits at its spawn point for that tick and first moves on the next", so
//     the line is read on the tick it spawned.
//
// WHAT IS READ. The 1:00 swarm on the tick it lands. The angle is drawn at
// random, so `d` is recovered from the line itself: the offsets
// `i - (SWARM_SIZE - 1) / 2` sum to zero across the whole line, so the gnats'
// centroid is the line's center and the unit vector to it from the lamplighter
// is `d`. Three readings follow from that: the center sits `SPAWN_DISTANCE`
// from the lamplighter; every gnat lies on the line through it perpendicular to
// `d`, its component along `d` zero; and the 24 offsets across that line, taken
// in order, are `(i - 11.5) × 720 / 23`, which puts one gnat at each end and
// spaces the rest evenly between.
//
// WHY THE NIGHT IS POSED AS IT IS. `events` alone is on, so the 24 gnats on the
// field are the swarm and nothing else, and nothing moves them off the line
// before it is measured.
//
// THE PICTURE. What the director spawns lands 760 units out, past the edge of
// the view, so the still is taken after a closing drift that lets it travel in.
// Every reading the assertions use is taken before that drift, and the drift
// cannot fail the item.
//
// TOLERANCE. `MOTION_TOLERANCE` (1e-6) on the positions: each is a stated
// figure through a cosine, a sine, and a sum, and the center is recovered as a
// mean of 24 of them.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertWithin } from "../assert";
import {
  EVENTS,
  MOTION_TOLERANCE,
  SPAWN_DISTANCE,
  SWARM_LINE,
  SWARM_SIZE,
} from "../constants";
import {
  captureStill,
  createHarness,
  distance,
  enable,
  isolate,
  type Harness,
} from "../harness";
import {
  closeIn,
  crossEvent,
  enemiesOfType,
  swarmCenter,
  swarmDirection,
} from "./stage";

/** The 1:00 gnat swarm. */
const SWARM_TIME = EVENTS[0].time;

/** "spacing = SWARM_LINE / (SWARM_SIZE - 1)": 720 / 23. */
const SPACING = SWARM_LINE / (SWARM_SIZE - 1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("lines a swarm up perpendicular to its direction", async () => {
  isolate(h);
  enable(h, "events");

  const pair = await crossEvent(h, SWARM_TIME);
  const gnats = enemiesOfType(pair.on, "gnat");
  await closeIn(h);
  captureStill(h, "line");

  assertLength(gnats, SWARM_SIZE, "the swarm's gnats");

  const { player } = pair.on.run;
  const center = swarmCenter(gnats);
  const d = swarmDirection(gnats, player);
  const perp = { x: -d.y, y: d.x };

  assertWithin(
    distance(center, player),
    SPAWN_DISTANCE,
    MOTION_TOLERANCE,
    "the distance from the lamplighter to the line's center",
  );

  const across: number[] = [];
  for (const gnat of gnats) {
    const dx = gnat.x - center.x;
    const dy = gnat.y - center.y;
    assertWithin(
      dx * d.x + dy * d.y,
      0,
      MOTION_TOLERANCE,
      "a gnat's offset along d, which the line is perpendicular to",
    );
    across.push(dx * perp.x + dy * perp.y);
  }

  across.sort((a, b) => a - b);
  across.forEach((offset, i) => {
    assertWithin(
      offset,
      (i - (SWARM_SIZE - 1) / 2) * SPACING,
      MOTION_TOLERANCE,
      `the offset of gnat ${i} across the line`,
    );
  });
});
