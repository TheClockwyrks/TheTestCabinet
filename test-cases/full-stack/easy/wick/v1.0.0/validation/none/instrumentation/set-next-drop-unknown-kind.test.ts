// Wick — instrumentation/set-next-drop-unknown-kind: setNextDrop refuses a
// kind that is not `bread`, `draft`, or `none`, throws, and leaves the state
// exactly as it was.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "Drawn
// outcomes", `setNextDrop(kind)`): "`kind`, one of `bread`, `draft`, and
// `none`; any other value is invalid". `chest` is a pickup kind the roll never
// drops, and the nearest string outside the domain.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertRejects } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  posedState,
  type Harness,
} from "../harness";

/** The surface with its argument types loosened, for a call outside the domain. */
type LooseSurface = Record<string, (...args: unknown[]) => Promise<unknown>>;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("throws on chest and changes nothing", async () => {
  const before = await isolate(h, { taper: true });
  const api = h.debug as unknown as LooseSurface;

  await assertRejects(() => api.setNextDrop("chest"), 'setNextDrop("chest")');
  assertDeepEqual(
    posedState(await h.snapshot()),
    posedState(before),
    'the state across the refused setNextDrop("chest")',
  );

  await captureStill(h, "refused");
});
