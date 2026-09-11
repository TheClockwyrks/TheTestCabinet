// screens/refused-edit-is-visible — a refused edit shows in the moment it is
// refused.
//
// `specs/ui.md` § Build: "A REFUSED EDIT IS VISIBLE IN THE MOMENT IT IS REFUSED,
// in whatever form suits the look, so a player is never left wondering why a
// click did nothing."
//
// THE FORM IS DELIBERATELY THE BUILD'S — a line of text, a flash on the node, a
// mark under the pointer — so nothing here may ask for one. What the requirement
// fixes is that SOMETHING is different, and `drawn()` is the account of what the
// frame put on screen, so the reading is that the account changed.
//
// AND DIFFERENT IS DIFFERENT FROM A CLICK THAT WENT THROUGH. The sentence ends in
// what it is for: a player is never left wondering WHY A CLICK DID NOTHING. A
// screen that shows the same thing whatever the click did leaves exactly that
// player exactly there, so neither reading below asks only whether the screen
// changed — each one asks whether it changed in a way it does not change when the
// same click is taken.
//
// THE MOMENT IS THE CLICK'S, AND THE POINTER'S IS ALSO THE MOMENT. `specs/ui.md`
// says the refusal shows "in the moment it is refused", and the moment an edit is
// refused is the click that asked for it — but a build is free to say why a click
// will do nothing BEFORE it is made as well, because the refusal is a fact about
// the edit under the pointer and showing it early is showing it. Neither form is
// the specification's, so both are read and either will do:
//
//   - OVER THE POINTER: the screen over a node where the edit would be refused
//     against the screen over the same node where it would be taken. One node,
//     one pointer position, one tool changed under it, so everything about the
//     moment is identical except whether the edit would be taken.
//   - ACROSS THE CLICK: what the refused click changes on the screen against what
//     a click at the same node that is NOT refused changes on it. A build that
//     flashes the node or writes a line when the click lands says it here and
//     nowhere else, and a check that read only the pointer would fail it for
//     saying it at exactly the moment asked for.
//
// THE CLICK THAT IS NOT REFUSED IS A STRUT'S FIRST. `specs/controls.md`: "Strut,
// cable, rail: the first click picks a node and holds it pending" — a pick rather
// than an edit, so no rule in `specs/structure.md` reaches it and it goes through
// at the same node the refused one is made at. The pending node it holds is put
// back before the refused click, so the refusal is still asked of the world this
// check described.
//
// AND IT IS MADE FIRST, WHICH IS WHAT MAKES IT A CONTROL. A build that writes one
// line on EVERY build click writes it on that one, and it is then already on the
// screen when the refused click is made, so the refused click adds nothing and
// the reading is not satisfied. Made the other way round the same build would
// pass: the line would arrive on the refused click and be old news by the taken
// one.
//
// THE ACROSS-THE-CLICK READING ALSO CARRIES A STILL-FRAME CONTROL. A frame that
// differs from the one before it for reasons of its own — an animation, a blinking
// mark — would answer this question with anything at all, so the frame is first
// shown to be STILL: an advance with no input at all must leave the account of the
// frame exactly as it was, and only then does a change across the click mean the
// click.
//
// WHAT THE READING STILL CANNOT SEE, said plainly rather than left to be
// discovered: a screen that draws something DIFFERENT ON EVERY CLICK — a running
// count of clicks in a readout — would satisfy it while telling a player nothing,
// and no reading of the account can tell that from a refusal cue. The two controls
// remove the two forms of it a build arrives at by accident, a screen that moves on
// its own and one line written on every click; a screen that keeps a per-click
// figure is not one of them.
//
// THE CLICK IS STILL MADE, and the structure must come through it untouched: a
// screen that says "refused" and then takes the edit anyway has said nothing.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import {
  clearAll,
  createHarness,
  nodePoint,
  openSite,
  type Harness,
} from "../harness";

/** The node the pointer rests on, well clear of the ring already placed. */
const NODE = { x: 6, y: 2, z: 0 };

