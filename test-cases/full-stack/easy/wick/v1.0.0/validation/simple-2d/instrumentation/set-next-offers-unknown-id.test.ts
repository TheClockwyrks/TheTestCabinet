// Wick — instrumentation/set-next-offers-unknown-id: `setNextOffers` with a
// string that is no OfferId throws and leaves `nextOffers` as it was.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md —
// `setNextOffers(ids)`): "a list of `1` to `OFFER_COUNT` (`3`) distinct ids,
// each a weapon id, base or evolved, a passive id, or `LAMP_OIL_ID`; a length
// outside that range, a repeated id, or any other string is invalid"; and "An
// argument outside the domain its operation states is invalid, and the call
// throws". This list is refused for a string that names no offer. Each other
// malformed shape is a point of its own.
//
// WHY THE WORLD IS POSED AS IT IS. A valid list is queued first, so "as it
// was" is a value a refused call could have overwritten rather than `null`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertThrows } from "../assert";
import { captureStill, createHarness, isolate, type Harness } from "../harness";
import type { OfferId } from "../surface";

/** The valid list queued before the refusal, which must survive it. */
const HELD: OfferId[] = ["ember"];

/** The malformed list this point names. */
const MALFORMED: readonly string[] = ["ember", "torch"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses a string that is no OfferId and keeps the list held", async () => {
  isolate(h);
  h.debug.setNextOffers(HELD);
  const before = h.snapshot();
  assertDeepEqual(before.run.nextOffers, HELD, "nextOffers before the refusal");

  assertThrows(
    () => h.debug.setNextOffers(MALFORMED as unknown as readonly OfferId[]),
    "setNextOffers with a string that is no OfferId",
  );
  assertDeepEqual(h.snapshot(), before, "the snapshot after the refusal");

  await h.tick(1);
  captureStill(h, "refused");
});
