// editor/an-arm-outranks-a-sigil-on-a-shared-hex — where an arm is anchored on a
// hex of a sigil's footprint, the press takes the arm.
//
// THE RULE. "When parts share the hex, the topmost is taken: an arm or wheel
// anchored there, else a track with that cell, else the sigil whose footprint
// covers it" (`specs/editor.md`, Selection on the field). `specs/parts.md`'s
// placement rule 4 is what allows the two onto one hex: "An arm or wheel's anchor
// may sit on any sigil footprint hex, a rise's and a set's included, or on a track
// cell."
//
// THE ORDER OF THE RANKING IS BY CLASS, NOT BY PLACEMENT ORDER — the rule names an
// anchored arm ahead of the sigil whose footprint covers the hex, and says nothing
// about which was put down first. So the configuration is posed BOTH ways round,
// the sigil placed first and the arm placed first, and each is decided on its own.
//
// THE CONFIGURATION. `BARE` opened in the editor, and for each order a `bind`
// sigil anchored at `(0, 0)` at rotation `0` — whose footprint is `(0, 0)` and
// `(1, 0)` per `specs/sigils.md` — with one arm anchored on `(1, 0)`, the second of
// those two hexes. Nothing else is on the field, and the machine is emptied
// between the two orders. The press lands on the center of `(1, 0)` and is
// released there, which "commits no move".
//
// THE VERDICT. In both orders `editor.selected` names the arm, and the sigil's
// footprint really does cover the pressed hex.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { at, hexCenter, sameHex, type Hex } from "../field";
import { BARE, ORIGIN } from "../fixtures";
import { sigilHexes } from "../parts";
import {
  captureStill,
  clearWorld,
  createHarness,
  openChallengeDocument,
  placePart,
  pressAt,
  releasePointer,
  type Harness,
} from "../harness";

/** The hex the arm is anchored on: `bind`'s second footprint hex at rotation 0. */
const SHARED: Hex = at(1, 0);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("selects the arm rather than the sigil beneath it, in either order", async () => {
  assertTrue(
    sigilHexes("bind", ORIGIN, 0).some((hex) => sameHex(hex, SHARED)),
    `bind anchored at (${ORIGIN.q}, ${ORIGIN.r}) covers (${SHARED.q}, ${SHARED.r}), so the two parts share the pressed hex`,
  );

  await openChallengeDocument(h, BARE);

  for (const sigilFirst of [true, false]) {
    await clearWorld(h);

    let arm = -1;
    if (sigilFirst) {
      await placePart(h, "bind", ORIGIN);
      arm = await placePart(h, "arm", SHARED);
    } else {
      arm = await placePart(h, "arm", SHARED);
      await placePart(h, "bind", ORIGIN);
    }

    await h.debug.setSelected(null);
    await pressAt(h, hexCenter(SHARED));
    await h.advance(1);
    await captureStill(h, "arm");
    const selected = (await h.snapshot()).editor.selected;
    await releasePointer(h);

    assertEqual(
      selected,
      arm,
      `with the ${sigilFirst ? "sigil placed first" : "arm placed first"}, the press on the shared hex takes the anchored arm`,
    );
  }
});
