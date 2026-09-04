// screens/howto-names-the-check-binding — the how-to names the key a player
// runs the static check with.
//
// specs/ui.md, "How to play": the how-to screen "names the tool, `undo`,
// `check`, screen-switch, and `run` bindings." That sentence names five groups
// of keys, and each is a check of its own: a screen that lists the tool keys
// and forgets `run` has to grade above a screen that lists none of them, and
// one point over the five could not tell them apart. This one decides the
// `check` binding, and specs/controls.md's action table puts it on `KeyC`.
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
import {
  RECORDER_GLOBAL,
  drawnText,
  toDrawCall,
  type RecordedOp,
} from "../case-harness/index";
import { BINDINGS, type ActionName } from "../constants";
import { createHarness, type Harness } from "../harness";

/**
 * `check`, whose binding specs/ui.md requires the how-to to name.
 */
const NAMED: readonly ActionName[] = ["check"];

/* -------------------------------------------------------------------------- */
/* Reading the copy the how-to screen drew                                    */
/* -------------------------------------------------------------------------- */
//
// The how-to screen is words, so this point is decided on the words the frame
// actually drew. The harness records every operation the build makes on its 2D
// context — where an engineless build draws its screen layer, the yard behind
// it being the WebGL half — and `drawnText` folds a frame's `fillText` and
// `strokeText` runs out of it. `h.page` is the harness's own door to
// Playwright, which that recorder is read through; the shared harness exposes
// no reading of its own on this case's `Harness`.

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

it("names the check binding", async () => {
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

  await h.capture("check-key", "The how-to copy naming the check binding");

  assertEqual(
    missing,
    "",
    "the bindings the how-to copy leaves unnamed, of the check binding " +
      "specs/controls.md fixes (specs/ui.md)",
  );
});
