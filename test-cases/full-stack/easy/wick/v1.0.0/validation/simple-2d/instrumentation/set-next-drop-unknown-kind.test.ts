// instrumentation/set-next-drop-unknown-kind — setNextDrop refuses a kind that
// is not `bread`, `draft`, or `none`, throws, and leaves the state exactly as
// it was.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md ("Drawn outcomes",
// `setNextDrop(kind)`): "`kind`, one of `bread`, `draft`, and `none`; any
// other value is invalid". `chest` is a pickup kind the roll never drops, and
// the nearest string outside the domain.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertThrows } from "../assert";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("throws on chest and changes nothing", async () => {
  const before = isolate(h, { keepTaper: true });
  const debug = h.debug as unknown as Record<
    string,
    (...args: unknown[]) => unknown
  >;

  assertThrows(() => debug.setNextDrop("chest"), 'setNextDrop("chest")');
  assertDeepEqual(
    h.snapshot(),
    before,
    'the snapshot after setNextDrop("chest") was refused',
  );

  await h.tick(1);
  captureStill(h, "refused");
});
