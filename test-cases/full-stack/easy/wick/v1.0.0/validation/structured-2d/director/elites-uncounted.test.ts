// director/elites-uncounted — the elites and the Dark do not fill the field.
//
// THE SPEC LINE. `specs/enemies.md`, "The cap": "`aliveCommons` is the number
// of live enemies of rank `common` other than gnats. Gnats, the elites, and
// the Dark stand outside the cap: they are never counted against it, and they
// spawn whether or not it is full." The roster gives `mothwing` and `owl` rank
// `elite` and `dark` rank `dark`, and says of the three that "each stands
// outside the spawn cap".
// `specs/instrumentation.md` ("Snapshot shape") derives the reported field
// from rank the same way.
//
// WHY IT MATTERS. The mothwing, the owl, and the Dark are on the field for
// minutes at a time and are the slowest things in the night to kill. A build
// that counts them spends the whole late game one to three spawns short of its
// window's cap.
//
// THE READING, IN TWO PLACES. The field is posed with 19 moths and all three
// uncounted ranks — 22 enemies, of which 19 are counted. The snapshot's
// `aliveCommons` is read directly, and the director's own arithmetic is read
// by driving the tick the timer is due on: 19 is under window 0's cap of 20,
// so a moth lands.
//
// THE DRIVE. The isolated world, the clock in window 0, the timer at 0, and
// `spawning` alone on, for one tick. `enemyMotion` and `enemyContact` are off,
// so the three uncounted arrivals stand where they were posed and touch
// nothing.
//
// THE TOLERANCE. None: two counts and a type name.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { SPAWN_WINDOWS } from "../constants";
import {
  captureStill,
  createHarness,
  enable,
  isolate,
  placeEnemyNear,
  type Harness,
} from "../harness";
import { driveArrivals, fillCommons, poseWindow } from "./spawns";

/** One under window 0's cap of counted commons. */
const COUNTED = SPAWN_WINDOWS[0].cap - 1;

/** Where the three uncounted ranks stand, in units from the lamplighter. */
const ELITE_OFFSET = 500;

/** Window 0's only type, as row 0 of SPAWN_WINDOWS gives it. */
const [WINDOW_0_TYPE] = SPAWN_WINDOWS[0].types;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads aliveCommons 19 with a mothwing, an owl, and the Dark beside 19 moths, and spawns on the due tick", async () => {
  isolate(h);
  fillCommons(h, COUNTED);
  placeEnemyNear(h, "mothwing", ELITE_OFFSET, 0);
  placeEnemyNear(h, "owl", -ELITE_OFFSET, 0);
  placeEnemyNear(h, "dark", 0, ELITE_OFFSET);
  poseWindow(h, 0);
  enable(h, "spawning");

  const posed = h.snapshot();
  const after = await driveArrivals(h, 1);
  captureStill(h, "elites");

  assertEqual(posed.run.enemies.length, COUNTED + 3, "the enemies posed alive");
  assertEqual(
    posed.run.aliveCommons,
    COUNTED,
    `aliveCommons with ${COUNTED} moths, a mothwing, an owl, and the Dark alive`,
  );
  assertEqual(
    after.arrivals.length,
    1,
    `the window spawns that landed on the due tick with ${COUNTED} counted commons alive`,
  );
  assertEqual(
    after.arrivals[0]?.enemy.type,
    WINDOW_0_TYPE,
    "the type the spawn took, from row 0 of SPAWN_WINDOWS",
  );
});
