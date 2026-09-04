// check/check-result-cleared-by-a-tape-change — the shown check result goes back
// to none when the tape changes.
//
// specs/structure.md § The static check: "The result the action leaves stands
// until the structure or the tape changes, when it goes back to none." This point
// is the TAPE half of that sentence, and it is the half a build that watched only
// its structure would miss — the check's issues carry `empty-program`, which is
// the tape's, so a result left showing across a tape edit could describe a tape
// that is no longer there.
//
// The result is put on screen by `showCheck`, which "Poses the `check` action:
// computes the static check and leaves it showing on the build screen, exactly as
// the action does", because the `check` READING never sets it
// (specs/instrumentation.md). The tape edit is one move step appended through the
// tape poses, which are the tape editor's own rules (specs/instrumentation.md §
// The tape); the crane is left untouched, so the structure cannot be what cleared
// the result.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
import { BINDINGS, HOIST_MAX_RATE, HOIST_START } from "../constants";
import { createHarness, openSite, poseTape, type Harness } from "../harness";

const SITE = 0;

const CHECK_KEY = BINDINGS.check[0]!;

/**
 * The structure the reading is taken against: a slew ring and the one rail that
 * hangs off its top flange, which together form a sound track
 * (`specs/structure.md` § The trolley and the rail).
 *
 * ENOUGH FOR THE READING TO BE ABOUT SOMETHING, and no more. What this decides
 * is that a tape edit clears the SHOWN result, and the `check` action leaves one
 * showing whatever the crane is. A whole crane would put twenty further editor
 * calls between the harness and the reading, each of them a refusal belonging to
 * an editor validator, which makes this grade less precise rather than more.
 */
const RING = { x: 0, y: 2, z: 0 };
const RAIL_A = { x: 0, y: 4, z: 0 };
const RAIL_B = { x: 4, y: 4, z: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("clears the shown result when a step is appended to the tape", async () => {
  await openSite(h, SITE);
  // Nothing is cleared: a site opened after a reset has nothing built and an
  // empty tape, which the step count below reads back. The yard is not what a
  // shown check result answers to.
  await h.debug.setRing(RING.x, RING.y, RING.z);
  await h.debug.addMember(
    RAIL_A.x,
    RAIL_A.y,
    RAIL_A.z,
    RAIL_B.x,
    RAIL_B.y,
    RAIL_B.z,
    "rail",
  );

  await h.debug.showCheck();
  const before = await h.snapshot();
  assertNotNull(
    before.checkResult,
    "the result the `check` action leaves the build screen showing " +
      "(specs/structure.md § The static check)",
  );

  await poseTape(h, [
    {
      kind: "move",
      commands: [
        { axis: "hoist", target: HOIST_START + 2, rate: HOIST_MAX_RATE },
      ],
    },
  ]);
  const after = await h.snapshot();
  await h.advance(1);
  await h.capture("state", "The driven state this point decides");

  assertLength(after.program, 1, "the step the tape edit appended");
  assertEqual(
    after.structure.members.length,
    before.structure.members.length,
    "the members the crane holds, which the tape edit did not touch",
  );
  assertNull(
    after.checkResult,
    "the shown check result once the tape changed " +
      "(specs/structure.md § The static check)",
  );
});
