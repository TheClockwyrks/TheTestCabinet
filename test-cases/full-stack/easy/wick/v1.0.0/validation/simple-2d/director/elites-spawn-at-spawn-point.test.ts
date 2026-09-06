// director/elites-spawn-at-spawn-point — the three scripted arrivals land on
// the spawn ring, `SPAWN_DISTANCE` from the lamplighter.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/enemies.md` ("Scripted events"): the rows at 2:00, 7:30, and 9:00
//     read "Mothwing spawns at a spawn point", "Owl spawns at a spawn point",
//     and "The Dark spawns at a spawn point".
//   - `specs/enemies.md` ("The spawn ring"): "A spawn point is
//     `SPAWN_DISTANCE` (`760`) units from the lamplighter's center at an angle
//     drawn uniformly over the full circle: x = player.x + cos(angle) *
//     SPAWN_DISTANCE; y = player.y + sin(angle) * SPAWN_DISTANCE".
//   - `specs/enemies.md` ("The life of an enemy"): "an enemy spawned on a tick
//     sits at its spawn point for that tick and first moves on the next".
//
// WHAT IS READ. Each of the three events is fired in turn, the field emptied
// between them, and the distance from the lamplighter's center to what arrived
// is read on the tick it arrived: 760 every time. The angle is drawn at random,
// so the distance is the whole of what may be asserted. A build that dropped an
// elite on top of the lamplighter, or off the ring, misses by that whole
// distance.
//
// WHY THE NIGHT IS POSED AS IT IS. `events` alone is on, so nothing else is on
// the field to be mistaken for the arrival and nothing moves it off its spawn
// point before it is read. The clock is posed to each event in turn, which
// leaves the events between them unfired, as an event "which the debug
// surface's `setTick` skips over, never fires".
//
// THE PICTURE. What the director spawns lands 760 units out, past the edge of
// the view, so the still is taken after a closing drift that lets it travel in.
// Every reading the assertions use is taken before that drift, and the drift
// cannot fail the item.
//
// TOLERANCE. `FIGURE_TOLERANCE` (1e-9) on the distance: 760 through a cosine
// and a sine, then a hypotenuse.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertWithin } from "../assert";
import {
  EVENTS,
  FIGURE_TOLERANCE,
  SPAWN_DISTANCE,
  type EnemyId,
} from "../constants";
import {
  captureStill,
  createHarness,
  distance,
  enable,
  isolate,
  type Harness,
} from "../harness";
import { closeIn, crossEvent, enemiesOfType } from "./stage";

/** The three scripted arrivals that place one enemy at a spawn point. */
const ARRIVALS: readonly (readonly [number, EnemyId])[] = [
  [EVENTS[1].time, "mothwing"],
  [EVENTS[5].time, "owl"],
  [EVENTS[6].time, "dark"],
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("spawns each scripted elite SPAWN_DISTANCE from the lamplighter", async () => {
  isolate(h);
  enable(h, "events");

  for (const [time, type] of ARRIVALS) {
    h.debug.clearEnemies();
    const pair = await crossEvent(h, time);
    const arrived = enemiesOfType(pair.on, type);
    assertLength(arrived, 1, `the ${type} the ${time}s event spawned`);
    assertWithin(
      distance(arrived[0], pair.on.run.player),
      SPAWN_DISTANCE,
      FIGURE_TOLERANCE,
      `the distance from the lamplighter to the ${type}`,
    );
  }

  await closeIn(h);
  captureStill(h, "ring");
});
