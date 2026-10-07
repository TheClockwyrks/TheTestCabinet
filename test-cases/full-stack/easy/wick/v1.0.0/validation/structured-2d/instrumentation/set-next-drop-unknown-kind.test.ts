// Wick — instrumentation/set-next-drop-unknown-kind: setNextDrop refuses a
// kind that is not `bread`, `draft`, or `none`, throws, and leaves the state
// exactly as it was.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`
// ("Drawn outcomes", `setNextDrop(kind)`): "`kind`, one of `bread`, `draft`,
// and `none`; any other value is invalid". `chest` is a pickup kind the roll
// never drops, and the nearest string outside the domain.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertThrows } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  type Harness,
  type WickDebugApi,
} from "../harness";

/** The surface with its argument types loosened, so the call can be spelled. */
type Loose = { [K in keyof WickDebugApi]: (...args: never[]) => unknown };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("throws on chest and changes nothing", async () => {
  const before = isolate(h, { taper: true });
  const d = h.debug as unknown as Loose;

  assertThrows(() => d.setNextDrop("chest" as never), 'setNextDrop("chest")');
  assertDeepEqual(
    h.snapshot(),
    before,
    'the snapshot after setNextDrop("chest") was refused',
  );

  await h.frameDraw();
  captureStill(h, "refused");
});
