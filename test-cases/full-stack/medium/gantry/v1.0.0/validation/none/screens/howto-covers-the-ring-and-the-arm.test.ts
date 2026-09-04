// screens/howto-covers-the-ring-and-the-arm — the how-to explains the slew ring
// and that the arm turns on it.
//
// specs/ui.md, "How to play": "`howto` explains the game in a player's words:
// … the ring and what the arm turns on …". This point is that item.
//
// THE THREE TERMS ARE THE SPECIFICATION'S OWN. specs/structure.md opens its ring
// section with "The slew ring is the bearing the arm turns on", and that one
// sentence carries all three things a player has to be told: the part (the slew
// ring), what hangs off it (the arm), and the relation between them (it turns).
// So the copy is asked for a name for each, with the synonyms a player's words
// would reach for, and for nothing about the sentence it builds out of them.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  RECORDER_GLOBAL,
  drawnText,
  toDrawCall,
  type RecordedOp,
} from "../case-harness/index";
import { createHarness, type Harness } from "../harness";

/** The ring, the arm, and the turning that joins them (specs/structure.md). */
const TOPICS = [
  { topic: "the slew ring", terms: [/\bring\b/i] },
  { topic: "the arm", terms: [/\barms?\b/i, /\bjib\b/i, /\bboom\b/i] },
  {
    topic: "the arm turning on it",
    terms: [/\bturns?\b/i, /\bturning\b/i, /\bswings?\b/i, /\brotat/i, /\bslews?\b/i, /\bbearing\b/i, /\bpivots?\b/i],
  },
] as const;

/* -------------------------------------------------------------------------- */
/* Reading the copy the how-to screen drew                                    */
/* -------------------------------------------------------------------------- */
//
// The how-to screen is words, so this point is decided on the words the frame
// actually drew. The harness records every operation the build makes on its 2D
// context — where an engineless build draws its screen layer, the yard behind it
// being the WebGL half — and `drawnText` folds a frame's `fillText` and
// `strokeText` runs out of it. `h.page` is the harness's own door to Playwright,
// which that recorder is read through; the shared harness exposes no reading of
// its own on this case's `Harness`.
//
// MATCHING IS BY TERM, NEVER BY SENTENCE. specs/ui.md fixes WHAT the how-to
// screen explains and leaves every word of it to the build ("in a player's
// words"), so a check that wanted a phrase would fail a build that explained the
// same thing perfectly well in different words. What it looks for is the game's
// own vocabulary — the names specs/controls.md, specs/program.md and
// specs/structure.md give the things being explained — with the ordinary
// synonyms a player's words would reach for.

/** Every run of text the how-to screen drew, folded into one block. */
async function howtoCopy(h: Harness): Promise<string> {
  await h.debug.setScreen("howto");
  await h.advance(1);
  const ops = (await h.page.evaluate(
    (rec) =>
      (window as unknown as Record<string, { last(): unknown[] }>)[rec]!.last(),
    RECORDER_GLOBAL,
  )) as RecordedOp[];
  return drawnText(ops.map(toDrawCall)).join("\n");
}

/** The topics the copy does not name, in the order they are listed. */
function unnamed(
  copy: string,
  topics: readonly { readonly topic: string; readonly terms: readonly RegExp[] }[],
): string {
  return topics
    .filter(({ terms }) => !terms.some((term) => term.test(copy)))
    .map(({ topic }) => topic)
    .join(", ");
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("names the slew ring, the arm, and the arm turning on it", async () => {
  const copy = await howtoCopy(h);
  await h.capture("howto-ring", "The how-to copy on the ring");

  assertGreaterThan(
    copy.length,
    0,
    "the length of the copy the how-to screen drew (specs/ui.md)",
  );

  assertEqual(
    unnamed(copy, TOPICS),
    "",
    "what the how-to copy leaves unnamed of the ring, the arm, and the arm " +
      "turning on it (specs/ui.md, specs/structure.md)",
  );
});
