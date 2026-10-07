// Wick — instrumentation/set-next-offers-empty-list: `setNextOffers` with an
// empty list throws and leaves `nextOffers` as it was.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md —
// `setNextOffers(ids)`): "a list of `1` to `OFFER_COUNT` (`3`) distinct ids,
// each a weapon id, base or evolved, a passive id, or `LAMP_OIL_ID`; a length
// outside that range, a repeated id, or any other string is invalid"; and "An
// argument outside the domain its operation states is invalid, and the call
// throws". This list is refused for a length below `1`. Each other malformed
// shape is a point of its own.
//
// WHY THE WORLD IS POSED AS IT IS. A valid list is queued first, so "as it
// was" is a value a refused call could have overwritten rather than `null`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertThrows } from "../assert";
import type { OfferId } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

/** The valid list queued before the refusal, which must survive it. */
const QUEUED: OfferId[] = ["pin"];

/** The malformed list this point names. */
const MALFORMED = [] as readonly OfferId[];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("throws on an empty list and leaves nextOffers as it was", async () => {
  isolate(h);
  h.debug.setNextOffers(QUEUED);
  const before = h.snapshot();
  assertDeepEqual(
    before.run.nextOffers,
    QUEUED,
    "run.nextOffers before the malformed call",
  );

  assertThrows(
    () => h.debug.setNextOffers(MALFORMED),
    "setNextOffers with an empty list",
  );
  const after = h.snapshot();
  await h.frameDraw();
  captureStill(h, "refused");

  assertDeepEqual(after, before, "the snapshot after the refused call");
});
