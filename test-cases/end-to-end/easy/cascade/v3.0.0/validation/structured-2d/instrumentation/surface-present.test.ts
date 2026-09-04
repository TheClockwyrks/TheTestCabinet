// instrumentation/surface-present — the build returned its debug surface, the
// surface is whole, and it is really wired to the running game.
//
// THE RULE. specs/instrumentation.md makes the surface a deliverable: the game
// instance's `initialize` returns it, the engine holds that same object and
// hands it back from `engine.debug`, and it is reached that way alone. The file
// fixes `version` as `CASCADE_DEBUG_VERSION` (`1`), names every operation the
// surface carries, and states what an operation MEANS — a pose arranges the
// running game, and the game's own rules run from there exactly as they do in
// play.
//
// THREE READINGS, IN THE ORDER A FAULT WOULD SHOW.
//
//   1. The surface is there at all. `engine.debug` holds whatever the build's
//      instance returned; nothing here can stand in for it, because the build's
//      own module for the surface is never imported.
//   2. It is complete. `version` is the number the specification fixes, and
//      every operation `surface.ts` lists — the case's specification written
//      down as types — is a function on it. `setAutoStep` and `advance` are
//      deliberately NOT demanded: the engine owns the clock under this engine
//      and those two belong to the engineless build alone, so requiring them
//      here would fail a perfectly conformant build.
//   3. It is LIVE. A surface whose operations exist and arrange nothing is
//      present and useless. So a card is posed and read back off the snapshot,
//      and a move is posed and applied by the game's own rules.
//
// THE LIVE READING USES THE PLAINEST LEGAL MOVE THERE IS: a black eight onto a
// red nine, one column onto another (specs/tableau.md). Every other item in
// this suite drives the surface to pose its own scenario, so a surface that is
// missing or inert also shows up as those items failing; this one names the
// fault outright.
//
// WHAT IT DOES NOT DECIDE. Which rule accepted the move — that is
// `tableau.build-down-alternating` — nor that every pose is reported, which is
// `instrumentation/poses-read-back`.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDoesNotThrow,
  assertEqual,
  assertLength,
  assertNotNull,
} from "../assert";
import {
  EIGHT,
  NINE,
  captureStill,
  card,
  createHarness,
  openTable,
  pileOf,
  poseColumn,
  topOf,
  type Harness,
} from "../harness";
import { CASCADE_DEBUG_VERSION, REQUIRED_OPS } from "../surface";

/** The column the run is lifted from, and the one it lands on. */
const SOURCE_COLUMN = 1;
const TARGET_COLUMN = 0;

/** The card posed on the target column: a red nine, which takes a black eight. */
const TARGET_CARD = card("hearts", NINE);

/** The card posed on the source column, and moved. */
const MOVED_CARD = card("spades", EIGHT);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns its debug surface from initialize", () => {
  // `engine.debug` holds whatever the build's instance returned, so reading it
  // IS the check: there is no page property to look for under this engine.
  assertDoesNotThrow(() => h.engine.debug);
  assertNotNull(h.engine.debug, "the surface engine.debug hands back");
  assertEqual(
    typeof h.engine.debug,
    "object",
    "the surface engine.debug hands back",
  );

  // The engine hands back the value the instance returned, unchanged and
  // unwrapped, so every read is the same object — the one every check in this
  // suite poses the game through.
  assertEqual(
    h.engine.debug,
    h.engine.debug,
    "two reads of engine.debug are the same object",
  );
});

it("carries the specified version and every specified operation, as functions", () => {
  const api = h.engine.debug as unknown as Record<string, unknown>;

  assertEqual(typeof api.version, "number", "the type of version");
  assertEqual(
    api.version,
    CASCADE_DEBUG_VERSION,
    "version, which specs/instrumentation.md fixes as CASCADE_DEBUG_VERSION",
  );
  for (const operation of REQUIRED_OPS) {
    assertEqual(
      typeof api[operation],
      "function",
      `the ${operation} operation specs/instrumentation.md names`,
    );
  }
});

it("is live: a posed card reads back and a posed move applies", async () => {
  openTable(h);

  // The pose reads back. `poseCard` reads the id off the pile the card was
  // appended to, so a build whose `addCard` added nothing fails here already;
  // the readings below name the card that arrived.
  poseColumn(h, TARGET_COLUMN, [TARGET_CARD]);
  const [movedId] = poseColumn(h, SOURCE_COLUMN, [MOVED_CARD]);
  const posed = h.snapshot();
  assertLength(
    pileOf(posed, "tableau", TARGET_COLUMN),
    1,
    `cards on column ${TARGET_COLUMN} after one addCard (specs/instrumentation.md)`,
  );
  assertEqual(
    topOf(pileOf(posed, "tableau", TARGET_COLUMN))?.rank,
    TARGET_CARD.rank,
    "the rank the snapshot reports for the posed card",
  );

  // The pose is a real arrangement, so the game's own move rules run from it:
  // a black eight onto a red nine (specs/tableau.md).
  const accepted = h.debug.move(
    "tableau",
    SOURCE_COLUMN,
    0,
    "tableau",
    TARGET_COLUMN,
  );
  const after = h.snapshot();

  await h.advance(1);
  captureStill(h, "live");

  assertEqual(
    accepted,
    true,
    `move() to accept the ${MOVED_CARD.suit} eight onto the ` +
      `${TARGET_CARD.suit} nine, one rank lower and the other colour ` +
      "(specs/tableau.md)",
  );
  assertEqual(
    topOf(pileOf(after, "tableau", TARGET_COLUMN))?.id,
    movedId,
    `the card lowest on column ${TARGET_COLUMN} once the move was applied, ` +
      "which is the card the move carried (specs/tableau.md)",
  );
  assertLength(
    pileOf(after, "tableau", SOURCE_COLUMN),
    0,
    `cards left on column ${SOURCE_COLUMN}, which the accepted move emptied ` +
      "(specs/tableau.md)",
  );
});
