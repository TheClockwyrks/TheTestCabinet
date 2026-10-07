// director/gnats-uncounted — gnats do not fill the field.
//
// THE SPEC LINE. `specs/enemies.md`, "The cap": "`aliveCommons` is the number
// of live enemies of rank `common` other than gnats. Gnats, the elites, and
// the Dark stand outside the cap: they are never counted against it, and they
// spawn whether or not it is full."
// `specs/instrumentation.md` ("Snapshot shape") derives the reported field the
// same way: "how many of `enemies` have `rank` `common` in `ENEMIES` and are
// not `gnat`". Row 0 of `SPAWN_WINDOWS` caps window 0 at `20`.
//
// WHY IT MATTERS. A swarm puts `SWARM_SIZE` (`24`) gnats on the field at once,
// more than window 0's whole cap, so a build that counts them stops spawning
// for as long as a swarm is in the air.
//
// THE READING, IN TWO PLACES. The field is posed with 19 moths and 30 gnats —
// 49 live commons by rank, of which 19 are counted. The snapshot's
// `aliveCommons` is read directly, and then the director's own arithmetic is
// read by driving the tick the timer is due on: 19 is under the cap of 20, so
// a moth lands. A build whose snapshot subtracts the gnats but whose director
// does not fails the second reading.
//
// THE DRIVE. The isolated world, the clock in window 0, the timer at 0, and
// `spawning` alone on, for one tick. Everything else is off, so the 49 posed
// enemies neither move, nor hit, nor leave.
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
  type Harness,
} from "../harness";
import { driveArrivals, fillCommons, poseWindow } from "./spawns";

/** One under window 0's cap of counted commons, and the gnats posed beside them. */
const COUNTED = SPAWN_WINDOWS[0].cap - 1;
const GNATS = 30;

/** Window 0's only type, as row 0 of SPAWN_WINDOWS gives it. */
const [WINDOW_0_TYPE] = SPAWN_WINDOWS[0].types;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads aliveCommons 19 with 19 moths and 30 gnats alive, and spawns on the due tick", async () => {
  isolate(h);
  fillCommons(h, COUNTED);
  fillCommons(h, GNATS, "gnat");
  poseWindow(h, 0);
  enable(h, "spawning");

  const posed = h.snapshot();
  const after = await driveArrivals(h, 1);
  captureStill(h, "gnats");

  assertEqual(
    posed.run.enemies.length,
    COUNTED + GNATS,
    "the enemies posed alive",
  );
  assertEqual(
    posed.run.aliveCommons,
    COUNTED,
    `aliveCommons with ${COUNTED} moths and ${GNATS} gnats alive`,
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
