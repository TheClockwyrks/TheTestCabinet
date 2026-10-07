// editor/an-edit-changes-the-edited-part-alone — moving, rotating, resizing or
// deleting one part leaves every other part exactly as it stands.
//
// THE RULE. "An edit changes the edited part alone" (`specs/editor.md`, Dragging),
// which is the whole of the point: the four verbs each name one part — a move
// translates "the whole part ... a track's path included" by the drag's offset,
// `part-cw` and `part-ccw` "turn an arm, a wheel, or a sigil one rotation step",
// `part-grow` and `part-shrink` "change an arm's length", and `part-delete`
// "removes any part" — and the state `specs/instrumentation.md` reports for a part
// is its `q`, `r`, `rotation`, `length`, `cells`, `closed` and `tape`. So a
// bystander is unchanged when every one of those fields still reads what it read.
//
// THE CONFIGURATION. `BARE` opened in the editor and a machine loaded that holds
// one part of each shape that could be disturbed, none of them touching another:
//
// - the SUBJECT, an arm on `(0, 0)`, which every edit below is aimed at;
// - a bystander arm on `(-3, 0)` at rotation `2`, length `2`, with a written tape;
// - a bystander wheel on `(-3, 3)` at rotation `1`, with its own tape;
// - a bystander track `(0, 3)`, `(1, 3)`, `(2, 3)`, whose cells a careless move
//   would translate along with the subject's;
// - a bystander `bind` sigil on `(0, -3)`, which the rotation verbs also turn.
//
// The four edits then run in turn on the subject alone, each through the player's
// own hands: a drag from `(0, 0)` to `(1, 0)`, then `part-cw`, then `part-grow`,
// then `part-delete`, the press that opened the drag having selected the subject
// and set the focus to the field.
//
// EACH EDIT IS READ BOTH WAYS. After each, the subject is asserted to have
// actually changed — moved, turned, grown, gone — so a build that does nothing at
// all fails here rather than passing for want of a bystander to disturb; and every
// bystander's seven fields are asserted to read exactly what they read before.
//
// THE VERDICT. Four edits, four times the subject changed and the four bystanders
// did not.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
import { at, hexCenter } from "../field";
import { armPart, sigilPart, solution, trackPart } from "../formats";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
  drag,
  loadMachine,
  openChallengeDocument,
  partById,
  partIds,
  pressAction,
  type Harness,
  type OrrerySnapshot,
  type PartView,
} from "../harness";

/** Where the subject arm stands, and where the drag takes it. */
const SUBJECT_HEX = at(0, 0);
const SUBJECT_TO = at(1, 0);

/** Every field `specs/instrumentation.md` reports for a part, as one comparable line. */
function record(part: PartView): string {
  const cells = (part.cells ?? [])
    .map((cell) => `${cell.q},${cell.r}`)
    .join(" ");
  const tape = (part.tape ?? []).map((cell) => cell ?? "-").join(" ");
  return [
    part.kind,
    `${part.q},${part.r}`,
    part.rotation,
    part.length,
    `[${cells}]`,
    String(part.closed),
    `[${tape}]`,
  ].join("|");
}

/** The bystanders' records, keyed by id, so one comparison covers all four. */
function bystanders(snapshot: OrrerySnapshot, subject: number): string[] {
  return snapshot.editor.parts
    .filter((part) => part.id !== subject)
    .map((part) => `${part.id}=${record(part)}`);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves every other part's anchor, rotation, length, path and tape untouched", async () => {
  await openChallengeDocument(h, BARE);
  await loadMachine(
    h,
    solution([
      armPart("arm", SUBJECT_HEX.q, SUBJECT_HEX.r, 0, 1, []),
      armPart("arm", -3, 0, 2, 2, ["grab", "rotate-cw"]),
      armPart("wheel", -3, 3, 1, 1, ["rotate-cw"]),
      trackPart([at(0, 3), at(1, 3), at(2, 3)]),
      sigilPart("bind", 0, -3, 0),
    ]),
  );
  const subject = (await partIds(h))[0] ?? -1;
  assertLength(
    (await h.snapshot()).editor.parts,
    5,
    "the subject and its four bystanders are all on the field",
  );

  // The move.
  let before = await h.snapshot();
  await drag(h, hexCenter(SUBJECT_HEX), hexCenter(SUBJECT_TO));
  await h.advance(1);
  await captureStill(h, "untouched");
  let after = await h.snapshot();
  assertEqual(
    `${partById(after, subject)?.q},${partById(after, subject)?.r}`,
    `${SUBJECT_TO.q},${SUBJECT_TO.r}`,
    "the move really moved the subject, so there was an edit for a bystander to feel",
  );
  assertDeepEqual(
    bystanders(after, subject),
    bystanders(before, subject),
    "moving one part leaves every other part's anchor, rotation, length, path and tape as they stand",
  );

  // The rotation.
  before = after;
  await pressAction(h, "part-cw");
  after = await h.snapshot();
  assertEqual(
    partById(after, subject)?.rotation,
    1,
    "part-cw really turned the subject one rotation step",
  );
  assertDeepEqual(
    bystanders(after, subject),
    bystanders(before, subject),
    "rotating one part leaves every other part exactly as it stands",
  );

  // The resize.
  before = after;
  await pressAction(h, "part-grow");
  after = await h.snapshot();
  assertGreaterThan(
    partById(after, subject)?.length ?? 0,
    1,
    "part-grow really lengthened the subject, so there was an edit for a bystander to feel",
  );
  assertDeepEqual(
    bystanders(after, subject),
    bystanders(before, subject),
    "resizing one part leaves every other part exactly as it stands",
  );

  // The deletion.
  before = after;
  await pressAction(h, "part-delete");
  after = await h.snapshot();
  assertNull(
    partById(after, subject),
    "part-delete really removed the subject",
  );
  assertNotNull(
    after.editor.parts[0],
    "the bystanders are still on the field after the subject is deleted",
  );
  assertDeepEqual(
    bystanders(after, subject),
    bystanders(before, subject),
    "deleting one part leaves every other part exactly as it stands",
  );
});
