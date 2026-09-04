// presentation/sigil-role-hexes-told-apart — within one footprint, the hexes the
// specification gives different roles are drawn apart from one another.
//
// THE RULE. "A sigil's footprint hexes are visible, and the hexes
// `specs/sigils.md` gives roles to read apart" (`specs/parts.md`, Presentation);
// `specs/assets.md` puts "the roles its distinguished hexes carry" among the
// things the build draws in code.
//
// THE TWO FOOTPRINTS THIS POINT DECIDES ON are the two whose roles a player has to
// tell apart to use them at all, and they are the two `specs/sigils.md` gives one
// hex a role of its own in:
//
//   `confluence` — "`(0, 0)` crown", and `(1, 0)`, `(0, 1)`, `(-1, 0)`, `(0, -1)`
//   all "fount": "the four founts hold ... one of each essence ... and one
//   `aether` appears on the crown".
//   `dispersion` — "`(0, 0)` fount", and four crowns: "the `aether` is consumed
//   and the four essences appear, each on its named crown".
//
// So a player who cannot tell the confluence's crown from its founts cannot tell
// where the `aether` will appear, and one who cannot tell the dispersion's fount
// from its crowns cannot tell where to put it.
//
// WHAT IS NOT ASSERTED. Nothing is required of two hexes carrying the SAME role —
// the four founts of a confluence are interchangeable by the rule that reads them
// ("in any arrangement"), and `specs/` asks nothing of how they are drawn relative
// to one another. Only pairs whose roles differ are read.
//
// THE TWO ARE ENGRAVED SIDE BY SIDE, on anchors far enough apart that the two
// footprints are disjoint, which `specs/parts.md` requires of any legal placement
// anyway. Both are read off one frame, so neither can be told apart by having been
// drawn at a different moment.
//
// THE VERDICT. Each of the confluence's four founts is drawn apart from its crown,
// and each of the dispersion's four crowns apart from its fount, over at least
// `MIN_DISTINCT_SHARE` of the hex.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertNotNull } from "../assert";
import { hexCenter, place, type Hex } from "../field";
import { BARE, EAST, WEST } from "../fixtures";
import {
  captureStill,
  createHarness,
  differingShare,
  openChallengeDocument,
  placePart,
  type Harness,
  type PixelRect,
} from "../harness";
import { SIGIL_FOOTPRINTS, sigilRoleHex } from "../parts";

/** Half the side of the square one hex is read over; inside its own cell. */
const HALF = 18;

/**
 * The least share of that square two hexes of different roles must differ over.
 *
 * Ten times the case's figure for a mark being visibly distinct
 * (`editor/a-spent-entry-is-drawn-distinct`'s one percent), because two hexes of
 * one footprint are drawn on the same ground with the same engraving around them:
 * what separates them has to be more than the drift two neighbouring cells of one
 * footprint already carry.
 */
const MIN_DISTINCT_SHARE = 0.1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

function square(hex: Hex): Promise<PixelRect> {
  const centre = hexCenter(hex);
  return h.pixelRect(centre.x - HALF, centre.y - HALF, 2 * HALF, 2 * HALF);
}

/** The hexes of a placed sigil carrying `role`, from the specification's table. */
function hexesOfRole(
  kind: "confluence" | "dispersion",
  role: string,
  anchor: Hex,
): Hex[] {
  return (SIGIL_FOOTPRINTS[kind] ?? [])
    .filter((entry) => entry.role === role)
    .map((entry) => place(entry.hex, anchor, 0));
}

it("draws a confluence's crown apart from its founts and a dispersion's fount apart from its crowns", async () => {
  await openChallengeDocument(h, BARE);
  await placePart(h, "confluence", WEST, 0);
  await placePart(h, "dispersion", EAST, 0);
  // The editor draws the selected part distinctly (`specs/editor.md`), which
  // would tell one engraving from the other rather than one hex from another.
  await h.debug.setSelected(null);
  await h.advance(1);
  await captureStill(h, "roles");

  const crown = sigilRoleHex("confluence", "crown", WEST, 0);
  assertNotNull(
    crown,
    "specs/sigils.md gives a confluence a crown on (0, 0), which is where its aether appears",
  );
  const crownSquare = await square(crown as Hex);
  for (const fount of hexesOfRole("confluence", "fount", WEST)) {
    assertGreaterThan(
      differingShare(crownSquare, await square(fount)),
      MIN_DISTINCT_SHARE,
      `the confluence's crown is drawn apart from its fount on (${fount.q}, ${fount.r}), so a player reads where the aether will appear`,
    );
  }

  const fount = sigilRoleHex("dispersion", "fount", EAST, 0);
  assertNotNull(
    fount,
    "specs/sigils.md gives a dispersion a fount on (0, 0), which is where its aether is spent",
  );
  const fountSquare = await square(fount as Hex);
  for (const entry of SIGIL_FOOTPRINTS.dispersion ?? []) {
    if (entry.role === "fount") continue;
    const placed = place(entry.hex, EAST, 0);
    assertGreaterThan(
      differingShare(fountSquare, await square(placed)),
      MIN_DISTINCT_SHARE,
      `the dispersion's ${entry.role} on (${placed.q}, ${placed.r}) is drawn apart from its fount, so a player reads which hex takes the aether and which the essences leave on`,
    );
  }
});
