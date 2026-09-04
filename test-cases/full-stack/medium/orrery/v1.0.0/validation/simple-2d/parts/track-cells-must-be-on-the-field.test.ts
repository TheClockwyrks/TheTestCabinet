// parts/track-cells-must-be-on-the-field — every cell of a track lies on the
// field, so a track cannot be extended past the boundary.
//
// THE RULE. Placement rule 1: "Every hex of the part is on the field: an arm or
// wheel's anchor, every cell of a track, and every footprint hex of a sigil,
// rise, or set" (`specs/parts.md`, Placement rules). The field is
// `max(|q|, |r|, |q + r|) <= FIELD_R` with `FIELD_R` `5` (`specs/field.md`), and
// the surface refuses a placement that breaks a rule: "Each placement is checked
// against the placement rules of `specs/parts.md` alone, and throws an `Error`
// naming the first rule it breaks" (`specs/instrumentation.md`).
//
// THE CONFIGURATION. An empty machine on a posed challenge, with no run live. A
// track is placed on `(3, 0)` and extended east one cell at a time — `(4, 0)`,
// then `(5, 0)`, both on the field — and then offered `(6, 0)`, whose figure is
// `6`. Each offered cell is adjacent to the live end, so placement rule 6 holds
// throughout and nothing but rule 1 separates the accepted extensions from the
// refused one. A fresh one-cell track is then offered on `(6, 0)` directly, which
// is the same rule reached without an extension at all.
//
// THE VERDICT. The extension onto `(6, 0)` is refused and the path stays the
// three cells it was laid as; the one-cell track on `(6, 0)` is refused and adds
// no part; and every extension inside the boundary was taken.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { FIELD_R } from "../constants";
import { adjacent, at, onField, type Hex } from "../field";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  partById,
  partIds,
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

/** The path laid, running east to the field's boundary. */
const LAID: readonly Hex[] = [at(FIELD_R - 2, 0), at(FIELD_R - 1, 0), at(FIELD_R, 0)];

/** One cell further east, which is off the field. */
const BEYOND: Hex = at(FIELD_R + 1, 0);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("refuses a track cell off the field and leaves the path as it was", async () => {
  await openChallengeDocument(h, BARE);

  const first = LAID[0] as Hex;
  for (const cell of LAID) {
    assertEqual(
      onField(cell),
      true,
      `the laid cell (${cell.q}, ${cell.r}) is on the field`,
    );
  }
  assertEqual(onField(BEYOND), false, "the cell offered beyond the end is off the field");
  assertEqual(
    adjacent(LAID[LAID.length - 1] as Hex, BEYOND),
    true,
    "the refused cell is adjacent to the live end, so rule 6 is not what refuses it",
  );

  await h.debug.placeTrack(first.q, first.r);
  const track = (await partIds(h))[0] ?? -1;
  for (const cell of LAID.slice(1)) {
    const refused = await refusesPlacement(() =>
      h.debug.extendTrack(track, cell.q, cell.r),
    );
    assertEqual(
      refused,
      false,
      `the extension onto (${cell.q}, ${cell.r}) is taken: the cell is on the field`,
    );
  }

  const extendedBeyond = await refusesPlacement(() =>
    h.debug.extendTrack(track, BEYOND.q, BEYOND.r),
  );
  const afterExtension = pathOf(partById(await h.snapshot(), track)?.cells);
  const freshBeyond = await refusesPlacement(() =>
    h.debug.placeTrack(BEYOND.q, BEYOND.r),
  );
  const parts = (await partIds(h)).length;

  await h.advance(1);
  await captureStill(h, "refused");

  assertEqual(
    extendedBeyond,
    true,
    `extending the track onto (${BEYOND.q}, ${BEYOND.r}) is refused: the cell is off the field`,
  );
  assertDeepEqual(
    afterExtension,
    pathOf(LAID),
    "the refused extension left the path exactly as it was laid",
  );
  assertEqual(
    freshBeyond,
    true,
    `a one-cell track on (${BEYOND.q}, ${BEYOND.r}) is refused: the cell is off the field`,
  );
  assertEqual(parts, 1, "the refused track added no part: the machine holds the one path");
});
