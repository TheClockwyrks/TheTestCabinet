// check/check-result-survives-a-refused-edit — a refused edit leaves the shown
// check result standing.
//
// specs/structure.md § The editor's rules: "The editor refuses any edit that
// would break a rule, and a refused edit changes nothing." A member placement is
// refused when "its length exceeds its material's maximum", and § The static
// check says the result the action leaves "stands until the structure or the tape
// changes". A refused placement changes neither, so what the build screen is
// showing still describes the crane on screen and must still be showing.
//
// The refused edit is a strut of length `8`, over `STRUT_MAX_LEN` (`6`), between
// two lattice nodes of the open site's envelope that nothing else uses. Its
// length is the only rule it breaks, so the refusal is the one this item rests
// on.
//
// The member count is read back to establish that the edit was in fact refused:
// a build that accepted it changed the structure, and the shown result would
// rightly go — the item it fails is the editor's, and it fails this one too
// rather than quietly passing on a structure this scenario never posed.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import { BINDINGS, STRUT_MAX_LEN } from "../constants";
import {
  createHarness,
  emptyYard,
  openSite,
  standMinimalCrane,
  type Harness,
} from "../harness";

/** The key `specs/controls.md` binds the `check` action to. */
const CHECK_KEY = BINDINGS.check[0]!;

/** Two ground nodes of site 1's envelope, `8` apart: over `STRUT_MAX_LEN`. */
const FROM = { x: 0, y: 0, z: 0 } as const;
const TO = { x: 8, y: 0, z: 0 } as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("still shows the check result after an edit the editor refused", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await standMinimalCrane(h);

  await h.press(CHECK_KEY);
  const before = await h.snapshot();
  assertNotNull(
    before.checkResult,
    "the result the `check` action leaves on the build screen " +
      "(specs/structure.md)",
  );

  await h.debug.addMember(FROM.x, FROM.y, FROM.z, TO.x, TO.y, TO.z, "strut");

  const after = await h.snapshot();
  assertEqual(
    after.structure.members.length,
    before.structure.members.length,
    `the members standing after a strut of length 8, over STRUT_MAX_LEN ` +
      `(${STRUT_MAX_LEN}), was refused (specs/structure.md)`,
  );
  assertDeepEqual(
    after.checkResult,
    before.checkResult,
    "the check result the build screen is showing after the refused edit: " +
      "the refusal changed nothing, so the structure has not changed and the " +
      "result the action left still describes it (specs/structure.md)",
  );

  await h.advance(1);
  await h.capture(
    "still-shown",
    "the check result still on the build screen after a refused edit",
  );
});
