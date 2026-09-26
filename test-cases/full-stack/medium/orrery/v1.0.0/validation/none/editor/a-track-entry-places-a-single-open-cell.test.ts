// editor/a-track-entry-places-a-single-open-cell — the track entry is the one tray
// entry whose release lays a path, and the path it lays is one cell long and open.
//
// THE RULE. "From the tray: ... A `TRACK` ENTRY PLACES A SINGLE OPEN CELL"
// (`specs/editor.md`, Dragging). `specs/parts.md` says what such a track is: "A
// `track` is an ordered path of distinct hexes, `cells`, laid one hex at a time in
// the editor... A track is `closed` when its last cell is adjacent to its first
// AND THE EDITOR HAS JOINED THEM INTO A LOOP... otherwise it is open. A TRACK OF
// ONE CELL IS LEGAL AND OPEN."
//
// THE CONFIGURATION. A challenge permitting `track` alone, so the tray's first
// entry IS the track entry — "Its entries are, in order: the challenge's
// `permitted` part kinds, in the order of `PARTS`... then one `rise` per reagent
// ... then one `set` per product" (`specs/editor.md`, The tray) — and no other
// mechanism entry can be taken by mistake. The machine is the empty one
// `loadChallenge` leaves, so the cell the release lays is the only cell on the
// field and rule 3, "No hex is a cell of two tracks", cannot be what shapes it.
// One gesture: a press in the middle of entry `0`, a move onto `ORIGIN`, and a
// release there.
//
// THE VERDICT. The machine holds exactly one part, it is a `track`, its `cells`
// hold exactly `ORIGIN`, and its `closed` flag is `false`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { challenge, loneMote } from "../formats";
import { ORIGIN } from "../fixtures";
import {
  captureStill,
  createHarness,
  dragFromTray,
  openChallengeDocument,
  partById,
  partIds,
  type Harness,
} from "../harness";

/** A tray of one mechanism entry: the track, at slot `0`. */
const TRACK_ONLY = challenge({
  name: "Track Only",
  reagents: [loneMote("dust")],
  products: [loneMote("dust")],
  permitted: ["track"],
});

const TRACK_SLOT = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lays one open cell on the hex the release targeted", async () => {
  await openChallengeDocument(h, TRACK_ONLY);
  await dragFromTray(h, TRACK_SLOT, ORIGIN);
  await h.advance(1);
  await captureStill(h, "cell");

  const ids = await partIds(h);
  assertEqual(ids.length, 1, "the track entry's release placed one part");

  const track = partById(await h.snapshot(), ids[0] as number);
  assertEqual(track?.kind, "track", "the entry places a track");
  assertDeepEqual(
    (track?.cells ?? []).map((cell) => `${cell.q},${cell.r}`),
    [`${ORIGIN.q},${ORIGIN.r}`],
    "its path holds exactly the targeted hex: a single cell",
  );
  assertEqual(
    track?.closed,
    false,
    "and a track of one cell is open, so its closed flag is false",
  );
});
