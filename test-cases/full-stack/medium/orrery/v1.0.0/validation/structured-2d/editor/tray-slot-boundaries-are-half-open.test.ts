// editor/tray-slot-boundaries-are-half-open — a slot rectangle includes its top
// edge and excludes its bottom, so one unit decides which entry a press takes.
//
// THE RULE. "Entry `k`, counted from `0`, occupies the rectangle from `(TRAY_X0,
// TRAY_Y0 + k * TRAY_SLOT_H)` to `(TRAY_X0 + TRAY_W, TRAY_Y0 + (k + 1) *
// TRAY_SLOT_H)`, with `TRAY_X0` `8`, `TRAY_Y0` `56`, `TRAY_SLOT_H` `30`, and
// `TRAY_W` `208` ... Presses are targeted by these rectangles: a press inside
// entry `k` begins placing that part" (`specs/editor.md`, The tray). Which points
// are inside is the layout rule of the same file: "Every extent above, and every
// rectangle this file fixes, includes its lower bound and excludes its upper."
// So `y` `TRAY_Y0 + k * TRAY_SLOT_H` is entry `k`'s first row and entry `k - 1`'s
// bottom edge is the row above it.
//
// THE CONFIGURATION. A challenge permitting `arm`, `biarm` and `triarm`, with one
// reagent and one product, so entries `0` to `2` are three DIFFERENT mechanisms
// and the entry a press took is named by the kind it began placing. Both interior
// edges of those three are pressed, at `k` `1` and `k` `2`: the row at the edge
// itself, and the row one unit above it. Each press is released before the next,
// and every one of them is at `x` `TRAY_X0 + TRAY_W / 2`, well inside the slot's
// own span, so only `y` decides.
//
// THE VERDICT. The press at `TRAY_Y0 + k * TRAY_SLOT_H` places entry `k`'s kind
// and the press one unit above it places entry `k - 1`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotEqual, assertNotNull } from "../assert";
import { TRAY_SLOT_H, TRAY_W, TRAY_X0, TRAY_Y0 } from "../constants";
import { challenge, derivedTray, loneMote } from "../formats";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  pressAt,
  releasePointer,
  type Harness,
} from "../harness";

/** Three permitted mechanisms, so the first three entries are told apart by kind. */
const THREE_KINDS = challenge({
  name: "Three Kinds",
  reagents: [loneMote("dust")],
  products: [loneMote("dust")],
  permitted: ["arm", "biarm", "triarm"],
});

/** The tray those permitted kinds derive, in `specs/editor.md`'s order. */
const TRAY = derivedTray(THREE_KINDS);

/** The two interior slot edges this check presses either side of. */
const EDGES = [1, 2] as const;

/** Well inside a slot's own `x` span, so only `y` decides which entry is taken. */
const COLUMN_X = TRAY_X0 + TRAY_W / 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** The kind a press at `y` begins placing, or `null` when it begins nothing. */
async function kindAt(y: number): Promise<string | null> {
  await pressAt(h, { x: COLUMN_X, y });
  const drag = (await h.snapshot()).editor.drag;
  await releasePointer(h);
  return drag !== null && drag.kind === "place" ? drag.part : null;
}

it("takes entry k at its top edge and entry k - 1 one unit above it", async () => {
  await openChallengeDocument(h, THREE_KINDS);
  await captureStill(h, "edge");

  for (const k of EDGES) {
    const edge = TRAY_Y0 + k * TRAY_SLOT_H;
    const below = TRAY[k]?.kind ?? null;
    const above = TRAY[k - 1]?.kind ?? null;
    assertNotEqual(
      below,
      above,
      `entries ${k - 1} and ${k} hold different kinds, so the press that took one names which`,
    );

    const atEdge = await kindAt(edge);
    assertNotNull(atEdge, `a press at y ${edge} begins a placement`);
    assertEqual(
      atEdge,
      below,
      `y ${edge} is entry ${k}'s included top row, so the press places ${below}`,
    );

    const justAbove = await kindAt(edge - 1);
    assertNotNull(justAbove, `a press at y ${edge - 1} begins a placement`);
    assertEqual(
      justAbove,
      above,
      `y ${edge - 1} is still entry ${k - 1}, whose rectangle excludes its bottom edge, so the press places ${above}`,
    );
  }
});
