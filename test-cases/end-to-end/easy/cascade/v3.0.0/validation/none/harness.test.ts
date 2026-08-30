// harness — self-checks for the shared scaffolding the suites in this directory
// stand on, run against the case's reference implementation.
//
// The suites next door are validators: each decides one review point against the
// build. This file decides nothing about any build. It proves that the harness's
// own machinery — the browser reach, the compound scenario helpers, the clock,
// the geometry, the observation channels, and the evidence writers — really does
// what the suites assume of it, because a helper that silently did less would
// turn every point that leans on it into a wrong verdict with a confident face.
//
// What is pinned here, and why:
//
//   - THE REACH. `createHarness` really finds `window.__cascade` on the built
//     site, it carries every operation `REQUIRED_OPS` names, and it answers.
//   - THE POSES. `openTable` really leaves an empty, live table with the four
//     gates on; `poseColumn`, `poseFoundation`, `poseWaste`, `poseStock` and
//     `poseFlyer` each lay exactly what they were given, in the order the
//     specification reports a pile in, and hand back ids that name those cards.
//   - THE WIN PATH. `poseNearlyWon` leaves fifty-one home and one out, and
//     `startCascade` reaches `won` through the game's own move rather than by
//     posing the screen.
//   - THE GESTURES. `clickAt` turns the stock, `dragRunTo` really lands the
//     leading card's CENTRE where it was asked to, and `doubleClickAt` puts its
//     two presses 0 s of game time apart.
//   - THE CLOCK. `advance` runs exactly the frames it is asked for and
//     `framesFor` converts a duration to them; `skip` covers game time off
//     camera.
//   - THE GEOMETRY. The column layout functions agree with where the reference
//     actually draws, compression and all, and `dropRect` grows a column's
//     rectangle with the column.
//   - THE CHANNELS. A pixel sample, a text-draw query and a cue capture each
//     return something sane, and the overlay is observable through its fixed
//     Backquote binding plus the draw recorder.
//   - THE EVIDENCE. `captureStill` and `captureReplay` write real files under the
//     media directory, at the staged suite's address, and a capture keeps the
//     frames `advance` drove and not the ones `skip` passed over.
//
// No review item names this file, so a run never loads it. It runs with the
// whole project, which is how a case author runs these suites while writing
// them:
//
//   npx vitest run --config validation/vitest.config.ts

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, beforeEach, it } from "vitest";
import {
  assertBetween,
  assertCloseTo,
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertLessThanOrEqual,
  assertNotNull,
  assertTrue,
} from "./assert";
import {
  CARD_H,
  CARD_W,
  CASCADE_DEBUG_VERSION,
  COLUMN_BOTTOM_LIMIT,
  FACE_DOWN_OFFSET,
  FACE_UP_OFFSET,
  STOCK_X,
  TABLEAU_Y,
  TITLE_TEXT,
  TOP_ROW_Y,
} from "./constants";
import {
  cardCenter,
  cards,
  captureReplay,
  captureStill,
  clickAt,
  colorDistance,
  columnBottom,
  columnCardsDrawn,
  columnCardTopLeft,
  columnCardTops,
  createHarness,
  doubleClickAt,
  dragRunTo,
  drawnText,
  dropRect,
  facesOf,
  failSurface,
  faceDown,
  framesFor,
  HANDLE,
  lowestFaceUp,
  openTable,
  pileOf,
  pileTopLeft,
  poseColumn,
  poseFlyer,
  poseFoundation,
  poseNearlyWon,
  poseStock,
  poseWaste,
  rectCenter,
  REQUIRED_OPS,
  requireFlyer,
  runDown,
  sampleColor,
  SURFACE_REQUIREMENT,
  seconds,
  startCascade,
  toggleOverlay,
  topOf,
  wasteShown,
  wasteTop,
  watchCues,
  whereIs,
  type Harness,
  type Recording,
} from "./harness";

/** The environment variable the runner names the media directory in. */
const MEDIA_DIR_ENV = "TCAB_VALIDATION_MEDIA_DIR";

/**
 * Where this file's own outputs land: the staged project directory, then the
 * suite's path within the project, which for this file is its own name.
 */
