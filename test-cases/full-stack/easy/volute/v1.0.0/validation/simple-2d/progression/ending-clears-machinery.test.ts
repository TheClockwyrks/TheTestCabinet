// progression/ending-clears-machinery — a dismissed ending restores the active
// machinery.
//
// THE SPEC LINE. `specs/progression.md` — "Interludes and endings":
// "dismissing it returns the game to the title screen with every value of a
// fresh run restored", and `specs/state.md` ("The title state"), whose table
// gives a row per field: "`initialize` and a `reset` build the values below,
// and leaving a run for the title restores them." This point's value is "|
// `machinery` | `null` |".
//
// ONE VALUE, ONE POINT. `progression/ending.ts` carries the ended run every
// one of these points is read off and says why each figure is moved off its
// fresh-run value first; this file reads the active machinery and nothing
// else.
//
// WHY IT IS A POINT. A sightline that survives the title runs on into a run
// that never granted it, and a choke that did would slow a level nothing
// choked.
//
// THE TOLERANCE. None. A machinery slot either holds a kind or holds nothing.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertNull } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { STANDING_MACHINERY, dismissEnding } from "./ending";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("clears the active machinery when an ending is dismissed", async () => {
  const dismissal = await dismissEnding(h);
  await captureStill(h, "machinery");

  assertNotNull(
    dismissal.posed.machinery,
    "the machinery standing over the ended run before the press",
  );
  assertEqual(
    dismissal.posed.machinery?.kind,
    STANDING_MACHINERY,
    "the kind of machinery the ended run carried",
  );
  assertNull(
    dismissal.title.machinery,
    "the machinery a dismissed ending left active",
  );
});
