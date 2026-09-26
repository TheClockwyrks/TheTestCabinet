// parts/loaded-solutions-obey-the-placement-rules — a machine that arrives as a
// document is held to the same six rules a machine built by hand is.
//
// THE RULE. "A placement, whether by hand in the editor or through a loaded
// solution, is legal exactly when all of the following hold" (`specs/parts.md`,
// Placement rules), and the six numbered rules follow that sentence.
// `specs/formats.md` states it from the document's side: "A solution is legal for
// a challenge when every part is a permitted kind or a rise or set the challenge
// derives, every placement rule of `specs/parts.md` holds across the whole list,
// and every rise and set index exists." `specs/instrumentation.md` fixes what a
// build does with a document that breaks one: `loadSolution` "replaces the open
// challenge's machine with `solution` ... which is exactly the placements above
// applied in the order `parts` lists them", and across the whole machine group
// "each placement is checked against the placement rules of `specs/parts.md`
// alone, and throws an `Error` naming the first rule it breaks".
//
// THE CONFIGURATION. Six pairs of solution documents, all on `BARE` — one pair
// per rule. The ILLEGAL document of a pair breaks exactly its own rule, and the
// LEGAL document is the same machine with that one breach corrected: an anchor
// brought onto the field, two footprints moved apart, two tracks moved apart, two
// anchors moved apart, a second rise made a set, a track's gap closed. `parts.ts`
// reads the six rules straight out of the specification and is asked which rule
// each document breaks before the build is asked anything, so a pair that is not
// the pair this point needs fails here rather than misreporting the build.
//
// WHY THE LEGAL HALF IS THERE. A build that refused every document alike would
// satisfy "the illegal one is refused" while refusing every machine a player
// could load. The legal half is what that build fails: each legal document is
// accepted and its parts stand on the field afterwards.
//
// THE PERMITTED LIST IS NOT IN PLAY. `specs/instrumentation.md`: "The challenge's
// `permitted` list is a tray rule of `specs/editor.md` rather than a placement
// rule, so none of these reads it." `BARE` permits `arm` alone and the documents
// below carry sigils, tracks, a wheel, a rise and a set; every one of them is a
// legal PLACEMENT, which is the only thing this point is about.
//
// THE VERDICT. Each of the six illegal documents is refused, and each of the six
// legal ones is accepted with its parts on the field.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { at } from "../field";
import {
  armPart,
  risePart,
  setPart,
  sigilPart,
  solution,
  trackPart,
  type Solution,
} from "../formats";
import { BARE, EAST, OFF_FIELD, WEST } from "../fixtures";
import { placementFault, type Patterns } from "../parts";
import {
  captureStill,
  createHarness,
  loadMachine,
  openChallengeDocument,
  type Harness,
} from "../harness";

/** One of the six rules, with a document that breaks it and one that does not. */
interface RuleCase {
  /** The rule's number, as `specs/parts.md` numbers the six. */
  rule: number;
  /** What the rule requires, in the specification's own words. */
  requirement: string;
  /** A machine breaking that rule. */
  illegal: Solution;
  /** The same machine with the one breach corrected. */
  legal: Solution;
}

/** The molecules a rise's and a set's footprints are drawn from on `BARE`. */
const PATTERNS: Patterns = {
  reagents: BARE.reagents,
  products: BARE.products,
};