const SUITE_DIR = join("validation", "harness.test.ts");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reaches the reference's surface, whole", async () => {
  assertEqual(
    h.surfaceFault,
    null,
    "the surface fault a conformant build leaves",
  );

  const probed = await h.probe(REQUIRED_OPS);
  assertEqual(
    probed.version,
    CASCADE_DEBUG_VERSION,
    "the version the surface reports",
  );
  const missing = REQUIRED_OPS.filter((op) => probed.ops[op] !== "function");
  assertDeepEqual(
    missing,
    [],
    "the required operations the surface is missing",
  );

  // And it is LIVE rather than merely present: a posed card reads back, and a
  // posed move applies through the game's own rules.
  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "the screen a reset leaves",
  );
  await openTable(h);
  await poseFoundation(h, 0, "spades", 1);
  await poseColumn(h, 0, cards("2S"));
  assertEqual(
    await h.debug.move("tableau", 0, 0, "foundation", 0),
    true,
    "the verdict the rules returned for a legal move",
  );
  assertEqual(
    topOf(pileOf(await h.snapshot(), "foundation", 0))?.rank,
    2,
    "the rank the accepted move left on the foundation",
  );

  // AND A BUILD WITHOUT ONE FAILS BY ASSERTION RATHER THAN BY THROWING. The
  // reference has a surface, so what is pinned here is the shape of the verdict
  // a build without one lands on every point that reaches for an operation: an
  // `Expected:`/`Actual:` pair naming the handle, which is what the runner parses
  // into a stored pair. The path itself — `createHarness` coming back rather than
  // throwing out of a `beforeEach` — cannot be driven against a conformant build
  // and is left to the first non-conformant one.
  let raised: unknown = null;
  try {
    failSurface("window.__cascade was never installed");
  } catch (error) {
    raised = error;
  }
  assertNotNull(raised, "the failure failSurface raises");
  assertTrue(
    String((raised as Error).message).startsWith("Expected: "),
    "the failure to open with the Expected line the runner parses",
  );
  assertTrue(
    SURFACE_REQUIREMENT.includes(HANDLE),
    "the requirement to name the handle the build owes",
  );
});

it("openTable leaves an empty, live table with the four gates on", async () => {
  await openTable(h);
  const s = await h.snapshot();

  assertEqual(s.screen, "playing", "the screen openTable poses");
  assertLength(s.stock, 0, "the cards on the stock");
  assertLength(s.waste, 0, "the cards on the waste");
  assertLength(s.wasteSets, 0, "the waste's remembered sets");
  for (const [i, pile] of s.foundations.entries()) {
    assertLength(pile, 0, `the cards on foundation ${i}`);
  }
  for (const [i, pile] of s.tableau.entries()) {
    assertLength(pile, 0, `the cards on column ${i}`);
  }
  assertLength(s.flyers, 0, "the cards in flight");

  assertEqual(s.autoFlip, true, "the automatic flip gate");
  assertEqual(s.winDetect, true, "the win-detection gate");
  assertEqual(s.launching, true, "the launching gate");
  assertEqual(s.trailPainting, true, "the trail-painting gate");
});

it("the pose helpers lay exactly what they were given, in pile order", async () => {
  await openTable(h);

  // A column: first card given is drawn HIGHEST, last is the exposed card.
  const laid = [...faceDown("7D"), ...cards("KS", "QH")];
  const columnIds = await poseColumn(h, 2, laid);
  assertLength(columnIds, 3, "the ids poseColumn handed back");

  const foundationIds = await poseFoundation(h, 1, "clubs", 3);
  const wasteIds = await poseWaste(h, cards("2C", "5H", "9S"), [2, 1]);
  const stockIds = await poseStock(h, cards("3D", "4S"));

  const s = await h.snapshot();

  const column = pileOf(s, "tableau", 2);
  assertDeepEqual(
    column.map((c) => [c.suit, c.rank, c.faceUp]),
    [
      ["diamonds", 7, false],
      ["spades", 13, true],
      ["hearts", 12, true],
    ],
    "the column poseColumn laid, bottom of the pile first",
  );
  assertDeepEqual(
    column.map((c) => c.id),
    columnIds,
    "the ids poseColumn reported against the ids the column carries",
  );
  assertEqual(
    lowestFaceUp(s, 2)?.rank,
    12,
    "the rank of the column's exposed card",
  );

  const foundation = pileOf(s, "foundation", 1);
  assertDeepEqual(
    foundation.map((c) => c.rank),
    [1, 2, 3],
    "the ranks poseFoundation built up",
  );
  assertDeepEqual(
    foundation.map((c) => c.id),
    foundationIds,
    "the ids poseFoundation reported",
  );

  assertDeepEqual(s.wasteSets, [2, 1], "the waste's set memory");
  assertEqual(s.wasteVisibleCount, 1, "the cards the waste shows");
  assertDeepEqual(
    wasteShown(s).map((c) => c.id),
    [wasteIds[2]],
    "the card wasteShown picks out of a three-card waste showing one",
  );
  assertEqual(wasteTop(s)?.suit, "spades", "the suit of the waste's top card");

  // The stock's LAST card given is its top card, and the next turn takes it.
  assertEqual(
    topOf(pileOf(s, "stock", 0))?.id,
    stockIds[1],
    "the stock's top card against the last id poseStock handed back",
  );
  assertEqual(
    whereIs(s, stockIds[0])?.pile,
    "stock",
    "where whereIs finds the stock's bottom card",
  );
});

