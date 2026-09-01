// director/elites-spawn-at-spawn-point — the night's three arrivals come in
// off the ring.
//
// THE SPEC LINE. `specs/enemies.md`, "Scripted events", names the place in
// each of the three rows: "Mothwing spawns at a spawn point", "Owl spawns at a
// spawn point", "The Dark spawns at a spawn point". "The spawn ring" says what
// a spawn point is: "`SPAWN_DISTANCE` (`760`) units from the lamplighter's
// center at an angle drawn uniformly from the seeded generator". The angle is
// drawn and the distance is not, so the distance is what a check holds a build
// to.
//
// WHY ALL THREE ARE ONE ITEM. They are one requirement — an elite event's
// arrival stands on the ring — read three times because the specification
// states it three times. A build that placed one of them at the lamplighter's
// feet, or at the edge of the view rather than the ring, fails here whichever
// of the three it was.
//
// WHY THE LAMPLIGHTER STANDS AWAY FROM THE ORIGIN. The ring is written around
// `player.x` and `player.y`, so a build that spawns about the origin passes at
// `(0, 0)` and fails here.
//
// THE DRIVE. One isolated world with `events` alone on, its clock posed one
// tick short of each of the three arrivals in turn and stepped across.
// `enemyMotion` is off, so each stays where it arrived and the earlier
// arrivals cannot drift into the later readings; `despawning` is off, though
// the three stand outside that rule anyway. The events the posed clock skips
// never fire, so each step's arrival is the one the row names.
//
// THE TOLERANCE. `REAL_EPS`: a cosine and a sine of a drawn angle against 760,
// read back through a hypotenuse.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { EVENTS, REAL_EPS, SPAWN_DISTANCE } from "../constants";
import {
  captureStill,
  createHarness,
  distance,
  enable,
  isolate,
  type Harness,
} from "../harness";
import { driveArrivals, eventTick } from "./spawns";

/** The three rows of EVENTS that spawn one enemy at a spawn point. */
const ARRIVALS = [EVENTS[1], EVENTS[5], EVENTS[6]];

/** Where the lamplighter stands: neither the origin nor a round point. */
const PLAYER_X = 421.25;
const PLAYER_Y = 168.75;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("spawns the 2:00 mothwing, the 7:30 owl, and the 9:00 Dark 760 units from the lamplighter", async () => {
  isolate(h);
  h.debug.setPlayerPosition(PLAYER_X, PLAYER_Y);
  enable(h, "events");

  for (const event of ARRIVALS) {
    h.debug.setTick(eventTick(event.time) - 1);
    const drive = await driveArrivals(h, 1);
    captureStill(h, "ring");

    assertEqual(
      drive.arrivals.length,
      1,
      `the enemies the ${event.time} s event spawned`,
    );
    const arrival = drive.arrivals[0];
    assertEqual(
      arrival.enemy.type,
      event.kind,
      `the type the ${event.time} s event spawned`,
    );
    assertNear(
      distance(arrival.enemy, arrival.player),
      SPAWN_DISTANCE,
      REAL_EPS,
      `the ${event.kind}: its distance from the lamplighter on the tick it spawned`,
    );
  }
});
