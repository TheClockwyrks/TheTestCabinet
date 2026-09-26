// director/second-mothwing-with-first-alive — the 5:00 Mothwing arrives whether
// or not the 2:00 one is still alive.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/enemies.md` ("Scripted events"): "The second Mothwing spawns
//     whether or not the first is still alive, so two can be on the field at
//     once", with the rows at 2:00 and 5:00 each reading "Mothwing spawns at a
//     spawn point".
//   - `specs/enemies.md` ("Elites and the Dark"): an elite "stands outside the
//     spawn cap" and "stays on the field however far the lamplighter travels,
//     until it dies or the run ends".
//
// WHAT IS READ. The 2:00 event is fired and its Mothwing left alive and
// untouched, then the clock is carried across tick 18000: a second Mothwing
// must be on the field beside the first, two in all, and both times must stand
// in `firedEvents`. A build that skipped the second because an elite was
// already alive reads one.
//
// WHY THE NIGHT IS POSED AS IT IS. `events` alone is on, so nothing can remove
// the first Mothwing between the two arrivals: it is not hit, it does not move,
// and an elite is outside the removal by distance in any case.
//
// THE PICTURE. What the director spawns lands 760 units out, past the edge of
// the view, so the still is taken after a closing drift that lets it travel in.
// Every reading the assertions use is taken before that drift, and the drift
// cannot fail the item.
//
// TOLERANCE. None: a count of mothwings, and the times `firedEvents` lists.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength } from "../assert";
import { EVENTS } from "../constants";
import {
  captureStill,
  createHarness,
  enable,
  isolate,
  type Harness,
} from "../harness";
import { closeIn, crossEvent, enemiesOfType } from "./stage";

/** The 2:00 Mothwing and the 5:00 Mothwing. */
const FIRST_TIME = EVENTS[1].time;
const SECOND_TIME = EVENTS[3].time;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("spawns the second Mothwing while the first is alive", async () => {
  isolate(h);
  enable(h, "events");

  const first = await crossEvent(h, FIRST_TIME);
  assertLength(
    enemiesOfType(first.on, "mothwing"),
    1,
    "mothwings after the 2:00 event",
  );

  const second = await crossEvent(h, SECOND_TIME);
  await closeIn(h);
  captureStill(h, "two");

  assertLength(
    enemiesOfType(second.on, "mothwing"),
    2,
    "mothwings after the 5:00 event, with the first still alive",
  );
  assertDeepEqual(
    second.on.run.firedEvents,
    [FIRST_TIME, SECOND_TIME],
    "firedEvents after both Mothwing events",
  );
});