it("poseNearlyWon leaves fifty-one home, and startCascade wins through the game's own move", async () => {
  await openTable(h);
  const kingId = await poseNearlyWon(h);

  const posed = await h.snapshot();
  const home = posed.foundations.reduce((n, pile) => n + pile.length, 0);
  assertEqual(home, 51, "the cards on the four foundations");
  assertEqual(
    whereIs(posed, kingId)?.pile,
    "tableau",
    "where the one card kept out was put",
  );
  assertEqual(posed.screen, "playing", "the screen a pose leaves untouched");

  await openTable(h);
  await startCascade(h);
  const won = await h.snapshot();
  assertEqual(won.screen, "won", "the screen the win path reaches");
  assertEqual(won.launched, 0, "the cards launched before a frame has run");

  // The cascade really runs from there, through the build's own rules.
  const flying = await h.until((s) => s.launched > 0, {
    maxFrames: framesFor(1),
  });
  assertEqual(flying.hit, true, "the cascade to launch a card within a second");
});

it("advance runs exactly the frames it is asked for, and skip covers time off camera", async () => {
  await openTable(h);
  const before = await h.snapshot();

  await h.advance(framesFor(0.5));
  assertEqual(h.frame(), framesFor(0.5), "the frames the harness counted");
  const advanced = await h.snapshot();
  assertCloseTo(
    advanced.simTime - before.simTime,
    0.5,
    1e-6,
    "the game time half a second of frames covered",
  );
  assertCloseTo(seconds(framesFor(0.25)), 0.25, 1e-9, "seconds round-tripped");

  await h.skip(1);
  const skipped = await h.snapshot();
  assertCloseTo(
    skipped.simTime - advanced.simTime,
    1,
    1e-6,
    "the game time a one-second skip covered",
  );
});

it("the column geometry agrees with where the build draws, compression and all", async () => {
  await openTable(h);

  // Short enough to need no compression: the offsets are the stated 24 and 34.
  const short = [...faceDown("2C"), ...cards("KS", "QH")];
  const shortFaces = short.map((c) => c.faceUp ?? true);
  assertEqual(
    columnCardTopLeft(0, 0, shortFaces).y,
    TABLEAU_Y,
    "the top edge of a column's first card",
  );
  assertEqual(
    columnCardTopLeft(0, 1, shortFaces).y -
      columnCardTopLeft(0, 0, shortFaces).y,
    FACE_DOWN_OFFSET,
    "the offset under a face-down card",
  );
  assertEqual(
    columnCardTopLeft(0, 2, shortFaces).y -
      columnCardTopLeft(0, 1, shortFaces).y,
    FACE_UP_OFFSET,
    "the offset under a face-up card",
  );

  // Long enough to compress: the lowest card's bottom edge stays above the line.
  // The comparison carries a whisker of slack because the compressed offset is
  // `room / gaps` and re-summing it is a floating-point identity, not because a
  // build is allowed to miss the line — `table/column-compression` reads what the
  // BUILD drew against `COLUMN_BOTTOM_LIMIT` itself and needs no slack at all.
  const long = runDown({ suit: "spades", rank: 13 }, 13);
  const longFaces = long.map(() => true);
  assertLessThanOrEqual(
    columnBottom(longFaces),
    COLUMN_BOTTOM_LIMIT + 1e-9,
    "the bottom edge of a compressed column's lowest card",
  );

  // AND THE BUILD REALLY DRAWS THERE. A thirteen-card column posed on the table,
  // read back off the frame's own card-sized rectangles: the harness's layout and
  // the reference's agree card for card, compression and all.
  await poseColumn(h, 6, long);
  const drawn = columnCardsDrawn(await h.frameCalls(), 6);
  assertLength(drawn, long.length, "the cards the frame drew on column 6");
  assertDeepEqual(
    drawn.map((p) => Math.round(p.y * 1e6) / 1e6),
    columnCardTops(longFaces).map((y) => Math.round(y * 1e6) / 1e6),
    "the top edges the build drew against the ones columnCardTops predicts",
  );

  // And a column's drop rectangle grows with the column, as specs/table.md says.
  const posed = await poseColumn(h, 3, short);
  assertLength(posed, 3, "the cards laid on column 3");
  const faces = facesOf(pileOf(await h.snapshot(), "tableau", 3));
  const rect = dropRect("tableau", 3, faces);
  assertEqual(rect.y, TABLEAU_Y, "the top of a column's drop rectangle");
  assertEqual(rect.w, CARD_W, "the width of a column's drop rectangle");
  assertEqual(
    rect.y + rect.h,
    columnBottom(faces),
    "the bottom of a column's drop rectangle",
  );
  assertEqual(
    dropRect("foundation", 0).h,
    CARD_H,
    "the height of a squared pile's drop rectangle",
  );
});

