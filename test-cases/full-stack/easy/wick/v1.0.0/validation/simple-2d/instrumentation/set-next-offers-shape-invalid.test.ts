// instrumentation/set-next-offers-shape-invalid — `setNextOffers` with an
// empty list, with four ids, with a repeated id, or with a string that is no
// OfferId throws and leaves nextOffers as it was.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `setNextOffers`:
// "a list of `1` to `OFFER_COUNT` (`3`) distinct ids, each a weapon id, base
// or evolved, a passive id, or `LAMP_OIL_ID`; a length outside that range, a
// repeated id, or any other string is invalid"; and an invalid argument
// "throws rather than guessing what was meant".
//
// THE POSE. An isolated run with a valid list posed first, so "as it was" is
// a list and not null; each malformed list in turn, the throw, and the whole
// snapshot against the reading before.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertThrows } from "../assert";
import { captureStill, createHarness, isolate, type Harness } from "../harness";
import type { OfferId } from "../surface";

const HELD: OfferId[] = ["ember"];

const MALFORMED: readonly [string, readonly string[]][] = [
  ["an empty list", []],
  ["four ids", ["ember", "pin", "wick", "oil"]],
  ["a repeated id", ["ember", "pin", "ember"]],
  ["a string that is no OfferId", ["ember", "torch"]],
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses each malformed list and keeps the one held", async () => {
  isolate(h);
  h.debug.setNextOffers(HELD);
  const before = h.snapshot();
  assertDeepEqual(
    before.run.nextOffers,
    HELD,
    "nextOffers before the refusals",
  );

  for (const [what, ids] of MALFORMED) {
    assertThrows(
      () => h.debug.setNextOffers(ids as unknown as readonly OfferId[]),
      `setNextOffers with ${what}`,
    );
    assertDeepEqual(
      h.snapshot(),
      before,
      `the snapshot after ${what} was refused`,
    );
  }
  await h.tick(1);
  captureStill(h, "refused");
});
