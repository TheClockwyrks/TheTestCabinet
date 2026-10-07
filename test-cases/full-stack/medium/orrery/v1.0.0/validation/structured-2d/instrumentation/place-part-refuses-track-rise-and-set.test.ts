// instrumentation/place-part-refuses-track-rise-and-set — `placePart` refuses
// track, rise and set.
//
// THE RULE. "`placePart(kind, q, r, rotation)` — Places one part of `kind`, an
// arm, wheel, or sigil kind of `PARTS` in `specs/parts.md` ... A `kind` of
// `track`, `rise`, or `set` throws; each has its own operation"
// (`specs/instrumentation.md`, The machine). The three operations it means are
// the rows beside it: `placeRise(index, q, r, rotation)`, `placeSet(index, q, r,
// rotation)` and `placeTrack(q, r)`, each of which takes something `placePart`'s
// four arguments cannot carry — a reagent or product index, or a path.
//
// A REFUSED CALL PLACES NOTHING, which is the group's own rule: "Each pose sets
// one thing and leaves the rest of the game as it stands", and "An argument
// outside the domain its operation states is invalid, and the call fails loudly
// rather than guessing what was meant."
//
// THE CONFIGURATION. `BARE`, opened as a document, with one arm already standing
// so "places nothing" is read against a machine rather than against an empty
// field — a build that placed a seventh part would be caught either way, but a
// build that CLEARED the machine on the refusal would not. Each of the three
// kinds is offered at a hex where its own operation would have succeeded, so what
// is refused is the kind rather than the placement: `BARE`'s reagent and product
// are each one mote, so a rise or a set at those hexes occupies one free hex, and
// a one-cell track would sit on another.
//
// THE VERDICT. All three calls throw, and after each the machine is still the one
// arm that was placed before them, unchanged in kind, anchor and rotation.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull, fail } from "../assert";
import type { PartName } from "../constants";
import { at, type Hex } from "../field";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
  openTitle,
  partById,
  placePart,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** The three kinds with an operation of their own, each at a free hex. */
const REFUSED: readonly { kind: PartName; hex: Hex }[] = [
  { kind: "track", hex: at(-2, 2) },
  { kind: "rise", hex: at(-4, 0) },
  { kind: "set", hex: at(4, 0) },
];

it("throws on track, rise and set, and places nothing", async () => {
  await openTitle(h);
  await h.debug.loadChallenge(BARE);
  await h.debug.setScreen("editor");
  const arm = await placePart(h, "arm", at(0, 0), 3);
  await h.advance(1);
  await captureStill(h, "refused");

  for (const entry of REFUSED) {
    let threw = false;
    try {
      await h.debug.placePart(entry.kind, entry.hex.q, entry.hex.r, 0);
    } catch {
      threw = true;
    }
    if (!threw) {
      fail(
        `a thrown Error (placePart with a kind of ${entry.kind}, which has place${
          entry.kind === "track"
            ? "Track"
            : entry.kind === "rise"
              ? "Rise"
              : "Set"
        } of its own)`,
        "the call returned without throwing",
      );
    }

    const after = await h.snapshot();
    assertDeepEqual(
      after.editor.parts.map((part) => part.id),
      [arm],
      `placePart(${entry.kind}) placed nothing, and removed nothing`,
    );
    const standing = partById(after, arm);
    assertNotNull(standing, `the arm still stands after ${entry.kind}`);
    assertEqual(standing?.kind, "arm", "unchanged in kind");
    assertEqual(standing?.q, 0, "unchanged in its anchor");
    assertEqual(standing?.r, 0, "unchanged in its anchor");
    assertEqual(standing?.rotation, 3, "and unchanged in its rotation");
  }
});