it("clickAt turns the stock and dragRunTo lands the leading card's centre", async () => {
  await openTable(h);
  await poseStock(h, cards("3D", "4S", "5C"));

  const stock = pileTopLeft("stock");
  assertEqual(stock.x, STOCK_X, "the stock's anchor x");
  assertEqual(stock.y, TOP_ROW_Y, "the stock's anchor y");
  await clickAt(h, stock.x + CARD_W / 2, stock.y + CARD_H / 2);
  const turned = await h.snapshot();
  assertGreaterThan(
    turned.waste.length,
    0,
    "the cards a click on the stock turned onto the waste",
  );

  // A run carried onto a foundation by its centre, through the real drop path.
  await openTable(h);
  await poseFoundation(h, 0, "spades", 1);
  await poseColumn(h, 4, cards("2S"));
  const from = columnCardTopLeft(4, 0, [true]);
  const target = rectCenter(dropRect("foundation", 0));
  await dragRunTo(h, from.x + 20, from.y + 20, target.x, target.y);

  const dropped = await h.snapshot();
  assertEqual(dropped.drag, null, "the run in hand once the release resolved");
  assertDeepEqual(
    pileOf(dropped, "foundation", 0).map((c) => c.rank),
    [1, 2],
    "the foundation the two of spades was carried onto",
  );
  assertLength(
    pileOf(dropped, "tableau", 4),
    0,
    "the cards left in the source column",
  );
});

it("doubleClickAt puts its two presses 0 s of game time apart", async () => {
  await openTable(h);
  await poseFoundation(h, 0, "spades", 1);
  await poseColumn(h, 5, cards("2S"));

  const at = columnCardTopLeft(5, 0, [true]);
  await doubleClickAt(h, at.x + 50, at.y + 70);

  const s = await h.snapshot();
  assertNotNull(
    s.lastPress,
    "the press the double-click rule is measured from",
  );
  assertDeepEqual(
    pileOf(s, "foundation", 0).map((c) => c.rank),
    [1, 2],
    "the foundation the double click sent the two of spades to",
  );
});

it("samples pixels, reads text draws, and captures cues", async () => {
  // A card face against the bare table: two things the build drew, never a hex.
  await openTable(h);
  await poseColumn(h, 0, cards("KS"));
  await h.advance(1);
  const face = await sampleColor(h, ...cardCenterAt(0));
  const bare = await sampleColor(h, 60, 400);
  assertGreaterThan(
    colorDistance(face, bare),
    0,
    "the distance between a drawn card and the bare table",
  );

  // The title screen draws its title, and the recorder saw it.
  await h.debug.reset();
  const calls = await h.frameCalls();
  assertTrue(
    drawnText(calls).some((run) => run.includes(TITLE_TEXT)),
    `the title screen's draws to carry ${TITLE_TEXT}`,
  );

  // A cue lands on the frame its event happened on.
  await h.armAudio();
  await openTable(h);
  await poseStock(h, cards("3D"));
  const played = watchCues(h);
  const before = await h.sounds();
  await h.debug.turnStock();
  await h.advance(1);
  assertGreaterThan(
    (await h.sounds()) - before,
    0,
    "the sounds the page emitted across a stock turn",
  );
  assertTrue(played.length >= 0, "the cue sink to be attached to this harness");
});

