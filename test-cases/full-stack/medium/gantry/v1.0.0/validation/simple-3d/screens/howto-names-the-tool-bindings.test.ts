// screens/howto-names-the-tool-bindings — the how-to names the keys a player
// picks a build tool with.
//
// specs/ui.md, "How to play": the how-to screen "names the tool, `undo`,
// `check`, screen-switch, and `run` bindings." That sentence names five groups
// of keys, and each is a check of its own: a screen that lists the tool keys
// and forgets `run` has to grade above a screen that lists none of them, and
// one point over the five could not tell them apart. This one decides the six
// tool bindings, and specs/controls.md's action table puts them on `Digit1` to
// `Digit6`.
//
// A BINDING IS NAMED BY ITS KEY, so what the copy is asked for is the key's own
// label standing alone — `Z`, `1` — in either case, or the `KeyboardEvent.code`
// itself for a build that prints it that way. It is not asked for a phrasing:
// specs/ui.md wants the screen "in a player's words", so whether the copy reads
// "Z undoes the last edit" or "UNDO … Z" is the build's business.
//
// Standing alone is what makes the reading honest. A bare substring search for
// "z" or "b" would find them inside ordinary words and pass a build that named
// no binding at all, so each key is matched on a word boundary.
//
// The keys are taken from `BINDINGS`, which carries exactly what
// specs/controls.md's table fixes, so this check follows the specification if
// the bindings are ever restated.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { drawnTextLines } from "../case-harness/index";
import { BINDINGS, type ActionName } from "../constants";
import { createHarness, type Harness } from "../harness";

/**
 * The six tool actions, which specs/ui.md requires the how-to to name the
 * bindings of.
 */
const NAMED: readonly ActionName[] = [
  "tool-strut",
  "tool-cable",
  "tool-rail",
  "tool-ring",
  "tool-counterweight",
  "tool-delete",
];

/* -------------------------------------------------------------------------- */
/* Reading the copy the how-to screen drew                                    */
/* -------------------------------------------------------------------------- */
//
// The how-to screen is words, so this point is decided on the words the frame
// actually drew. `h.screenCalls()` answers every operation the build made on
// the screen layer — the 2D layer `specs/overview.md` puts the readouts on, the
// yard behind it being the engine's WebGL half — with every text call measured,
// and `drawnTextLines` folds the frame's `fillText` and `strokeText` calls into
// the logical runs they spell. A build that letter-spaces a heading draws it a
// glyph per call, and the specification fixes the copy and not its spacing, so
// the copy is read off the runs and never off the call split.
//
// THIS IS THE ENGINE'S OWN READING OF THE SAME THING. Under `none` the
// operations come from a recorder injected into the page and are read over
// Playwright; here the engine states the seam outright — the game is handed
// "the screen layer's 2D context, exactly as the screen canvas returned it" —
// so the harness supplies a context that records what it is asked to draw
// before it draws it. What a check reads is the same list either way.

/**
 * Every run of text the how-to screen drew, folded into one block.
 *
 * Read off the LOGICAL RUNS the frame spells, never off the `fillText` split:
 * a build that letter-spaces its copy draws a glyph per call, which is the only
 * portable way to letter-space canvas text, and the specification fixes the
 * words a screen shows while leaving their spacing to the build. `screenCalls`
 * carries the measured geometry the shared merge rule (`case-harness/text.ts`)
 * needs to put side-by-side glyphs on one baseline back together, and every
 * raw string is a substring of its run, so coalescing can only add a match.
 */
async function howtoCopy(h: Harness): Promise<string> {
  await h.debug.setScreen("howto");
  await h.advance(1);
  return drawnTextLines(await h.screenCalls()).join("\n");
}

/** The label a `KeyboardEvent.code` prints as: `KeyZ` is `Z`, `Digit1` is `1`. */
function label(code: string): string {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  return code;
}

/** Whether the copy names `code`, as its own label or as the code itself. */
function namesKey(copy: string, code: string): boolean {
  const shown = label(code);
  const alone = new RegExp(`(^|[^0-9a-z])${shown}([^0-9a-z]|$)`, "i");
  return alone.test(copy) || copy.toLowerCase().includes(code.toLowerCase());
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("names the six tool bindings", async () => {
  const copy = await howtoCopy(h);
  assertGreaterThan(
    copy.length,
    0,
    "the length of the copy the how-to screen drew (specs/ui.md)",
  );

  const missing = NAMED.flatMap((action) => {
    const code = BINDINGS[action][0] as string;
    return namesKey(copy, code) ? [] : [`${action} (${code})`];
  }).join(", ");

  await h.capture("tool-keys", "The how-to copy naming the tool bindings");

  assertEqual(
    missing,
    "",
    "the bindings the how-to copy leaves unnamed, of the six tool bindings " +
      "specs/controls.md fixes (specs/ui.md)",
  );
});
