// instrumentation/clear-machine-removes-every-part — `clearMachine` removes every
// placed part.
//
// THE RULE. "`clearMachine()` — Removes every placed part, empties both
// histories, and clears the selection, the cursor, and any live drag"
// (`specs/instrumentation.md`, The machine). This item is the first clause. The
// snapshot carries the machine as `editor.parts`, "placement order; the tape
// panel's row order", and the same file gives a second reading of it:
// "`readSolution()` — A pure read: the current machine as a solution document,
// exactly what `loadSolution` would accept to rebuild it."
//
// EVERY PLACED PART MEANS EVERY CLASS OF THEM. `specs/formats.md` divides a
// solution's parts into four classes — "Arms and wheels", "`track`", "Sigils",
// and "`rise`, `set`" — and `specs/instrumentation.md` gives each its own
// placement operation. So the machine cleared here holds one of each: an arm, a
// wheel, a track, a sigil, a rise and a set, placed far enough apart that every
// placement rule of `specs/parts.md` holds across the whole list.
//
// WHAT IS LEFT IS READ THREE WAYS. The parts list is empty; every one of the six
// kinds is gone from it by name, so a build that cleared five classes and kept
// one is caught by the class it kept; and the two derived figures fall to their
// resting values — `editor.cost` is "`PART_COSTS` over the parts", which is `0`
// over none, and `editor.period` rests at `1`. The picture of the bare field is
// this item's evidence.
//
// THE CONFIGURATION. `BARE`, whose one reagent and one product are each a single
// mote, so a rise and a set each occupy one hex and the six parts fit the field
// comfortably. No run is started: the machine alone is what this item is about.
//
// THE VERDICT. `editor.parts` is empty, no part of any of the six kinds remains,
// the machine reads back as a solution document with no parts, and cost and
// period stand at their resting values.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import type { PartName } from "../constants";
import { at } from "../field";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
  openTitle,
  partsOfKind,
  placePart,
  placeRise,
  placeSet,
  placeTrack,
  readMachine,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

const KINDS: readonly PartName[] = [
  "arm",
  "wheel",
  "track",
  "bind",
  "rise",
  "set",
];

it("leaves an empty machine, whatever classes of part it held", async () => {
  await openTitle(h);
  await h.debug.loadChallenge(BARE);
  await h.debug.setScreen("editor");

  await placeRise(h, 0, at(-4, 0), 0);
  await placeSet(h, 0, at(4, 0), 0);
  await placePart(h, "arm", at(0, -3), 0);
  await placePart(h, "wheel", at(0, 3), 0);
  await placeTrack(h, [at(-2, 2), at(-1, 2), at(0, 2)]);
  await placePart(h, "bind", at(2, -2), 0);

  const built = await h.snapshot();
  assertLength(
    built.editor.parts,
    6,
    "one part of each of the six kinds stands on the field",
  );
  for (const kind of KINDS) {
    assertLength(
      partsOfKind(built, kind),
      1,
      `a ${kind} stands on the field to be removed`,
    );
  }

  await h.debug.clearMachine();
  await h.advance(1);
  await captureStill(h, "bare");

  const cleared = await h.snapshot();
  assertDeepEqual(
    cleared.editor.parts,
    [],
    "clearMachine removes every placed part",
  );
  for (const kind of KINDS) {
    assertLength(
      partsOfKind(cleared, kind),
      0,
      `no ${kind} is left on the field`,
    );
  }
  assertDeepEqual(
    (await readMachine(h)).parts,
    [],
    "and the machine reads back as a solution document with no parts",
  );
  assertEqual(
    cleared.editor.cost,
    0,
    "PART_COSTS over no parts is a cost of 0",
  );
  assertEqual(
    cleared.editor.period,
    1,
    "and a machine with no tapes rests at period 1",
  );
});
