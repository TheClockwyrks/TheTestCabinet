// Wick — instrumentation/set-next-offers-shape-invalid: `setNextOffers` with
// an empty list, four ids, a repeated id, or a string that is no `OfferId`
// throws and leaves `nextOffers` as it was.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `setNextOffers(ids)`: "a list of `1` to `OFFER_COUNT` (`3`) distinct ids,
// each a weapon id, base or evolved, a passive id, or `LAMP_OIL_ID`; a length
// outside that range, a repeated id, or any other string is invalid"; an
// invalid argument "throws rather than guessing what was meant".
//
// THE POSE. An isolated run with a valid list queued first, so a call that
// cleared or replaced the field is caught; each malformed call, and the whole
// snapshot compared with the one before them.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertThrows } from "../assert";
import type { OfferId } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

const QUEUED: OfferId[] = ["pin"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("throws on each malformed list and leaves nextOffers as it was", async () => {
  isolate(h);
  h.debug.setNextOffers(QUEUED);
  const before = h.snapshot();
  assertDeepEqual(
    before.run.nextOffers,
    QUEUED,
    "run.nextOffers before the malformed calls",
  );

  const malformed: Array<[string, readonly OfferId[]]> = [
    ["an empty list", []],
    ["four ids", ["pin", "shard", "tinder", "lure"]],
    ["a repeated id", ["pin", "pin", "shard"]],
    ["a string that is no OfferId", ["pin", "torch" as OfferId]],
  ];
  for (const [what, ids] of malformed) {
    assertThrows(
      () => h.debug.setNextOffers(ids),
      `setNextOffers with ${what}`,
    );
  }
  const after = h.snapshot();
  await h.frameDraw();
  captureStill(h, "refused");
  assertDeepEqual(
    after.run.nextOffers,
    QUEUED,
    "run.nextOffers after the refused calls",
  );
  assertDeepEqual(after, before, "snapshot after the refused calls");
});
