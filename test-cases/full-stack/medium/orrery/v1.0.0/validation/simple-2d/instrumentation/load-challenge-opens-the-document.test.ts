// instrumentation/load-challenge-opens-the-document — `loadChallenge` opens an
// arbitrary challenge document.
//
// THE RULE. "`loadChallenge(challenge)` — The open challenge becomes
// `challenge`, a challenge document in the format of `specs/formats.md`, leaving
// the same editor state `openChallenge` leaves" (`specs/instrumentation.md`, The
// challenge) — which is "an empty machine, empty histories, no run, and the tray
// derived from the challenge". "A challenge posed by either operation is a
// challenge like any other, and every rule of `specs/editor.md` and
// `specs/simulation.md` applies to it unchanged."
//
// WHAT THE DOCUMENT CARRIES is `specs/formats.md`: `name`, "`reagents` and
// `products` are non-empty lists of molecules", "`permitted` ... lists the part
// kinds the tray offers", and "`target` is the tally every set must reach, at
// least `1`". The snapshot reports the open challenge with exactly those fields.
//
// HOW MUCH OF THE DOCUMENT IS HELD TO THE BYTE. The counts, the types and the
// figures, rather than a deep comparison of the whole: `specs/formats.md` fixes
// what a molecule MEANS and lets a reader normalise what it does not fix — "A
// reader treats an absent `repeat` and a `repeat` of `null` alike" — so a build
// that reports a normalised copy of what it was handed is conformant.
//
// THE TRAY IS READ WHERE `specs/editor.md` MAKES IT READABLE: "a press inside
// entry `k` begins placing that part", and "A press in the tray outside every
// entry does nothing beyond setting the focus". The editor screen is entered
// explicitly with `setScreen("editor")` — "Shows the editor over the open
// challenge, leaving the machine, both histories, and any live run as they stand"
// — because this row says what `loadChallenge` leaves BEHIND, not which screen it
// moves to.
//
// THE CONFIGURATION. A dirty editor first: an Extras challenge entered, two parts
// dragged from its tray with the pointer so both histories are non-empty, and a
// live run started over them. Then a document of this project's own — two
// reagents, two products, two permitted kinds and a target — is handed over. The
// document is authored against `specs/formats.md`, never read off a build.
//
// THE VERDICT. The open challenge is the document's: its name, its target, its
// permitted kinds, and its reagents and products, mote for mote. The machine is
// empty, both depths are `0`, `sim` is `null`, and the tray is the six entries
// the document derives, with nothing in the slot past them.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertNotNull,
  assertNull,
} from "../assert";
import { at, traySlot } from "../field";
import { derivedTray } from "../formats";
import { TWO_AND_TWO } from "../fixtures";
import {
  captureStill,
  centerOf,
  createHarness,
  dragFromTray,
  openChallenge,
  openTitle,
  pressAction,
  pressAt,
  releasePointer,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("makes the document the open challenge, on the empty editor openChallenge leaves", async () => {
  await openTitle(h);
  await openChallenge(h, "extras", 0);
  await dragFromTray(h, 0, at(0, 0));
  await dragFromTray(h, 0, at(2, 0));
  await pressAction(h, "undo");
  await h.debug.startRun();
  const dirty = await h.snapshot();
  assertGreaterThan(dirty.editor.parts.length, 0, "a machine stands");
  assertGreaterThan(dirty.editor.undoDepth, 0, "an undo history stands");
  assertGreaterThan(dirty.editor.redoDepth, 0, "a redo history stands");
  assertNotNull(dirty.sim, "and a run is live");

  await h.debug.loadChallenge(TWO_AND_TWO);
  await h.debug.setScreen("editor");
  await h.advance(1);
  await captureStill(h, "loaded");

  const loaded = await h.snapshot();
  const open = loaded.challenge;
  assertNotNull(open, "the document is the open challenge");
  assertEqual(open?.name, TWO_AND_TWO.name, "under the document's own name");
  assertEqual(
    open?.target,
    TWO_AND_TWO.target,
    "with the document's own target",
  );
  assertDeepEqual(
    [...(open?.permitted ?? [])].sort(),
    [...TWO_AND_TWO.permitted].sort(),
    "and the document's own permitted kinds",
  );
  assertEqual(
    open?.reagents.length,
    TWO_AND_TWO.reagents.length,
    "the challenge carries the document's reagents",
  );
  assertEqual(
    open?.products.length,
    TWO_AND_TWO.products.length,
    "and the document's products",
  );
  assertDeepEqual(
    (open?.reagents ?? []).map((molecule) =>
      molecule.motes.map((mote) => mote.type),
    ),
    TWO_AND_TWO.reagents.map((molecule) =>
      molecule.motes.map((mote) => mote.type),
    ),
    "reagent for reagent, mote for mote",
  );
  assertDeepEqual(
    (open?.products ?? []).map((molecule) =>
      molecule.motes.map((mote) => mote.type),
    ),
    TWO_AND_TWO.products.map((molecule) =>
      molecule.motes.map((mote) => mote.type),
    ),
    "product for product, mote for mote",
  );

  assertDeepEqual(
    loaded.editor.parts,
    [],
    "the editor it leaves holds an empty machine",
  );
  assertEqual(loaded.editor.undoDepth, 0, "with an empty undo history");
  assertEqual(loaded.editor.redoDepth, 0, "with an empty redo history");
  assertNull(loaded.sim, "and no run");

  const expected = derivedTray(TWO_AND_TWO);
  for (const [slot, entry] of expected.entries()) {
    await pressAt(h, centerOf(traySlot(slot)));
    const drag = (await h.snapshot()).editor.drag;
    await releasePointer(h);
    assertEqual(
      drag?.kind,
      "place",
      `tray slot ${slot} of the loaded challenge begins a placement`,
    );
    assertEqual(
      drag?.kind === "place" ? drag.part : null,
      entry.kind,
      `tray slot ${slot} places the kind the document derives there`,
    );
    assertEqual(
      drag?.kind === "place" ? drag.index : null,
      entry.index,
      `tray slot ${slot} carries the reagent or product index it derives`,
    );
  }
  await pressAt(h, centerOf(traySlot(expected.length)));
  const past = (await h.snapshot()).editor.drag;
  await releasePointer(h);
  assertNull(
    past,
    "and the slot past the last entry begins nothing, so the tray is the document's length",
  );
});
