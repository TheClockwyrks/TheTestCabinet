// instrumentation/load-challenge-refuses-a-malformed-document — `loadChallenge`
// refuses a malformed document.
//
// THE RULE. "`loadChallenge(challenge)` — ... A document that is not well formed
// throws an `Error` naming what is wrong with it and changes nothing"
// (`specs/instrumentation.md`, The challenge), which is the group's general rule
// stated for this operation: "An argument outside the domain its operation states
// is invalid, and the call fails loudly rather than guessing what was meant."
//
// WHAT WELL FORMED MEANS is `specs/formats.md`, Challenges. The four documents
// below each break exactly one of its requirements and are otherwise well formed,
// so a refusal is the rule doing its work rather than a build refusing everything:
//
//   - "`reagents` and `products` are non-empty lists of molecules" — an empty
//     `reagents`.
//   - "`target` is the tally every set must reach, at least `1`" — a target of `0`.
//   - "Each entry is one of the kinds of `PARTS` in `specs/parts.md` up to and
//     including `void`" — a `permitted` entry that is no kind at all.
//   - "A challenge is well formed when all of the above hold and every pattern
//     fits the field. Some placement of each reagent lies entirely on the field"
//     — a reagent twenty motes long, which no placement fits inside a field of
//     radius `FIELD_R` (`5`).
//
// THE CONFIGURATION. A well-formed challenge is loaded first and a machine is
// placed on it, so "changes nothing" has something to be read against: the open
// challenge, and the parts standing on it. Each malformed document is then handed
// over in turn, and the state is read back after every one of them.
//
// THE VERDICT. Every one of the four throws, and after each the open challenge is
// still the well-formed one, with its own name and target, and the machine is
// still the parts that were placed on it, in the same order.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull, fail } from "../assert";
import { FIELD_R } from "../constants";
import { at } from "../field";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
  openTitle,
  partIds,
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

/** One malformed document, and the rule of `specs/formats.md` it breaks. */
interface Malformed {
  label: string;
  rule: string;
  document: unknown;
}

/** A line of `count` motes running east, joined end to end: connected, and long. */
function line(count: number): unknown {
  return {
    motes: Array.from({ length: count }, (_unused, q) => ({
      q,
      r: 0,
      type: "dust",
    })),
    filaments: Array.from({ length: count - 1 }, (_unused, q) => ({
      a: { q, r: 0 },
      b: { q: q + 1, r: 0 },
      weight: 1,
    })),
  };
}

const MALFORMED: readonly Malformed[] = [
  {
    label: "an empty reagents list",
    rule: "`reagents` and `products` are non-empty lists of molecules",
    document: { ...structuredClone(BARE), reagents: [] },
  },
  {
    label: "a target below 1",
    rule: "`target` is the tally every set must reach, at least `1`",
    document: { ...structuredClone(BARE), target: 0 },
  },
  {
    label: "a permitted kind that is not a kind",
    rule: "each `permitted` entry is a kind of PARTS up to and including `void`",
    document: { ...structuredClone(BARE), permitted: ["arm", "sprocket"] },
  },
  {
    label: "a pattern that fits nowhere on the field",
    rule: "some placement of each reagent lies entirely on the field",
    document: { ...structuredClone(BARE), reagents: [line(4 * FIELD_R)] },
  },
];

it("throws on each malformed document and leaves the challenge and the machine standing", async () => {
  await openTitle(h);
  await h.debug.loadChallenge(BARE);
  await h.debug.setScreen("editor");
  const arm = await placePart(h, "arm", at(0, 0), 0);
  const sigil = await placePart(h, "bind", at(2, -2), 0);
  await h.advance(1);
  await captureStill(h, "refused");

  const before = await h.snapshot();
  assertNotNull(before.challenge, "a well-formed challenge is open to be kept");
  assertDeepEqual(
    await partIds(h),
    [arm, sigil],
    "and a machine stands on it to be kept",
  );

  for (const entry of MALFORMED) {
    let threw = false;
    try {
      await h.debug.loadChallenge(entry.document);
    } catch {
      threw = true;
    }
    if (!threw) {
      fail(
        `a thrown Error (loadChallenge with ${entry.label}: ${entry.rule})`,
        "the call returned without throwing",
      );
    }

    const after = await h.snapshot();
    assertEqual(
      after.challenge?.name,
      before.challenge?.name,
      `the open challenge stands after ${entry.label} was refused`,
    );
    assertEqual(
      after.challenge?.target,
      before.challenge?.target,
      `with its own target after ${entry.label} was refused`,
    );
    assertEqual(
      after.challenge?.reagents.length,
      before.challenge?.reagents.length,
      `and its own reagents after ${entry.label} was refused`,
    );
    assertDeepEqual(
      after.editor.parts.map((part) => part.id),
      [arm, sigil],
      `and the machine stands after ${entry.label} was refused`,
    );
    assertDeepEqual(
      after.editor.parts.map((part) => part.kind),
      ["arm", "bind"],
      `part for part after ${entry.label} was refused`,
    );
  }
});
