// director/spawn-on-first-tick — the first `playing` tick of a fresh run spawns
// one enemy, because the spawn timer starts at zero.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/enemies.md` ("The spawn timer"): "`spawnTimer` is a timer as
//     `specs/world.md` defines one. It is set to `0` when a run starts", and
//     "A spawn therefore lands on the first tick of a run".
//   - `specs/world.md` ("Timers"): "A timer is due on every tick on which it is
//     `0` after its count-down ... a timer at `0` stays due on every tick until
//     it is set again."
//   - `specs/enemies.md` ("Windows"): row 0 applies from 0:00 and lists `moth`
//     alone, so the type chosen on the first tick is a moth whatever the draw.
//   - `specs/instrumentation.md` (`setScreen`): `playing` from any other screen
//     "Begins a fresh run exactly as `LIGHT THE LAMP` and `TRY AGAIN` do".
//
// WHAT IS READ. The field after the run's first tick: exactly one enemy, and a
// moth. A build whose timer starts anywhere but zero leaves the field empty on
// that tick.
//
// WHY THE NIGHT IS POSED AS IT IS. The fresh run is entered through the
// surface and emptied, and `spawning` alone is on, so the enemy on the field
// after one tick came from the timer being due on the run's first tick and from
// nothing else.
//
// THE PICTURE. What the director spawns lands 760 units out, past the edge of
// the view, so the still is taken after a closing drift that lets it travel in.
// Every reading the assertions use is taken before that drift, and the drift
// cannot fail the item.
//
// TOLERANCE. None: a count of enemies and a type.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  enable,
  isolate,
  type Harness,
} from "../harness";
import { closeIn } from "./stage";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("spawns one moth on the first playing tick of a run", async () => {
  isolate(h);
  enable(h, "spawning");

  const first = await h.tick(1);
  await closeIn(h);
  captureStill(h, "first");

  assertEqual(first.run.tick, 1, "the run's tick after one tick");
  assertLength(first.run.enemies, 1, "enemies after the run's first tick");
  assertEqual(
    first.run.enemies[0].type,
    "moth",
    "the type spawned in window 0",
  );
});
