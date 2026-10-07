// parts/wheel-length-is-always-one — a wheel's length is `1`, and a length change
// does not move it.
//
// THE RULE. "A wheel carries a tape like an arm ... Its anatomy is the hub and its
// ring alone, so its `length` is always `1`, as `specs/formats.md` records"
// (`specs/parts.md`, The zodiac wheel). `specs/formats.md` records it in the
// solution format's key table: "Arms and wheels — `q`, `r`, `rotation` (`0` to
// `5`), `length` (`1` to `3`; wheels always `1`), `tape`." And the anatomy is what
// fixes it: the ring is "six fixture motes, one on each adjacent hex", never
// further out.
//
// WHAT A LENGTH CHANGE DOES. `specs/instrumentation.md`, The machine:
// "`setPartLength(part, length)` — Sets that part's rest length ... A part that
// carries no length of its own — a wheel, a track, a sigil, a rise, or a set, each
// of which stands at `1` — throws an `Error` naming its kind." So the change is
// refused, and the length it would have moved is still `1` afterwards.
//
// THE CONFIGURATION. One `wheel` at `(0, 0)`, rotation `0`, placed into a live run
// on an emptied field, so its ring is raised and nothing else is on the field to
// be read for it. A length of `ARM_MAX_LEN` (`3`) is then offered to it, which is
// a legal length for an arm and so tests the wheel rule rather than the bounds.
//
// THE VERDICT. `editor.parts` reports the wheel at length `1`, the solution
// `readSolution` returns reports it at `1`, the length change is refused, both
// readings still say `1` afterwards, and every one of the six fixtures rests on a
// hex ADJACENT to the anchor — one hex out, which is what a length of `1` means.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNotNull,
  assertTrue,
} from "../assert";
import { ARM_MAX_LEN, ARM_MIN_LEN } from "../constants";
import { adjacent, at } from "../field";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureStill,
  createHarness,
  fixturesOf,
  openBareRun,
  partById,
  placePart,
  poseOf,
  readMachine,
  type Harness,
} from "../harness";

/**
 * Whether the surface REFUSED the call: `setPartLength` on a part that carries no
 * length of its own "throws an `Error` naming its kind"
 * (`specs/instrumentation.md`, The machine).
 */
async function refuses(call: () => Promise<unknown>): Promise<boolean> {
  try {
    await call();
    return false;
  } catch {
    return true;
  }
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds a wheel at length 1 in the machine, in the solution, and on its ring", async () => {
  await openBareRun(h, { challenge: BARE });
  const wheel = await placePart(h, "wheel", ORIGIN, 0);

  const placed = await h.snapshot();
  assertEqual(
    partById(placed, wheel)?.length,
    ARM_MIN_LEN,
    "a placed wheel's length is 1: its anatomy is the hub and its ring alone",
  );
  const document = await readMachine(h);
  const written = document.parts.find((part) => part.kind === "wheel");
  assertNotNull(
    written ?? null,
    "readSolution returns the machine with its wheel in it",
  );
  assertEqual(
    written?.length,
    ARM_MIN_LEN,
    "the solution readSolution returns records the wheel at length 1, as specs/formats.md requires",
  );

  const refused = await refuses(() =>
    h.debug.setPartLength(wheel, ARM_MAX_LEN),
  );

  await h.advance(1);
  const snapshot = await h.snapshot();
  await captureStill(h, "wheel");

  assertTrue(
    refused,
    `a length of ${ARM_MAX_LEN} offered to a wheel is refused: a wheel carries no length of its own`,
  );
  assertEqual(
    partById(snapshot, wheel)?.length,
    ARM_MIN_LEN,
    "the wheel still stands at length 1 after the length change was offered",
  );
  const after = await readMachine(h);
  assertEqual(
    after.parts.find((part) => part.kind === "wheel")?.length,
    ARM_MIN_LEN,
    "the solution still records length 1 after the length change was offered",
  );
  assertEqual(
    poseOf(snapshot, wheel)?.length,
    ARM_MIN_LEN,
    "the run's live pose for the wheel stands at length 1 too",
  );

  const ring = fixturesOf(snapshot, wheel);
  assertLength(ring, 6, "the wheel still carries its six fixtures");
  for (const fixture of ring) {
    assertTrue(
      adjacent(at(fixture.q, fixture.r), ORIGIN),
      `the fixture on (${fixture.q}, ${fixture.r}) rests one hex from the anchor, never further`,
    );
  }
});
