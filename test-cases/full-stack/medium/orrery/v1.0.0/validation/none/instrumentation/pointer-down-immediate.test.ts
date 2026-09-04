// instrumentation/pointer-down-immediate — a posed press is resolved before the
// call returns.
//
// THE RULE, set in bold by `specs/instrumentation.md` (The editor's hands): "**Each
// of the three pointer operations takes effect immediately, when it is called,
// rather than being sampled once per frame.** The press, the move, or the release
// is resolved before the call returns rather than deferred to the next frame."
// The three "feed the same input path the player's pointer feeds: targeting,
// selection, drags, lays, and the focus rule all run as `specs/editor.md` and
// `specs/controls.md` state."
//
// SO EVERY READING BELOW IS TAKEN WITH NO FRAME ADVANCED between the call and the
// snapshot. A build that queued the press for its next update would report an
// editor that had not seen it, and that is the whole of the failure this point
// catches.
//
// WHAT THE PRESS IS REQUIRED TO HAVE DONE comes from `specs/editor.md`. In the
// tray, "Presses are targeted by these rectangles: a press inside entry `k`
// begins placing that part", and the drag that begins is the `place` shape the
// snapshot carries, "the ghost... a new part at the targeted hex, at rotation `0`
// and length `1`". On the field, "a press on a part selects it at once and begins
// a move", which is the `move` shape, carrying "`from`: the hex the press
// grabbed".
//
// THE WORLD IS POSED, NOT SEARCHED. A posed challenge, an empty machine, and one
// arm placed through the surface, which is the only thing on the field for a press
// to find. The tray slot is derived from the challenge the way `specs/editor.md`
// derives it rather than counted by hand. The tray press is released off every
// hex, which "places nothing", so the field press that follows meets the same
// machine the check placed.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import { hexCenter, traySlot } from "../field";
import { derivedTray } from "../formats";
import {
  captureStill,
  centerOf,
  createHarness,
  openChallengeDocument,
  placePart,
  pressAt,
  releasePointer,
  type Harness,
} from "../harness";
import { BARE, ORIGIN } from "../fixtures";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("has begun the tray's place drag and selected the pressed part before it returns", async () => {
  await openChallengeDocument(h, BARE);
  await h.debug.clearMachine();
  const arm = await placePart(h, "arm", ORIGIN, 0);
  const armSlot = derivedTray(BARE).findIndex((entry) => entry.kind === "arm");

  await pressAt(h, centerOf(traySlot(armSlot)));
  const pressedTray = await h.snapshot();
  await releasePointer(h);

  await pressAt(h, hexCenter(ORIGIN));
  const pressedPart = await h.snapshot();

  await h.advance(1);
  await captureStill(h, "pressed");

  const trayDrag = pressedTray.editor.drag;
  const partDrag = pressedPart.editor.drag;

  assertNotNull(
    trayDrag,
    "a press on a tray entry has begun a place drag in the snapshot taken with no frame advanced",
  );
  assertEqual(
    trayDrag?.kind,
    "place",
    "a press inside a tray entry begins placing that part",
  );
  assertEqual(
    trayDrag?.kind === "place" ? trayDrag.part : null,
    "arm",
    "the place drag carries the kind the pressed entry offers",
  );

  assertEqual(
    pressedPart.editor.selected,
    arm,
    "a press on a placed part has selected it in the snapshot taken with no frame advanced",
  );
  assertNotNull(
    partDrag,
    "a press on a placed part begins a move in the snapshot taken with no frame advanced",
  );
  assertEqual(
    partDrag?.kind,
    "move",
    "a press on a part on the field begins a move rather than a placement",
  );
  assertDeepEqual(
    partDrag?.kind === "move" ? partDrag.from : null,
    ORIGIN,
    "the move drag carries the hex the press grabbed",
  );
});
