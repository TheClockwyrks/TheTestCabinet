// director/gnats-uncounted — gnats are not counted against the spawn cap.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/enemies.md` ("The cap"): "`aliveCommons` is the number of live
//     enemies of rank `common` other than gnats. Gnats, the elites, and the
//     Dark stand outside the cap: they are never counted against it".
//   - `specs/instrumentation.md` ("Snapshot shape"): `aliveCommons` is derived
//     from "how many of `enemies` have `rank` `common` in `ENEMIES` and are not
//     `gnat`, the count `specs/enemies.md` holds against the cap".
//   - `specs/enemies.md` ("Windows"): row 0 applies from 0:00 with a cap of 20
//     and lists `moth` alone.
//
// WHAT IS READ. Nineteen moths and thirty gnats, forty-nine enemies in all, of
// which only the moths count: `aliveCommons` must read 19, and the next due
// tick must spawn, because 19 is under the cap of 20. A build that counted the
// gnats reads 49 and spawns nothing.
//
// WHY THE NIGHT IS POSED AS IT IS. `spawning` alone is on, so the crowd is
// inert: no gnat drifts away or is removed by distance, so what stands against
// the cap on the reading tick is exactly what was posed.
//
// TOLERANCE. None: a count of enemies and one spawn.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { SPAWN_WINDOWS } from "../constants";
import {
  captureStill,
  createHarness,
  enable,
  isolate,
  type Harness,
} from "../harness";
import { poseRing, poseWindow } from "./stage";

const ROW = SPAWN_WINDOWS[0];

/** Moths posed: one under the cap of 20, so one spawn has room. */
const MOTHS = ROW.cap - 1;

/** Gnats posed: more than the cap, and every one of them outside it. */
const GNATS = 30;

/** Where the gnats stand: their own ring, well inside DESPAWN_DISTANCE. */
const GNAT_RING = 500;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves gnats out of aliveCommons and spawns over them", async () => {
  isolate(h);
  enable(h, "spawning");
  poseWindow(h, 0);
  poseRing(h, "moth", MOTHS);
  poseRing(h, "gnat", GNATS, GNAT_RING);

  const posed = h.snapshot();
  assertEqual(
    posed.run.aliveCommons,
    MOTHS,
    "aliveCommons over 19 moths and 30 gnats",
  );
  assertEqual(posed.run.enemies.length, MOTHS + GNATS, "enemies on the field");

  const before = posed.run.nextId;
  const after = await h.tick(1);
  captureStill(h, "gnats");

  assertGreaterThan(
    after.run.enemies.filter((enemy) => enemy.id >= before).length,
    0,
    "enemies spawned on the due tick with 19 commons and 30 gnats alive",
  );
});
