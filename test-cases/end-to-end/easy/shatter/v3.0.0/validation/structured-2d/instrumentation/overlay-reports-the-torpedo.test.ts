// instrumentation/overlay-reports-the-torpedo — the debug overlay reports the two
// facts `warhead` adds to the Diagnostics list: the torpedo charge, and how many
// torpedoes are in flight. `warhead` only.
//
// THE RULE. `specs/instrumentation.md`'s Diagnostics section adds those two rows to
// the panel under this variant. Every fact both variants share is
// `instrumentation/overlay`, which both checklists name. That the panel exists at
// all, that the engine's key shows it and that it is read-only are the ENGINE's
// under this engine, so no item on it reads them.
//
// WHY IT IS AN ITEM OF ITS OWN. That sibling script is common to both checklists,
// and the only thing it could branch on to decide whether to demand these two rows
// is what the build implemented — whether its surface carries `addTorpedo`. A
// requirement decided that way can be shed by implementing less: a `warhead` build
// that never wrote the torpedo would be asked for nothing extra and pass, while one
// that wrote the whole torpedo and left it off the panel would fail.
//
// WHAT IS ASSERTED IS THE VALUE, NEVER THE WORDING, exactly as its sibling does it:
// the specification fixes no format, no layout, no wording and no units. So the
// charge is posed to a value nothing else on the field carries and looked for among
// the lines the toggle ADDED to an otherwise identical frame, and the count of
// torpedoes is looked for as a whole figure so the `2` of the count is not answered
// by the `2` inside `260`. That reading takes a figure the build GROUPED for the one
// figure it is — `1,024` and `1024` are the same number — and leaves an ASCII space
// between two figures alone, because a panel's lines are the runs of text the frame
// drew and two figures a run apart stay two figures.
//
// THE FIELD HOLDS THE TORPEDOES AND NOTHING ELSE. `startPlaying` leaves an empty,
// quiet field with both world gates shut, and the only bodies posed onto it are the
// torpedoes this item is about — so no other roster's count can supply the figure
// being looked for. The field is then frozen behind the pause menu (`specs/ui.md`:
// "No body moves, no timer runs down").

import { afterEach, beforeEach, it } from "vitest";
import { fail } from "../assert";
import {
  captureStill,
  clearCalls,
  createHarness,
  drawnText,
  startPlaying,
  toggleOverlay,
  type Harness,
} from "../harness";
import { requireOp } from "../surface";
import { poseTorpedo } from "./torpedo";

/** The charge posed, and the forms it may be drawn in. */
const TORPEDO_CHARGE = 0.6;
const CHARGE_FORMS = /0\.6|\b60\b/;

/** The torpedoes posed, above the star and clear of every body. */
const TORPEDO_SPOTS = [
  { x: 420, y: 260 },
  { x: 860, y: 260 },
] as const;

/** The heading they are posed on: straight up the field. */
const TORPEDO_HEADING = -Math.PI / 2;

let h: Harness;

/**
 * The characters a build may GROUP a figure's digit triples with.
 *
 * A figure reaches a panel through the build's own formatter, and the ordinary one
 * — `Number.prototype.toLocaleString` — groups by default, with the comma, the
 * apostrophe or one of the thin and non-breaking spaces its locale calls for. All
 * of them write the same number.
 *
 * ASCII SPACE IS NOT ONE OF THEM. A panel's lines are the runs of text the frame
 * drew, and a build is free to draw a figure and its neighbour as runs one space
 * apart — so reading a space as a separator would take the two figures in `40 130`
 * for the single number `40130`. `.` is left out for the neighbouring reason: it is
 * the decimal point, and a build drawing `1.5` means one and a half.
 */
const GROUP = "[,'\\u00A0\\u202F\\u2009]";

/**
 * One figure as a build may write it: grouped into triples, or plain.
 *
 * A LEADING SIGN IS NOT PART OF THE FIGURE. What is read here is the digits, so a
 * build that writes a figure with a sign in front of it and one that writes the
 * magnitude alone are read alike, as this panel's sibling reading needs.
 */
const DRAWN = new RegExp(
  `\\d{1,3}(?:${GROUP}\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?`,
  "g",
);

/**
 * Every figure the lines carry, as the numbers they read as.
 *
 * The separators are dropped from each match, so a panel that groups a figure
 * (`45,310`) and one that does not (`45310`) report the same number: the
 * specification fixes the FIGURE and leaves how it is written to the build.
 */
function drawnNumbers(lines: readonly string[]): number[] {
  return lines.flatMap((line) =>
    (line.match(DRAWN) ?? []).map((figure) =>
      Number(figure.replace(new RegExp(GROUP, "g"), "")),
    ),
  );
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the torpedo charge and the torpedoes in flight", async () => {
  startPlaying(h);
  for (const spot of TORPEDO_SPOTS) {
    poseTorpedo(h, spot.x, spot.y, TORPEDO_HEADING);
  }
  requireOp(h.debug, "setTorpedoCharge")(TORPEDO_CHARGE);

  // Frozen behind the pause menu, so no timer runs down under the panel
  // (specs/ui.md).
  h.debug.setScreen("paused");

  // A baseline frame of the bare paused screen's own text.
  clearCalls(h);
  await h.advance(1);
  const bare = new Set(drawnText(h.calls));

  // The toggle, and the lines the frame that lands it added.
  clearCalls(h);
  await toggleOverlay(h);
  const added = drawnText(h.calls).filter((line) => !bare.has(line));

  // The debug overlay over the posed torpedoes. (The engine draws the overlay
  // after the replay recorder's bracket closes, so a still is the one capture
  // that shows it.)
  captureStill(h, "overlay");

  if (!added.some((line) => CHARGE_FORMS.test(line))) {
    fail(
      `an overlay line reporting the torpedo charge (${String(TORPEDO_CHARGE)}, ` +
        "or the percentage a panel might show instead) " +
        "(specs/instrumentation.md, Diagnostics, under warhead)",
      added,
    );
  }
  if (!drawnNumbers(added).includes(TORPEDO_SPOTS.length)) {
    fail(
      `an overlay line reporting ${String(TORPEDO_SPOTS.length)} — how many ` +
        "torpedoes are in flight (specs/instrumentation.md, Diagnostics, " +
        "under warhead)",
      added,
    );
  }
});
