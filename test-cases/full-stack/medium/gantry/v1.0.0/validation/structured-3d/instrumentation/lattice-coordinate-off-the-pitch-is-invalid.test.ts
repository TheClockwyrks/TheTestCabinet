// instrumentation/lattice-coordinate-off-the-pitch-is-invalid — a coordinate off
// the pitch is a bad argument, not a refused edit.
//
// specs/instrumentation.md § The operations draws the distinction this check is
// about, in one sentence: "An operation whose table names a lattice node takes
// one: a coordinate that is not a multiple of `LATTICE_PITCH` is outside the
// domain and fails the same way, rather than being refused as an edit."
//
// The two outcomes look alike from the state's side — nothing is built either way
// — so a build that quietly refused an off-pitch coordinate would pass any check
// that only read the structure back. What separates them is that the call fails
// loudly, and that is what is read here.
//
// Five operations name a lattice node between them — `setPendingNode`,
// `addMember`, `setRing`, `addCounterweight` and `removeCounterweight` — and each
// is called with exactly one coordinate off `LATTICE_PITCH` (`2`) and every other
// coordinate on it, so nothing but the pitch can be what is wrong with the call.
// `removeCounterweight` is in the list deliberately: a removal with nothing to
// remove is the silent refusal the same file gives, and an off-pitch node is not
// that.
//
// The site is opened on a freshly loaded page, so the structure it carries is the
// empty one `specs/state.md` says a game initializes with and `historyDepth` rests
// at `0`; a call that landed as an edit would push it. Only the YARD is posed —
// the loads and obstacles this point is not about — because a route that emptied
// the structure through `clearStructure` on the way in would fold that operation's
// own requirement into this one's verdict.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNull, fail } from "../assert";
import { LATTICE_PITCH } from "../constants";
import { createHarness, emptyYard, openSite, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("fails loudly on a coordinate that is not a multiple of LATTICE_PITCH", async () => {
  await openSite(h, 0);
  await emptyYard(h);

  const before = await h.snapshot();
  assertLength(
    before.structure.members,
    0,
    "the members the scenario starts on",
  );
  assertNull(before.structure.ring, "the ring the scenario starts on");
  assertEqual(before.historyDepth, 0, "the history an emptied site rests at");

  const offPitch: readonly [string, () => Promise<void>][] = [
    ["setPendingNode(0, 1, 0)", () => h.debug.setPendingNode(0, 1, 0)],
    [
      'addMember(0, 0, 0, 0, 1, 0, "strut")',
      () => h.debug.addMember(0, 0, 0, 0, 1, 0, "strut"),
    ],
    ["setRing(1, 2, 0)", () => h.debug.setRing(1, 2, 0)],
    ["addCounterweight(0, 3, 0)", () => h.debug.addCounterweight(0, 3, 0)],
    [
      "removeCounterweight(0, 0, 1)",
      () => h.debug.removeCounterweight(0, 0, 1),
    ],
  ];

  for (const [what, call] of offPitch) {
    let threw = false;
    try {
      await call();
    } catch {
      threw = true;
    }
    if (!threw) {
      fail(
        `${what} to fail loudly, its odd coordinate being no multiple of ` +
          `LATTICE_PITCH (${LATTICE_PITCH}) and so outside the domain, ` +
          "rather than being refused as an edit (specs/instrumentation.md)",
        "the call returned instead",
      );
    }

    const s = await h.snapshot();
    assertLength(s.structure.members, 0, `the members after ${what}`);
    assertNull(s.structure.ring, `the ring after ${what}`);
    assertLength(
      s.structure.counterweights,
      0,
      `the counterweights after ${what}`,
    );
    assertNull(s.pendingNode, `the pending node after ${what}`);
    assertEqual(s.historyDepth, 0, `historyDepth after ${what}`);
  }

  await h.advance(1);
  await h.capture(
    "error-messages",
    "The empty structure the five off-pitch calls left",
  );
});