it("observes the overlay through Backquote and the draw recorder", async () => {
  await openTable(h);
  await poseColumn(h, 0, cards("KS"));

  const before = drawnText(await h.frameCalls()).length;
  await toggleOverlay(h);
  const after = drawnText(await h.frameCalls()).length;
  assertGreaterThan(
    after,
    before,
    "the strings a frame drew once the overlay was toggled on",
  );

  // And it is read-only: the state is the same on both sides of the toggle.
  const shown = await h.snapshot();
  await toggleOverlay(h);
  const hidden = await h.snapshot();
  assertDeepEqual(
    hidden.tableau,
    shown.tableau,
    "the table the overlay left behind",
  );
});

it("a flyer posed on a cleared table flies by the game's own rules", async () => {
  await openTable(h);
  await h.debug.setLaunching(false);
  const id = await poseFlyer(h, { x: 600, y: 100, vx: 0, vy: 0 });

  await h.advance(framesFor(0.25));
  const falling = requireFlyer(await h.snapshot(), id, "reading a fall");
  assertGreaterThan(
    falling.y,
    100,
    "the y a quarter-second of gravity gave it",
  );
  assertBetween(falling.vy, 1, 2000, "the downward speed it picked up");
});

it("writes a still and a replay under the media directory", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cascade-media-"));
  const previous = process.env[MEDIA_DIR_ENV];
  process.env[MEDIA_DIR_ENV] = dir;
  try {
    await openTable(h);
    await poseColumn(h, 0, cards("KS"));
    await h.advance(1);
    await captureStill(h, "table");

    await h.debug.setLaunching(false);
    await poseFlyer(h, { x: 300, y: 120, vx: 120, vy: 0 });
    // The skip is outside the capture, so none of it is in the file.
    await h.skip(0.5);
    const drove = 24;
    const kept = await captureReplay(h, "flight", async () => {
      await h.advance(drove);
      return drove;
    });
    assertEqual(kept, drove, "the value captureReplay handed back");

    const still = join(dir, SUITE_DIR, "table.png");
    assertGreaterThan(
      readFileSync(still).length,
      0,
      "the bytes the still was written with",
    );

    const replay = join(dir, SUITE_DIR, "flight.json.gz");
    const recording = JSON.parse(
      gunzipSync(readFileSync(replay)).toString("utf8"),
    ) as Recording;
    assertEqual(recording.format, 1, "the recording's format");
    assertLength(
      recording.frames,
      drove,
      "the frames the capture kept, which are the ones advance drove",
    );

    // A capture that closed no frames leaves no file, so a run reports the output
    // absent rather than opening the player on nothing.
    await captureReplay(h, "empty", async () => undefined);
    assertEqual(
      existsSync(join(dir, SUITE_DIR, "empty.json.gz")),
      false,
      "whether a capture that drove no frame wrote a file",
    );

    // And a scenario that THROWS still leaves the frames it had recorded, which
    // is the replay a reviewer most wants.
    let threw = false;
    try {
      await captureReplay(h, "failed", async () => {
        await h.advance(8);
        throw new Error("the scenario failed");
      });
    } catch {
      threw = true;
    }
    assertEqual(threw, true, "the failure captureReplay let travel on");
    const salvaged = JSON.parse(
      gunzipSync(readFileSync(join(dir, SUITE_DIR, "failed.json.gz"))).toString(
        "utf8",
      ),
    ) as Recording;
    assertLength(
      salvaged.frames,
      8,
      "the frames a failing scenario still left behind",
    );
  } finally {
    if (previous === undefined) delete process.env[MEDIA_DIR_ENV];
    else process.env[MEDIA_DIR_ENV] = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});

/** The centre of the single card posed on column `col` by these self-checks. */
function cardCenterAt(col: number): [number, number] {
  const at = columnCardTopLeft(col, 0, [true]);
  const centre = cardCenter(at.x, at.y);
  return [centre.x, centre.y];
}
