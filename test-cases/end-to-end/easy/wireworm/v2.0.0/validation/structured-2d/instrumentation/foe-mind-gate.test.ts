// Wireworm — instrumentation/foe-mind-gate: a foe whose mind is gated off leaves
// the node field exactly as it found it, while its travel runs on.
//
// specs/instrumentation.md gives the operation exactly one faculty:
// `setFoeMind(id, enabled)` "Gates the foe's own behavior alone: the glitch's
// dart and its eating, the dropper's node-laying, the corruptor's slam. Its
// travel runs on."
//
// IT IS WHAT LETS A SCENARIO CARRY A FOE THAT IS NOT THE SUBJECT. A foe posed as
// a bolt's target, or as something the cursor must not touch, has to leave the
// board it is standing on alone; the guidance this case is written to rules out
// keeping it quiet by parking it somewhere harmless, because containment leans
// on the build's own rules and a broken build is broken in exactly those. So the
// points that pose a bystanding foe rest on this gate, and this point is where
// it is decided.
//
// THE WITNESS IS A GLITCH, ON A FIELD, BECAUSE ITS MIND IS THE ONE THAT
// SUBTRACTS. specs/foes.md: "A glitch removes the node on the tile its center
// occupies, whatever that node's charge." So the glitch is posed standing ON a
// node — which the check reads back before it starts — and a mind that ran would
// have taken that node on the spot, before travelling anywhere at all.
//
// THE FIELD IS A BAND, NOT A ROW, SO NO SPEED IS BEING DEMANDED. A glitch
// travels horizontally and descends at once (specs/foes.md), and how far it gets
// in a second is `foes/glitch-*`'s business rather than this point's. Posing a
// single row would quietly require the glitch to stay on that row for the span;
// posing eight rows across most of the width means the glitch is over the field
// wherever it goes, and the reading — that not one node changed — holds however
// fast or slow the build carries it.
//
// AND THE WHOLE FIELD IS COMPARED, NOT JUST COUNTED. `setFoeMind` gates the
// dropper's laying and the corruptor's slam as well as the glitch's eating, so
// the field is held to being unchanged tile for tile and charge for charge: a
// node added or charged fails this as surely as one eaten.
//
// WHAT THIS DOES NOT DECIDE. That a glitch with its mind ON eats what it stands
// on — that is `foes/glitch-eats-inert` and its siblings — nor how far the
// travel that runs meanwhile carries it.

import { afterEach, beforeEach, it } from "vitest";
import { GLITCH_V_SPEED } from "../../src/constants";
import {
  assertEqual,
  assertGreaterThan,
  assertNotEqual,
  assertNotNull,
} from "../assert";
import {
  captureStill,
  chargeAt,
  createHarness,
  foeById,
  poseFoe,
  startPlaying,
  tileAtPoint,
  type Harness,
  type WirewormSnapshot,
} from "../harness";

/** The band of nodes the glitch travels over: eight rows across most of the width. */
const FIELD_TOP_ROW = 8;
const FIELD_BOTTOM_ROW = 15;
const FIELD_LEFT_COL = 4;
const FIELD_RIGHT_COL = 36;

/** The charge every node of the band is laid at, and where the glitch starts. */
const FIELD_CHARGE = 1;
const GLITCH_C = 20;
const GLITCH_R = 9;

/**
 * How long the glitch travels for, in seconds.
 *
 * One second. specs/foes.md descends a glitch at `GLITCH_V_SPEED` (`62` units
 * per second), so a build keeping to the figure carries it about two rows down
 * and several tiles to either side inside the band — well inside it, whichever
 * way its dart takes it. Nothing here reads how far it went.
 */
const DRIVE_SECONDS = 1;

/** The field as one comparable string: every node's tile and charge, in order. */
function fieldOf(snapshot: WirewormSnapshot): string {
  return snapshot.nodes
    .map((node) => `${node.c},${node.r}@${node.charge}`)
    .sort()
    .join(" ");
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("removes nothing from the field while its mind is gated off", async () => {
  startPlaying(h);

  for (let r = FIELD_TOP_ROW; r <= FIELD_BOTTOM_ROW; r += 1) {
    for (let c = FIELD_LEFT_COL; c <= FIELD_RIGHT_COL; c += 1) {
      h.debug.setNode(c, r, FIELD_CHARGE);
    }
  }

  const id = poseFoe(h, "glitch", GLITCH_C, GLITCH_R);
  h.debug.setFoeMind(id, false);

  const posed = h.snapshot();
  const before = fieldOf(posed);
  assertGreaterThan(
    posed.nodes.length,
    0,
    "the nodes this scenario laid under the glitch — with an empty field " +
      "there is nothing for a mind to have eaten",
  );

  // The glitch is standing ON a node, which is the tile its mind acts on
  // (specs/foes.md): a mind that ran would have taken this one first.
  const stood = foeById(posed, id);
  const startTile = tileAtPoint(stood?.x ?? 0, stood?.y ?? 0);
  assertNotNull(
    chargeAt(posed, startTile.c, startTile.r),
    `the node on the tile the glitch's center occupies at the pose, ` +
      `(${startTile.c}, ${startTile.r}) — null means the glitch was not ` +
      `posed onto the field at all, and a mind that ran would have had ` +
      `nothing to eat`,
  );

  await h.advanceSeconds(DRIVE_SECONDS);
  // Before the assertions, so a failing gate still leaves the picture of the
  // field the mindless glitch crossed.
  captureStill(h, "gated");

  const driven = h.snapshot();
  const travelled = foeById(driven, id);

  // Its travel ran on, so the field below is one the glitch was carried across
  // rather than one it never reached.
  assertNotEqual(
    `${travelled?.x},${travelled?.y}`,
    `${stood?.x},${stood?.y}`,
    `the glitch's center after ${DRIVE_SECONDS} s of game time, against the ` +
      `point it was posed at — its travel runs on while its mind is gated, ` +
      `and specs/foes.md descends it at GLITCH_V_SPEED (${GLITCH_V_SPEED} ` +
      `units per second)`,
  );

  assertEqual(
    fieldOf(driven),
    before,
    `every node's tile and charge after the mindless glitch crossed the ` +
      `field, against the field posed under it — setFoeMind(${id}, false) ` +
      `gates the eating, the laying and the slam (specs/instrumentation.md)`,
  );
});
