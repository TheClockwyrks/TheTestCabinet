// assets/targeting-reads-no-image — the targeting radius is the figure the case
// fixes, not something a decoded file gave it.
//
// THE RULE, from "Scale" in `specs/assets.md`: "The simulation reads no image: a
// mote's collision radius is `MOTE_COLLIDE_R` and a hex's targeting radius is
// `HEX_HIT_R`, whatever a file decoded to." The sentence sits under the paragraph
// that fixes every sprite's canvas — "Every sprite is authored at the canvas its
// table row states and drawn at that size in logical units, centered on the thing
// it depicts" — and is the guard on it. This point is the targeting half;
// `assets/collision-radius-reads-no-image` is the collision half.
//
// WHAT THE TARGETING RADIUS IS. "The pointer targets the field hex whose center
// is nearest to the pointer position, provided that distance is at most
// `HEX_HIT_R` (`26`)" (`specs/field.md`, Targeting a hex).
//
// HOW THE FIGURE IS PUT ON TRIAL. With a mote sprite withheld the build has an
// image missing, and the radius is read at both of its edges: a point INSIDE the
// radius still takes its hex, and a point outside every hex's radius still takes
// none. A build whose reach came off a decoded file — the sprite's own size, half
// of it, or a default it fell back to when the decode failed — lands on one side
// or the other of `26` and fails one of the two.
//
// WHERE THE TWO POINTS ARE. INSIDE: `HEX_HIT_R - 1` (`25`) due north of hex
// `(0, 0)`'s computed center, toward the vertex a pointy-top hex carries there.
// `HEX_HIT_R` (`26`) is more than the `HEX_PITCH / 2` (`24`) at which two
// neighbouring centers meet, so the reading is unambiguous only away from that
// meeting point, which is why the bearing is a vertex one. OUTSIDE: the vertex
// itself, `HEX_PITCH / sqrt(3)` (`27.71`) from center — a pointy-top cell's own
// reach from center to vertex at pitch `HEX_PITCH` (`48`) — where the three cells
// of `(0, 0)`, `(0, -1)` and `(1, -1)` meet. It is the point of the whole field
// at which a pointer is furthest from every center while still standing on the
// field. Both distances are read back off the specification's own formulas,
// against every field hex, before the build is asked anything.
//
// WHAT IS READ. A live place drag reports its target: "a press begins it, each
// pointer move retargets it" (`specs/editor.md`, Dragging), carried in the
// snapshot as `editor.drag` with "`at`: the targeted hex, `null` off every hex"
// (`specs/instrumentation.md`). Nothing is placed and nothing is committed.
//
// THE WORLD IS POSED, NOT SEARCHED. `BARE` is loaded as a challenge document and
// the machine emptied, so no part is on the field to take the press instead, and
// there is no live run, which would reduce a press on the field to a focus
// change. The drag is released at the vertex, which "places nothing".
//
// A FILE THE BUILD NEVER REQUESTS CANNOT BE WITHHELD. A bundler is free to inline
// a small produced PNG into the bundle as a `data:` URI; that is still the
// committed file and is still conformant, and such a build makes no request to
// refuse. What this check then observes is a game whose sprite arrived, which is
// the honest outcome rather than a gap.
//
// THE EVIDENCE is the frame the pointer stood inside the radius on.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertEqual,
  assertGreaterThan,
  assertNull,
  fail,
} from "../assert";
import {
  FIELD_CX,
  FIELD_CY,
  HEX_HIT_R,
  HEX_PITCH,
  MOTE_SPRITE_PATHS,
} from "../constants";
import {
  at,
  distance,
  fieldHexes,
  hexCenter,
  sameHex,
  traySlot,
  type Hex,
  type StagePoint,
} from "../field";
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
import { withoutFile } from "./degraded";
import { assetFile } from "./files";

/** The mote sprite this check withholds: the type `BARE` rises and sets. */
const WITHHELD = assetFile(MOTE_SPRITE_PATHS.sol);

/** `HEX_HIT_R - 1` due north of `(0, 0)`, toward a pointy-top hex's own vertex. */
const INSIDE: StagePoint = { x: FIELD_CX, y: FIELD_CY - (HEX_HIT_R - 1) };

/** A pointy-top cell's reach from its center to a vertex, at pitch `HEX_PITCH`. */
const VERTEX_R = HEX_PITCH / Math.sqrt(3);

/** The vertex where the cells of `(0, 0)`, `(0, -1)` and `(1, -1)` meet. */
const VERTEX: StagePoint = { x: FIELD_CX, y: FIELD_CY - VERTEX_R };

/** The three hexes whose cells meet at that vertex. */
const MEETING: readonly Hex[] = [ORIGIN, at(0, -1), at(1, -1)];

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ withoutAssets: withoutFile(WITHHELD) });
});

afterEach(async () => {
  await h.dispose();
});

it("targets within HEX_HIT_R and nowhere beyond it, with a sprite unavailable", async () => {
  assertNull(
    h.surfaceFault,
    `the game still initializes with ${WITHHELD} unavailable, so its debug surface can be driven`,
  );

  assertCloseTo(
    distance(INSIDE, hexCenter(ORIGIN)),
    HEX_HIT_R - 1,
    6,
    "the inside point is HEX_HIT_R - 1 from the center of (0, 0)",
  );
  for (const hex of fieldHexes()) {
    if (sameHex(hex, ORIGIN)) continue;
    assertGreaterThan(
      distance(INSIDE, hexCenter(hex)),
      HEX_HIT_R - 1,
      `(${hex.q}, ${hex.r}) is farther from the inside point than (0, 0) is`,
    );
  }
  for (const hex of MEETING) {
    assertCloseTo(
      distance(VERTEX, hexCenter(hex)),
      VERTEX_R,
      6,
      `(${hex.q}, ${hex.r}) meets the other two at this vertex, HEX_PITCH / sqrt(3) from it`,
    );
  }
  for (const hex of fieldHexes()) {
    assertGreaterThan(
      distance(VERTEX, hexCenter(hex)),
      HEX_HIT_R,
      `(${hex.q}, ${hex.r}) is farther from the vertex than HEX_HIT_R`,
    );
  }

  await openChallengeDocument(h, BARE);
  await h.debug.clearMachine();

  await pressAt(h, centerOf(traySlot(0)));
  await moveTo(h, INSIDE);
  await h.advance(1);
  await captureStill(h, "targeting-no-image");
  const inside = (await h.snapshot()).editor.drag;

  await moveTo(h, VERTEX);
  const beyond = (await h.snapshot()).editor.drag;
  await releasePointer(h);

  if (inside === null || inside.kind !== "place") {
    fail(
      'a live place drag, reported as editor.drag with kind "place"',
      inside,
    );
  }
  assertEqual(
    inside.at?.q,
    ORIGIN.q,
    "a pointer within HEX_HIT_R of a center still targets that hex with no sprite decoded: q",
  );
  assertEqual(
    inside.at?.r,
    ORIGIN.r,
    "a pointer within HEX_HIT_R of a center still targets that hex with no sprite decoded: r",
  );

  if (beyond === null || beyond.kind !== "place") {
    fail(
      'a live place drag, reported as editor.drag with kind "place"',
      beyond,
    );
  }
  assertNull(
    beyond.at,
    "and the radius is still HEX_HIT_R at its far edge: no center is within it at a cell vertex, so no hex is targeted",
  );
});
