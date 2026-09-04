// Wick — instrumentation/set-next-offers-repeated-id: `setNextOffers` with a
// repeated id throws and leaves `nextOffers` as it was.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md —
// `setNextOffers(ids)`): "a list of `1` to `OFFER_COUNT` (`3`) distinct ids,
// each a weapon id, base or evolved, a passive id, or `LAMP_OIL_ID`; a length
// outside that range, a repeated id, or any other string is invalid"; and "An
// argument outside the domain its operation states is invalid, and the call
// throws". This list is refused for a repeated id. Each other malformed shape
// is a point of its own.
//
// WHY THE WORLD IS POSED AS IT IS. A valid list is queued first, so "as it
// was" is a value a refused call could have overwritten rather than `null`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertRejects } from "../assert";
import { type OfferId } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

/** The valid list queued before the refusal, which must survive it. */
const QUEUED: OfferId[] = ["pin"];

/** The malformed list this point names. */
const MALFORMED: string[] = ["pin", "pin"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("throws on a repeated id and leaves nextOffers as it was", async () => {
  await isolate(h);
  await h.debug.setNextOffers(QUEUED);

  await assertRejects(
    () => h.debug.setNextOffers(MALFORMED as OfferId[]),
    "setNextOffers with a repeated id",
  );
  await captureStill(h, "refused");

  assertDeepEqual(
    (await h.snapshot()).run.nextOffers,
    QUEUED,
    "nextOffers after the refused call",
  );
});