const CASES: readonly RuleCase[] = [
  {
    rule: 1,
    requirement: "every hex of the part is on the field",
    // `OFF_FIELD` is `(9, 0)`, outside the field of radius FIELD_R (5).
    illegal: solution([armPart("arm", OFF_FIELD.q, OFF_FIELD.r, 0, 1, [])]),
    legal: solution([armPart("arm", 0, 0, 0, 1, [])]),
  },
  {
    rule: 2,
    requirement: "sigil footprints are pairwise disjoint",
    // `bind` occupies its anchor and the hex east of it, so anchors one apart
    // share a hex and anchors two apart do not.
    illegal: solution([sigilPart("bind", 0, 0, 0), sigilPart("bind", 1, 0, 0)]),
    legal: solution([sigilPart("bind", 0, 0, 0), sigilPart("bind", 2, 0, 0)]),
  },
  {
    rule: 3,
    requirement: "no hex is a cell of two tracks, or of one track twice",
    illegal: solution([trackPart([at(0, 0)]), trackPart([at(0, 0)])]),
    legal: solution([trackPart([at(0, 0)]), trackPart([at(2, 0)])]),
  },
  {
    rule: 4,
    requirement: "no two arms or wheels share an anchor hex",
    illegal: solution([
      armPart("arm", 0, 0, 0, 1, []),
      armPart("wheel", 0, 0, 0, 1, []),
    ]),
    legal: solution([
      armPart("arm", 0, 0, 0, 1, []),
      armPart("wheel", 2, 0, 0, 1, []),
    ]),
  },
  {
    rule: 5,
    requirement: "each rise and each set is placed at most once",
    // Two rises for the one reagent, far enough apart that their footprints are
    // disjoint, so rule 5 is the only rule in play.
    illegal: solution([
      risePart(0, WEST.q, WEST.r),
      risePart(0, EAST.q, EAST.r),
    ]),
    legal: solution([risePart(0, WEST.q, WEST.r), setPart(0, EAST.q, EAST.r)]),
  },
  {
    rule: 6,
    requirement: "a track's consecutive cells are adjacent",
    illegal: solution([trackPart([at(0, 0), at(2, 0)])]),
    legal: solution([trackPart([at(0, 0), at(1, 0)])]),
  },
];

/** What one attempt at a document left behind, for a verdict read afterwards. */
interface Attempt {
  rule: number;
  requirement: string;
  /** The rule `parts.ts` finds the illegal document breaking first. */
  breaks: number | null;
  /** The rule `parts.ts` finds the legal document breaking, which is none. */
  clean: number | null;
  illegal: string;
  legal: string;
  parts: number;
  expectedParts: number;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Whether the build took a document, without letting a refusal end the check. */
async function attempt(document: Solution): Promise<"accepted" | "refused"> {
  try {
    await loadMachine(h, document);
  } catch {
    return "refused";
  }
  return "accepted";
}

it("refuses a loaded solution that breaks any of the six placement rules", async () => {
  const seen: Attempt[] = [];

  for (const entry of CASES) {
    await openChallengeDocument(h, BARE);
    const legal = await attempt(entry.legal);
    const parts = (await h.snapshot()).editor.parts.length;
    await h.advance(1);

    // A fresh challenge, so the illegal document meets an empty machine rather
    // than the legal one this pair just loaded.
    await openChallengeDocument(h, BARE);
    const illegal = await attempt(entry.illegal);
    await h.advance(1);

    seen.push({
      rule: entry.rule,
      requirement: entry.requirement,
      breaks: placementFault(entry.illegal.parts, PATTERNS)?.rule ?? null,
      clean: placementFault(entry.legal.parts, PATTERNS)?.rule ?? null,
      illegal,
      legal,
      parts,
      expectedParts: entry.legal.parts.length,
    });
  }

  await captureStill(h, "rejected");

  for (const entry of seen) {
    const where = `rule ${entry.rule}, ${entry.requirement}`;
    assertEqual(
      entry.breaks,
      entry.rule,
      `the illegal document for ${where} breaks that rule first`,
    );
    assertNull(
      entry.clean,
      `the legal document for ${where} breaks no placement rule`,
    );
    assertEqual(
      entry.legal,
      "accepted",
      `a loaded solution breaking no rule is accepted (${where})`,
    );
    assertEqual(
      entry.parts,
      entry.expectedParts,
      `the accepted solution's parts stand on the field (${where})`,
    );
    assertEqual(
      entry.illegal,
      "refused",
      `a loaded solution breaking ${where} is refused`,
    );
  }
});
