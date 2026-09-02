// editor/an-arm-outranks-a-track-on-a-shared-hex — where an arm is anchored on a
// track cell, the press takes the arm.
//
// THE RULE. "When parts share the hex, the topmost is taken: an arm or wheel
// anchored there, else a track with that cell, else the sigil whose footprint
// covers it" (`specs/editor.md`, Selection on the field). `specs/parts.md` is what
// puts the two on one hex in the first place: "An arm or wheel's anchor may sit on
// any sigil footprint hex, a rise's and a set's included, or on a track cell;
// sitting on a track cell is what mounts it" (placement rule 4).
//
// THE ORDER OF THE RANKING IS BY CLASS, NOT BY PLACEMENT ORDER — the rule names an
// anchored arm ahead of a track holding the hex as a cell, and says nothing about
// which was put down first. So the configuration is posed BOTH ways round, the
// track laid first and the arm placed first, and each is decided on its own.
//
// THE CONFIGURATION. `BARE` opened in the editor, and for each order a three-cell
// open track running `(-1, 0)`, `(0, 0)`, `(1, 0)` with one arm anchored on its
// middle cell `(0, 0)`. Nothing else is on the field, and the machine is emptied
// between the two orders. The press lands on the center of `(0, 0)`, the one hex
// the two parts share, and is released there, which "commits no move".
//
// THE VERDICT. In both orders `editor.selected` names the arm, and the track it
// stands on really does hold that hex as one of its cells.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { at, hexCenter, sameHex, type Hex } from "../field";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureStill,
  clearWorld,
  createHarness,
  openChallengeDocument,
  partById,
  placePart,
  placeTrack,
  pressAt,
  releasePointer,
  type Harness,
} from "../harness";

/** A three-cell open track whose middle cell is the arm's anchor. */
const PATH: readonly Hex[] = [at(-1, 0), ORIGIN, at(1, 0)];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("selects the mounted arm rather than the track under it, in either order", async () => {
  await openChallengeDocument(h, BARE);

  for (const trackFirst of [true, false]) {
    await clearWorld(h);

    let track = -1;
    let arm = -1;
    if (trackFirst) {
      track = await placeTrack(h, PATH);
      arm = await placePart(h, "arm", ORIGIN);
    } else {
      arm = await placePart(h, "arm", ORIGIN);
      track = await placeTrack(h, PATH);
    }

    const laid = partById(await h.snapshot(), track);
    assertTrue(
      (laid?.cells ?? []).some((cell) => sameHex(cell, ORIGIN)),
      `the track holds (${ORIGIN.q}, ${ORIGIN.r}) as one of its cells, so the two parts share the pressed hex`,
    );

    await h.debug.setSelected(null);
    await pressAt(h, hexCenter(ORIGIN));
    await h.advance(1);
    await captureStill(h, "arm");
    const selected = (await h.snapshot()).editor.selected;
    await releasePointer(h);

    assertEqual(
      selected,
      arm,
      `with the ${trackFirst ? "track laid first" : "arm placed first"}, the press on the shared hex takes the anchored arm`,
    );
  }
});
