// Wick — instrumentation/set-next-offers-shape-invalid: `setNextOffers` with
// an empty list, with four ids, with a repeated id, or with a string that is
// no `OfferId` throws and leaves `nextOffers` as it was.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md —
// `setNextOffers(ids)`): "a list of `1` to `OFFER_COUNT` (`3`) distinct ids,
// each a weapon id, base or evolved, a passive id, or `LAMP_OIL_ID`; a length
// outside that range, a repeated id, or any other string is invalid"; and "An
// argument outside the domain its operation states is invalid, and the call
// throws".
//
// WHY THE WORLD IS POSED AS IT IS. A valid list is queued first, so "as it was"
// is a value a refused call could have overwritten rather than `null`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertRejects } from "../assert";
import { type OfferId } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

const QUEUED: OfferId[] = ["pin"];

/** Each malformed list the point names, with the reason it is outside the domain. */
const MALFORMED: { ids: string[]; why: string }[] = [
  { ids: [], why: "an empty list" },
  { ids: ["pin", "ember", "halo", "shard"], why: "four ids" },
  { ids: ["pin", "pin"], why: "a repeated id" },
  { ids: ["pin", "candle"], why: "a string that is no OfferId" },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("throws on a malformed list and leaves nextOffers as it was", async () => {
  await isolate(h);
  await h.debug.setNextOffers(QUEUED);

  for (const { ids, why } of MALFORMED) {
    await assertRejects(
      () => h.debug.setNextOffers(ids as OfferId[]),
      `setNextOffers with ${why}`,
    );
    assertDeepEqual(
      (await h.snapshot()).run.nextOffers,
      QUEUED,
      `nextOffers after the refused call with ${why}`,
    );
  }
  await captureStill(h, "refused");
});
