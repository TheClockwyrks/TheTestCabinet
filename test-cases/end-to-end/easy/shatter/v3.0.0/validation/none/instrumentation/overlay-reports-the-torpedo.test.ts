// instrumentation/overlay-reports-the-torpedo — the debug overlay reports the two
// facts `warhead` adds to the Diagnostics list: the torpedo charge, and how many
// torpedoes are in flight. `warhead` only.
//
// THE RULE. specs/instrumentation.md's Diagnostics section adds those two rows to
// the panel under this variant. Every fact both variants share is
// `instrumentation/overlay`; that the panel exists at all, that the backtick key
// shows and hides it, and that it reads the game without changing it are
// `instrumentation/overlay-is-a-read-only-toggle`. Both checklists name the two.
//
// WHY IT IS AN ITEM OF ITS OWN. That sibling script is common to both checklists, and
// the only thing it could branch on to decide whether to demand these two rows is
// what the build implemented — whether it reports a torpedo roster at all. A
// requirement decided that way can be shed by implementing less: a `warhead` build
// that never wrote the torpedo would be asked for nothing extra and pass, while one
// that wrote the whole torpedo and left it off the panel would fail. This item is
// named by the warhead checklist alone, so it asks unconditionally.
//
// WHAT IS ASSERTED IS THE VALUE, NEVER THE WORDING, exactly as its sibling does it:
// the specification fixes no format, no layout, no wording and no units. So the
// charge is posed to a value nothing else on the field carries and looked for among
// the lines the toggle ADDED to an otherwise identical frame, and the count of
// torpedoes is looked for as a whole run of digits so the `2` of the count is not
// answered by the `2` inside `260`.
//
// THE FIELD HOLDS THE TORPEDOES AND NOTHING ELSE. `startPlaying` leaves an empty,
// quiet field with both world gates shut, and the only bodies posed onto it are the
// torpedoes this item is about — so no other roster's count can supply the figure
// being looked for. The field is then frozen behind the pause menu (specs/ui.md:
// "No body moves, no timer runs down"), which is what makes this a reading about the
// panel rather than about the frames of play that would otherwise run underneath it.
//
// THE FRAMES ARE REDRAWN RATHER THAN STEPPED. `presentCalls` redraws the state as it
// stands without advancing it, so the only game time this spends is the single tick
// that delivers the key press.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, fail } from "../assert";
import {
  captureStill,
  createHarness,
  drawnText,
  poseTorpedo,
  presentCalls,
  startPlaying,
  toggleOverlay,
  type Harness,
} from "../harness";

/**
 * The charge posed, and the forms it may be drawn in.
 *
 * Three fifths: specs/weapons.md runs the charge from `0` to `1`, so this is a value
 * a real recharge passes through six seconds in, and it is neither of the two ends a
 * build could be reporting by accident. It is accepted as the fraction it is or as
 * the percentage a panel might show instead.
 */
const TORPEDO_CHARGE = 0.6;
const CHARGE_FORMS = /0\.6|\b60\b/;

/** The torpedoes posed, at rest, above the star and clear of every body. */
const TORPEDO_PLACES = [
  { x: 420, y: 260 },
  { x: 860, y: 260 },
] as const;

/** The heading they are posed on: straight up the field. */
const TORPEDO_HEADING = -Math.PI / 2;

let h: Harness;

/** The lines `after` drew beyond `before`, as a multiset difference. */
function newLines(
  before: readonly string[],
  after: readonly string[],
): string[] {
  const counts = new Map<string, number>();
  for (const line of before) counts.set(line, (counts.get(line) ?? 0) + 1);
  return after.filter((line) => {
    const held = counts.get(line) ?? 0;
    if (held > 0) {
      counts.set(line, held - 1);
      return false;
    }
    return true;
  });
}

/** Every maximal run of digits the lines carry. */
function digitRuns(lines: readonly string[]): string[] {
  return lines.flatMap((line) => line.match(/\d+/g) ?? []);
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the torpedo charge and the torpedoes in flight", async () => {
  await startPlaying(h);
  for (const place of TORPEDO_PLACES) {
    await poseTorpedo(h, place.x, place.y, TORPEDO_HEADING, { homing: false });
  }
  await h.debug.setTorpedoCharge(TORPEDO_CHARGE);

  // Frozen behind the pause menu, so what changes across the toggle is the overlay
  // and nothing else (specs/ui.md).
  await h.debug.setScreen("paused");

  // The frame as the build draws it with the overlay off, which specs/controls.md
  // says is how the game starts. `presentCalls` redraws without advancing.
  const bare = drawnText(await presentCalls(h));
  await toggleOverlay(h);
  const overlaid = drawnText(await presentCalls(h));
  await captureStill(h, "overlay");
  const overlay = newLines(bare, overlaid);

  assertGreaterThan(
    overlay.length,
    0,
    "the text lines the overlay added to the frame",
  );

  if (!overlay.some((line) => CHARGE_FORMS.test(line))) {
    fail(
      `an overlay line carrying the torpedo charge (${String(TORPEDO_CHARGE)}, ` +
        "or the percentage a panel might show instead) — the Diagnostics list " +
        "specs/instrumentation.md fixes carries it under warhead",
      overlay,
    );
  }
  if (!digitRuns(overlay).includes(String(TORPEDO_PLACES.length))) {
    fail(
      `an overlay line carrying how many torpedoes are in flight ` +
        `(${String(TORPEDO_PLACES.length)}) — the Diagnostics list ` +
        "specs/instrumentation.md fixes carries it under warhead",
      overlay,
    );
  }
});
