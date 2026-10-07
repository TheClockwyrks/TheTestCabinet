// instrumentation/place-track — `placeTrack(q, r)` places a one-cell open track.
//
// THE RULE. "`placeTrack(q, r)` | Places a one-cell open track on `(q, r)`"
// (`specs/instrumentation.md`, The machine). `specs/parts.md` says such a track is
// a legal part: "A track is an ordered path of distinct hexes, `cells`... A track
// of one cell is legal and open." And the snapshot reports a track's path and its
// loop flag: "`cells: [{ q, r }] | null`, `closed: <boolean | null>`"
// (`specs/instrumentation.md`, Snapshot shape).
//
// THE CONFIGURATION. A challenge open in the editor and NOTHING else placed —
// `loadChallenge` leaves "an empty machine, empty histories, no run" — then one
// call to `placeTrack` on `(2, -1)`, a hex of the field. No run is started,
// because the requirement is about what the editor's machine holds.
//
// THE VERDICT. The machine holds exactly one part; it is a `track`; its path is
// the one cell `(2, -1)` and nothing else; and its `closed` is `false`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import { at } from "../field";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  partById,
  placeTrack,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("places one open track cell and reports its path", async () => {
  await h.debug.reset();
  await openChallengeDocument(h, BARE);

  const seed = at(2, -1);
  const track = await placeTrack(h, [seed]);
  await h.advance(1);
  await captureStill(h, "seed");

  const snapshot = await h.snapshot();
  assertEqual(
    snapshot.editor.parts.length,
    1,
    "placeTrack places one part and nothing else",
  );
  const placed = partById(snapshot, track);
  assertNotNull(placed, "the machine reports the track placeTrack placed");
  assertEqual(placed?.kind, "track", "the part placed is a track");
  assertDeepEqual(
    (placed?.cells ?? []).map((cell) => `${cell.q},${cell.r}`),
    ["2,-1"],
    "the track's cells hold (2, -1) alone",
  );
  assertEqual(
    placed?.closed,
    false,
    "a one-cell track is open, as specs/parts.md states",
  );
});
