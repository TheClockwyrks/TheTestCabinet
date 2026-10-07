// field/targeting-picks-the-hex-under-the-pointer — the pointer targets the hex
// it is over.
//
// THE RULE. "The pointer targets the field hex whose center is nearest to the
// pointer position, provided that distance is at most `HEX_HIT_R` (`26`)"
// (`specs/field.md`, Targeting a hex), over the centers
// `hexX(q, r) = FIELD_CX + HEX_PITCH * (q + r / 2)` and
// `hexY(q, r) = FIELD_CY + HEX_PITCH * (sqrt(3) / 2) * r` gives. On a hex's own
// computed center the distance is `0` and every other center is `HEX_PITCH`
// (`48`) or more away, so that hex is the one targeted — for all ninety-one of
// them, because the rule is one rule over the whole field rather than a lookup
// that could go wrong at a row's end.
//
// WHAT IS READ. A live place drag reports its target: "a press begins it, each
// pointer move retargets it" (`specs/editor.md`, Dragging), and the snapshot
// carries the drag as `editor.drag`, `kind` `"place"`, with "`at`: the targeted
// hex, `null` off every hex" (`specs/instrumentation.md`). That is the field's
// targeting rule read directly, with no placement committed and nothing on the
// field to be selected instead.
//
// THE GESTURE IS THE PLAYER'S. The press lands in the middle of tray entry `0`'s
// rectangle, which `specs/editor.md` fixes, and "a press inside entry `k` begins
// placing that part"; the surface's pointer operations "feed the same input path
// the player's pointer feeds: targeting, selection, drags, lays, and the focus
// rule all run as `specs/editor.md` and `specs/controls.md` state"
// (`specs/instrumentation.md`). One drag is walked across the field rather than
// ninety-one begun, because a move IS the retarget the rule is about.
//
// THE WORLD IS POSED, NOT SEARCHED. `BARE` is loaded as a challenge document and
// the machine emptied, so the field carries no part whose own hexes could take a
// press, and there is no live run — "while a run is active, in any status, a
// press on the field or the tape panel sets the focus alone". The drag is
// released off every hex at the end, which "places nothing".

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, fail } from "../assert";
import { fieldHexes, hexCenter, traySlot, type Hex } from "../field";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureStill,
  centerOf,
  createHarness,
  moveTo,
  openChallengeDocument,
  pressAt,
  releasePointer,
  type Harness,
} from "../harness";

let h: Harness;

/** A stage point no field hex center lies within `HEX_HIT_R` of. */
const OFF_EVERY_HEX = { x: 616, y: 8 };

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports each field hex as the drag's target when the pointer is on its center", async () => {
  await openChallengeDocument(h, BARE);
  await h.debug.clearMachine();

  await pressAt(h, centerOf(traySlot(0)));
  await moveTo(h, hexCenter(ORIGIN));
  await h.advance(1);
  await captureStill(h, "targeted");

  const hexes = fieldHexes();
  const targeted: (Hex | null)[] = [];
  for (const hex of hexes) {
    const point = hexCenter(hex);
    await moveTo(h, point);
    const drag = (await h.snapshot()).editor.drag;
    if (drag === null || drag.kind !== "place") {
      fail(
        'a live place drag, reported as editor.drag with kind "place"',
        drag,
      );
    }
    targeted.push(drag.at);
  }

  await moveTo(h, OFF_EVERY_HEX);
  await releasePointer(h);

  assertLength(
    hexes,
    91,
    "the field is the 91 hexes with max(|q|, |r|, |q + r|) at most FIELD_R",
  );
  for (const [i, hex] of hexes.entries()) {
    const where = `(${hex.q}, ${hex.r})`;
    const at_ = targeted[i] ?? null;
    assertEqual(
      at_?.q,
      hex.q,
      `${where}: the pointer on this hex's computed center targets it, q`,
    );
    assertEqual(
      at_?.r,
      hex.r,
      `${where}: the pointer on this hex's computed center targets it, r`,
    );
  }

  const after = await h.snapshot();
  assertLength(
    after.editor.parts,
    0,
    "the drag was released off every hex, which places nothing",
  );
});
