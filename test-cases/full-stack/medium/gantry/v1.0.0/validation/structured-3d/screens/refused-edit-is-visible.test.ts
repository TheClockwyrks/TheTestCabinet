// screens/refused-edit-is-visible — a refused edit shows on the build screen in
// the moment it is refused.
//
// specs/ui.md § Build: "A refused edit is visible in the moment it is refused, in
// whatever form suits the look, so a player is never left wondering why a click
// did nothing." specs/controls.md § The build tools says the same from the
// editor's side: "Every edit passes through the rules in specs/structure.md, and a
// refused edit changes nothing on screen beyond the refusal being visible in the
// moment (specs/ui.md)."
//
// THE REFUSAL IS THE ONE THAT NEEDS NO PARTICULAR NODE. specs/structure.md refuses
// a second slew ring — "A ring placement is refused when the structure already has
// one" — so with the minimal crane standing and the ring tool selected, a click
// that picks ANY node is refused, and the check does not have to reason about
// which node a build's picking rules take. That the click picked a node at all is
// read from `pick` before it is delivered, because a click that picks nothing
// "does nothing" and would leave the point undecided rather than failed.
//
// WHAT IS ASSERTED IS THAT THE PICTURE CHANGED, and nothing about the form: the
// specification leaves that to the build ("in whatever form suits the look"). The
// frame is compared with a baseline taken with the pointer already parked over
// the node, so the pointer's own highlight is in both pictures and only the
// refusal separates them; the release is over before the frames are read, so a
// cursor drawn differently while a button is held is in neither.
//
// THE READING, UNDER AN ENGINE, IS BOTH HALVES OF THE PICTURE, because the
// specification leaves the form free and a build may put a refusal on either.
// The yard is `drawnObjects` — every object the world pass will draw this frame,
// with the box it fills and the colour it is drawn in — and the readouts are
// `h.screenOps()`, every operation the screen pass made. There is no rasterizer
// in this project (`validation/host.ts` gives three a WebGL2 context that answers
// every call and draws nothing), so what is compared is the drawing rather than
// its pixels — which is the same comparison, made where a build cannot hide a
// difference in a colour too close to read.
//
// A BUILD WHOSE BUILD SCREEN IS NEVER STILL — an idle animation, a drifting
// light — would differ from its own baseline for reasons of its own, so ten
// frames of the same screen with NO input are taken first and every drawing they
// pass through is set aside: a frame after the click counts only if it draws
// something none of those did.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, fail } from "../assert";
import {
  MINIMAL_CRANE,
  clearAll,
  createHarness,
  drawnObjects,
  drawnSignature,
  nodePoint,
  openSite,
  standMinimalCrane,
  type Harness,
} from "../harness";

/** The lattice node the click is aimed at: inside every site's envelope. */
const AIM = { x: 4, y: 0, z: 4 } as const;

/** How many frames after the refusal are looked at. */
const FRAMES = 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** The whole of what this frame draws: the yard, and the readouts over it. */
async function drawing(): Promise<string> {
  const yard = drawnSignature(drawnObjects(h));
  const screen = JSON.stringify(await h.screenOps());
  return `${yard}\n---\n${screen}`;
}

it("shows a refused edit in the moment it is refused", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await h.debug.setTool("ring");

  const aim = await nodePoint(h, AIM);
  await h.pointerMove(aim.x, aim.y);
  await h.advance(2);

  const parked = await h.snapshot();
  assertNotNull(
    parked.pick.node,
    "a node under the pointer, so the click below is one the editor refuses " +
      "rather than one that picks nothing (specs/controls.md § Clicks and " +
      "drags)",
  );

  // Every drawing the screen passes through with NO input, which is the build's
  // own idling and not a refusal.
  const idle = new Set<string>([await drawing()]);
  for (let frame = 0; frame < FRAMES; frame += 1) {
    await h.advance(1);
    idle.add(await drawing());
  }

  await h.pointerDown(aim.x, aim.y);
  await h.advance(1);
  await h.pointerUp();

  let shown = false;
  for (let frame = 0; frame < FRAMES; frame += 1) {
    await h.advance(1);
    if (!idle.has(await drawing())) shown = true;
    if (frame === 0) {
      await h.capture("refusal", "The frame showing a refused edit");
    }
  }

  const refused = await h.snapshot();
  assertEqual(
    refused.structure.members.length,
    MINIMAL_CRANE.members.length,
    "the members the crane still holds, so the click was refused and changed " +
      "nothing (specs/structure.md § Editing)",
  );
  assertEqual(
    refused.historyDepth,
    parked.historyDepth,
    "the undo history the refused click left, which a refused edit does not " +
      "push to (specs/structure.md § Editing)",
  );
  if (!shown) {
    fail(
      "the refused click to show on the build screen in the moment it was " +
        "refused, so a player is never left wondering why a click did " +
        `nothing (specs/ui.md § Build): one of the ${FRAMES} frames after it ` +
        "to draw something none of the frames before it drew",
      "the build screen drew exactly what it was already drawing",
    );
  }
});
