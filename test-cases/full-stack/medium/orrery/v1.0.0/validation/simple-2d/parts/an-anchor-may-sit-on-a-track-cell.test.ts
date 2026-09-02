// parts/an-anchor-may-sit-on-a-track-cell — an arm or wheel may be anchored on a
// cell of a track.
//
// THE RULE. Placement rule 4: "No two arms or wheels share an anchor hex. An arm
// or wheel's anchor may sit on any sigil footprint hex, a rise's and a set's
// included, or on a track cell; sitting on a track cell is what mounts it"
// (`specs/parts.md`, Placement rules). `specs/parts.md` says the same under
// Track: "An arm or wheel whose anchor hex is a cell of a track is mounted on
// that track." Rule 3 keeps CELLS off other cells — "No hex is a cell of two
// tracks, or of one track twice" — and says nothing about anchors, so an anchor
// over a cell is legal and the surface, which checks "against the placement rules
// of `specs/parts.md` alone" (`specs/instrumentation.md`), has nothing to refuse.
//
// THE CONFIGURATION. An empty machine on a posed challenge, with no run live. One
// open track is laid on `(0, 0)`, `(1, 0)`, `(2, 0)`. An `arm` is then anchored on
// `(1, 0)`, the path's middle cell, and a `wheel` on `(2, 0)`, its last. The two
// anchors are different hexes, so rule 4's own prohibition is not what is being
// read, and no footprint is on the field at all.
//
// THE VERDICT. Both placements are taken, each mechanism reads back anchored on
// the cell it was offered, and the track still holds the three cells it was laid
// as.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { at, onField, sameHex, type Hex } from "../field";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  partById,
  partIds,
  placePart,
  placeTrack,
  type Harness,
} from "../harness";

/**
 * Whether the surface REFUSED a placement: "Each placement is checked against
 * the placement rules of `specs/parts.md` alone, and throws an `Error` naming
 * the first rule it breaks" (`specs/instrumentation.md`, The machine).
 */
async function refusesPlacement(place: () => Promise<unknown>): Promise<boolean> {
  try {
    await place();
    return false;
  } catch {
    return true;
  }
}

/** A track's cells, as a string a failure reads at a glance. */
function pathOf(cells: readonly Hex[] | null | undefined): string {
  return (cells ?? []).map((cell) => `${cell.q},${cell.r}`).join(" ");
}

/** The path laid, and the two of its cells the mechanisms are anchored on. */
const PATH: readonly Hex[] = [at(0, 0), at(1, 0), at(2, 0)];
const MIDDLE: Hex = at(1, 0);
const LAST: Hex = at(2, 0);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("anchors an arm and a wheel on cells of a track", async () => {
  await openChallengeDocument(h, BARE);

  // The geometry the check claims to be posing.
  for (const hex of PATH) {
    assertEqual(onField(hex), true, `the cell (${hex.q}, ${hex.r}) is on the field`);
  }
  assertEqual(
    PATH.filter((cell) => sameHex(cell, MIDDLE) || sameHex(cell, LAST)).length,
    2,
    "both anchors offered are cells of the path",
  );
  assertEqual(sameHex(MIDDLE, LAST), false, "the two anchors are different hexes");

  const track = await placeTrack(h, PATH);

  let arm = -1;
  const armRefused = await refusesPlacement(async () => {
    arm = await placePart(h, "arm", MIDDLE, 0);
  });
  let wheel = -1;
  const wheelRefused = await refusesPlacement(async () => {
    wheel = await placePart(h, "wheel", LAST, 0);
  });

  await h.advance(1);
  await captureStill(h, "mounted");

  assertEqual(
    armRefused,
    false,
    "an arm anchored on a cell of a track is placed rather than refused as an overlap",
  );
  assertEqual(
    wheelRefused,
    false,
    "a wheel anchored on another cell of that track is placed too",
  );

  const snapshot = await h.snapshot();
  assertEqual(partById(snapshot, arm)?.kind, "arm", "the arm stands on the machine");
  assertEqual(
    `${partById(snapshot, arm)?.q},${partById(snapshot, arm)?.r}`,
    `${MIDDLE.q},${MIDDLE.r}`,
    "the arm is anchored on the path's middle cell",
  );
  assertEqual(partById(snapshot, wheel)?.kind, "wheel", "the wheel stands on the machine");
  assertEqual(
    `${partById(snapshot, wheel)?.q},${partById(snapshot, wheel)?.r}`,
    `${LAST.q},${LAST.r}`,
    "the wheel is anchored on the path's last cell",
  );
  assertEqual(
    pathOf(partById(snapshot, track)?.cells),
    pathOf(PATH),
    "the track still holds exactly the cells it was laid as",
  );
  assertEqual(
    (await partIds(h)).length,
    3,
    "the machine holds the track and the two mechanisms mounted on it",
  );
});