/**
 * The ticks left between the two clicks for anything the first one started to
 * finish, so the still-frame control reads a screen at rest rather than one still
 * running an animation this check itself asked for. Half a second at `TICK_HZ`.
 */
const SETTLE_TICKS = 30;

let h: Harness;

/** The account of the last frame, entry by entry, so two frames can be compared. */
async function account(): Promise<string[]> {
  return (await h.drawn()).map((entry) => JSON.stringify(entry));
}

/** The entries of `after` that `before` does not hold, counting duplicates. */
function arrivals(
  before: readonly string[],
  after: readonly string[],
): string[] {
  const left = [...before];
  const out: string[] = [];
  for (const entry of after) {
    const at = left.indexOf(entry);
    if (at === -1) out.push(entry);
    else left.splice(at, 1);
  }
  return out;
}

/**
 * What one account holds that the other does not, signed by the direction: a cue
 * that TAKES something off the screen counts as much as one that puts something
 * on it, and a readout that changed its text is one entry gone and one arrived.
 */
function changes(
  before: readonly string[],
  after: readonly string[],
): string[] {
  return [
    ...arrivals(before, after).map((entry) => `+${entry}`),
    ...arrivals(after, before).map((entry) => `-${entry}`),
  ];
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("shows something different where an edit would be refused", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await h.debug.setScreen("build");

  // A SECOND RING IS REFUSED OUTRIGHT (`specs/structure.md`), and a strut from
  // the same node is not. So the pointer is put on ONE node and the tool is
  // changed under it: everything about the moment is identical except whether
  // the edit the player is about to make would be taken.
  await h.debug.setRing(0, 2, 0);
  const at = await nodePoint(h, NODE);
  assertTrue(
    at.visible,
    "the node to be drawn on the stage, so the pointer can reach it",
  );

  await h.debug.setTool("strut");
  await h.pointerMove(at.x, at.y);
  await h.advance(1);
  const accepted = (await account()).join("\n");

  await h.debug.setTool("ring");
  await h.pointerMove(at.x, at.y);
  await h.advance(1);
  const refused = (await account()).join("\n");

  // The control for the reading across the click: the same click at the same
  // node with the strut tool, which picks the node rather than editing anything
  // and is therefore refused by nothing.
  await h.debug.setTool("strut");
  await h.pointerMove(at.x, at.y);
  await h.advance(1);
  const beforeTaken = await account();
  await h.click(at.x, at.y);
  await h.advance(1);
  const taken = changes(beforeTaken, await account());

  // Its pending node is put back and whatever it started is left to finish.
  await h.debug.clearPendingNode();
  await h.debug.reconcile();
  await h.advance(SETTLE_TICKS);

  await h.debug.setTool("ring");
  await h.pointerMove(at.x, at.y);
  await h.advance(1);
  const settled = (await account()).join("\n");
  // The still-frame control: one more advance with nothing done to the game.
  await h.advance(1);
  const stillFrame = await account();
  const still = stillFrame.join("\n");

  const before = await h.snapshot();
  await h.click(at.x, at.y);
  await h.advance(1);
  const refusal = changes(stillFrame, await account());
  const after = await h.snapshot();

  await h.capture("refusal", "The build screen where an edit would be refused");

  assertEqual(
    JSON.stringify(after.structure),
    JSON.stringify(before.structure),
    "the structure across the refused click, which nothing may change " +
      "(specs/structure.md)",
  );
  const overThePointer = refused !== accepted;
  const acrossTheClick =
    settled === still && refusal.some((entry) => !taken.includes(entry));
  assertTrue(
    overThePointer || acrossTheClick,
    "the screen to show the refusal — something over a node where the edit " +
      "would be refused that it does not show where the same click would be " +
      "taken, or something the refused click puts on a still screen that a " +
      "click at the same node that is not refused does not put there " +
      "(specs/ui.md: a refused edit is visible in the moment it is refused)",
  );
});
