// machinery/bore-grants-nothing — a marked core a bore removes grants nothing.
//
// WHAT THE SPEC FIXES. `specs/machinery.md` ("Granting"): "Extraction is the only
// source of a grant, and a marked core a bore removes grants nothing." It is a
// boundary the section's own rules fix — a bore removal is a removal, and every
// other removal grants what its marked cores carry — so a build that grants from
// the cores its bore swept is wrong in a way nothing else catches.
//
// THE POSE. The hall every bore point shares (`machinery/bore.ts`), with one
// change: the core at arc 936, the nearest one INSIDE the bore's radius, carries
// a `sightline` mark. No timed machinery is running when the drive starts, so the
// active machinery is `null` before the bore and `null` after it unless the build
// granted from a core the bore took.
//
// WHY THE MARK IS A `sightline`. It is a timed kind, so a build that granted it
// would report it in the snapshot's `machinery` with 12 s on it — the loudest
// possible reading of the defect. A `bore` mark there would grant a second bore
// and hide inside the first one's removals.
//
// THE READING. The active machinery on the tick the bore resolves. The bore
// itself never becomes the active machinery (`specs/machinery.md` — "The active
// machinery", which is `machinery/bore-takes-no-slot`'s point), so `null` is what
// a conformant build reports and any kind at all is the defect. The check also
// confirms the marked core really was removed, or the scenario never exercised
// the rule.
//
// THE TOLERANCE. None: a presence is exact under the standing tolerances. A core
// is matched to its posed arc position within the case's standing +/- 0.5 units.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNull } from "../assert";
import { ARC_TOL } from "../constants";
import {
  arcPositions,
  captureReplay,
  createHarness,
  markedCores,
  type Harness,
} from "../harness";
import { NEIGHBOUR_S, TRAILING_TICKS, driveBore, poseBoreHall } from "./bore";

/** The kind the bored core carries: timed, so a wrongful grant is loud. */
const BORED_MARK = "sightline";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("grants nothing from a marked core a bore removes", async () => {
  await poseBoreHall(h, { neighbourMark: BORED_MARK });

  const posed = h.snapshot();
  assertNull(posed.machinery, "the active machinery before the bore");
  assertLength(
    markedCores(posed).filter((core) => core.mark === BORED_MARK),
    1,
    `the ${BORED_MARK}-marked core standing inside the bore's radius`,
  );

  const swept = await captureReplay(h, "bored", async () => {
    const removed = await driveBore(h);
    await h.step(TRAILING_TICKS);
    return removed;
  });

  // The rule was exercised: the marked core really left the channel with the
  // bore, rather than surviving it and never testing the grant.
  const standing = arcPositions(swept.snapshot);
  const advance = Math.max(...standing) - Math.max(...arcPositions(posed));
  assertEqual(
    standing.some((s) => Math.abs(s - (NEIGHBOUR_S + advance)) <= ARC_TOL),
    false,
    `whether the ${BORED_MARK}-marked core the bore swept is still on the channel`,
  );

  assertNull(
    swept.snapshot.machinery,
    "the active machinery once a bore removed a marked core, which grants nothing",
  );
});
