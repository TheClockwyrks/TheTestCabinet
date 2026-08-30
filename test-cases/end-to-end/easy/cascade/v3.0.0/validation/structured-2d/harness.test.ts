// harness — self-checks for the shared machinery the suites in this directory
// stand on.
//
// The suites next door are validators: each decides one review point against the
// build. This file decides nothing about the build. It proves the HARNESS's own
// load-bearing pieces against the reference implementation, because each is
// invisible from inside a suite and wrong in ways nothing else catches: a
// surface the harness cannot reach fails every suite at once, an `openTable`
// that leaves a card behind pollutes every scenario posed on it, an id read from
// the wrong end of a pile addresses the wrong card, a grab point computed
// without the fan lifts the card above the one the check meant, a canvas shim
// that stopped working fails every build that paints a trail, and media written
// in the wrong framing reaches the console as something it cannot read.
//
// No review item names this file, so a run never loads it. It runs with the
// whole project, which is how a case author runs these suites while writing
// them:
//
//   npx vitest run --config validation/vitest.config.ts

import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  CARD_H,
  CARD_W,
  COLUMN_X,
  CUES,
  DECK_SIZE,
  FACE_UP_OFFSET,
  FOUNDATION_X,
  HUD_SOUND,
  LAUNCH_INTERVAL,
  STOCK_X,
  TABLEAU_Y,
  TITLE_NEW_GAME,
  TITLE_TEXT,
  TOP_ROW_Y,
  WASTE_X,
} from "../src/constants";
import { drawingSurfacesAvailable } from "./canvas-shim";
import {
  ACE,
  CASCADE_HZ,
  KING,
  QUEEN,
  alternatingRun,
  canvasPixels,
  captureReplay,
  captureStill,
  card,
  cardById,
  cardTopLeft,
  cardsHome,
  clearCues,
  clearColor,
  clickAt,
  clickControl,
  colorDistance,
  columnCardTopLeft,
  columnFaces,
  createHarness,
  cuesNamed,
  dealInPlay,
  doubleClickAt,
  down,
  drag,
  dragThroughEvents,
  drawnShapes,
  drawnText,
  drawnTextSpans,
  drawOps,
  drewText,
  dropRectIn,
  everyCard,
  flyerById,
  grabPoint,
  openTable,
  pileOf,
  pixelsChanged,
  poseCard,
  poseColumn,
  poseFlyer,
  poseFoundation,
  poseNearlyWon,
  poseStock,
  poseWaste,
  readDebugSurface,
  pressAt,
  rectCenter,
  shapesAt,
  releaseAt,
  resetTo,
  sampleCard,
  siteOf,
  startCascade,
  toggleOverlay,
  topOf,
  wasteShown,
  wasteTopPoint,
  watchCues,
  type Harness,
} from "./harness";
import {
  CASCADE_DEBUG_VERSION,
  REQUIRED_OPS,
  SNAPSHOT_FIELDS,
} from "./surface";

/** The environment variable the runner names the media directory in. */
const MEDIA_DIR_ENV = "TCAB_VALIDATION_MEDIA_DIR";

/**
 * Where this file's own outputs land: the staged project directory, then the
 * suite's path within the project, which for this file is its own name.
 */
const SUITE_DIR = join("validation", "harness.test.ts");

let mediaDir: string;
let collecting: string | undefined;
let h: Harness;

beforeEach(async () => {
  collecting = process.env[MEDIA_DIR_ENV];
  mediaDir = mkdtempSync(join(tmpdir(), "cascade-media-"));
  process.env[MEDIA_DIR_ENV] = mediaDir;
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
  if (collecting === undefined) delete process.env[MEDIA_DIR_ENV];
  else process.env[MEDIA_DIR_ENV] = collecting;
  rmSync(mediaDir, { recursive: true, force: true });
});

/** What this suite wrote into its own output directory, by file name. */
function written(): string[] {
  try {
    return readdirSync(join(mediaDir, SUITE_DIR)).sort();
  } catch {
    // The directory is made only when there is something to put in it.
    return [];
  }
}

it("stands both browser drawing surfaces up for the painted layer", () => {
  expect(drawingSurfacesAvailable()).toBe(true);
  // Both are really usable, which is the whole point of the shim: the build
  // reaches for whichever it likes and gets a 2D context back.
  const offscreen = new OffscreenCanvas(64, 32) as unknown as {
    getContext(kind: "2d"): unknown;
  };
  expect(offscreen.getContext("2d")).not.toBeNull();
  const element = document.createElement("canvas");
  element.width = 64;
  element.height = 32;
  expect(element.getContext("2d")).not.toBeNull();
});

it("reaches the surface the reference returned from initialize", () => {
  expect(h.engine.debug).not.toBeNull();
  expect(typeof h.engine.debug).toBe("object");
  const api = h.engine.debug as unknown as Record<string, unknown>;
  expect(api.version).toBe(CASCADE_DEBUG_VERSION);
  for (const op of REQUIRED_OPS) {
    expect(typeof api[op], op).toBe("function");
  }
  // And the snapshot really carries the shape `surface.ts` writes down.
  const snapshot = h.snapshot() as unknown as Record<string, unknown>;
  for (const field of SNAPSHOT_FIELDS) {
    expect(field in snapshot, field).toBe(true);
  }
  expect(h.assetFailures).toEqual([]);
});

it("resets to the title without advancing a frame", () => {
  h.debug.setScreen("playing");
  poseCard(h, "tableau", 3, card("hearts", QUEEN));
  h.debug.setAutoFlip(false);
  h.debug.setLaunching(false);

  resetTo(h, 7);

  const s = h.snapshot();
  expect(s.screen).toBe("title");
  expect(s.stock).toHaveLength(0);
  expect(s.waste).toHaveLength(0);
  expect(s.wasteSets).toHaveLength(0);
  expect(s.tableau.every((column) => column.length === 0)).toBe(true);
  expect(s.foundations.every((pile) => pile.length === 0)).toBe(true);
  expect(s.drag).toBeNull();
  expect(s.lastPress).toBeNull();
  expect(s.flyers).toHaveLength(0);
  expect(s.trailStamps).toBe(0);
  expect(s.simTime).toBe(0);
  // The four gates come back on, whatever a scenario left them at.
  expect(s.autoFlip).toBe(true);
  expect(s.winDetect).toBe(true);
  expect(s.launching).toBe(true);
  expect(s.trailPainting).toBe(true);
});

it("opens an empty table with every gate left on", () => {
  openTable(h, 3);

  const s = h.snapshot();
  expect(s.screen).toBe("playing");
  expect(everyCard(s)).toHaveLength(0);
  expect(s.wasteSets).toHaveLength(0);
  expect(s.autoFlip).toBe(true);
  expect(s.winDetect).toBe(true);
  expect(s.launching).toBe(true);
  expect(s.trailPainting).toBe(true);
});

it("poses each pile bottom card first, and hands back the ids in that order", () => {
  openTable(h);

  const column = poseColumn(h, 2, [
    down(card("spades", KING)),
    card("hearts", QUEEN),
    card("clubs", 11),
  ]);
  expect(column).toHaveLength(3);
  expect(new Set(column).size).toBe(3);
  const posed = pileOf(h.snapshot(), "tableau", 2);
  expect(posed.map((entry) => entry.id)).toEqual(column);
  expect(posed[0].faceUp).toBe(false);
  expect(topOf(posed)?.rank).toBe(11);
  expect(columnFaces(h.snapshot(), 2)).toEqual([false, true, true]);

  const foundation = poseFoundation(h, 1, "diamonds", 4);
  expect(foundation).toHaveLength(4);
  expect(pileOf(h.snapshot(), "foundation", 1).map((c) => c.rank)).toEqual([
    1, 2, 3, 4,
  ]);

  // The stock's LAST card is the one the next turn takes, and it is face-down.
  poseStock(h, [card("clubs", 2), card("clubs", 3)]);
  const stock = pileOf(h.snapshot(), "stock");
  expect(stock.every((entry) => !entry.faceUp)).toBe(true);
  expect(topOf(stock)?.rank).toBe(3);

  // The waste's cards and its set memory are posed separately, and
  // `wasteVisibleCount` follows the newest set.
  poseWaste(
    h,
    [card("hearts", 5), card("hearts", 6), card("hearts", 7)],
    [2, 1],
  );
  const withSets = h.snapshot();
  expect(withSets.wasteSets).toEqual([2, 1]);
  expect(withSets.wasteVisibleCount).toBe(1);
  expect(wasteShown(withSets).map((entry) => entry.rank)).toEqual([7]);

  // A pose whose sets outrun its cards describes a waste that cannot exist.
  expect(() => poseWaste(h, [card("spades", ACE)], [2])).toThrow(
    /over the 1 cards given/,
  );

  // A card keeps its id wherever it goes, so `siteOf` finds it after a move.
  const site = siteOf(h.snapshot(), column[2]);
  expect(site?.pile).toBe("tableau");
  expect(site?.index).toBe(2);
  expect(site?.row).toBe(2);
  expect(cardById(h.snapshot(), column[2])?.rank).toBe(11);
});

it("places the cards where the build then draws them", async () => {
  openTable(h);
  poseColumn(h, 4, [card("spades", KING), card("hearts", QUEEN)]);
  poseCard(h, "foundation", 2, card("clubs", ACE));
  poseCard(h, "stock", 0, down(card("diamonds", 9)));
  poseWaste(h, [card("diamonds", 3)], [1]);

  const calls = await h.drawFrame();
  const shapes = drawnShapes(h, calls);

  // Each anchor `specs/table.md` fixes carries a card-sized rectangle.
  const anchors: [number, number][] = [
    [STOCK_X, TOP_ROW_Y],
    [WASTE_X, TOP_ROW_Y],
    [FOUNDATION_X[2], TOP_ROW_Y],
    [COLUMN_X[4], TABLEAU_Y],
  ];
  for (const [x, y] of anchors) {
    const found = shapesAt(shapes, x, y).find(
      (shape) =>
        Math.abs(shape.w - CARD_W) < 1 && Math.abs(shape.h - CARD_H) < 1,
    );
    expect(found, `a card-sized rectangle at (${x}, ${y})`).toBeDefined();
  }

  // The second card of a column sits one face-up offset below the first, which
  // is exactly what `columnCardTopLeft` computes from the column's own faces.
  const faces = columnFaces(h.snapshot(), 4);
  const second = columnCardTopLeft(4, 1, faces);
  expect(second.y).toBeCloseTo(TABLEAU_Y + FACE_UP_OFFSET, 6);
  expect(cardTopLeft(h.snapshot(), "tableau", 4, 1)).toEqual(second);
  expect(shapesAt(shapes, second.x, second.y).length).toBeGreaterThan(0);

  // And a column's drop rectangle runs down to that card's bottom edge.
  const rect = dropRectIn(h.snapshot(), "tableau", 4);
  expect(rect.w).toBe(CARD_W);
  expect(rect.y + rect.h).toBeCloseTo(second.y + CARD_H, 6);
});

it("aims a press at the card a check meant, in a column and on the waste", () => {
  openTable(h);
  // Three face-up cards: the middle one is reachable only in the band above the
  // card below it, which is what `grabPoint` returns.
  poseColumn(h, 0, alternatingRun(KING, 3));

  const middle = grabPoint(h.snapshot(), 0, 1);
  pressAt(h, middle.x, middle.y);
  const held = h.snapshot().drag;
  expect(held?.cards).toHaveLength(2);
  expect(held?.cards[0].rank).toBe(QUEEN);
  releaseAt(h, middle.x, middle.y);
  expect(h.snapshot().drag).toBeNull();

  // The waste's top card is reached at a point that lies on it under either
  // deal mode, whatever the shown set fans to.
  poseWaste(h, [card("hearts", 4)], [1]);
  const waste = wasteTopPoint();
  pressAt(h, waste.x, waste.y);
  expect(h.snapshot().drag?.cards).toHaveLength(1);
  expect(h.snapshot().drag?.fromPile).toBe("waste");
  releaseAt(h, waste.x, waste.y);
});

it("drives clicks, drops and double clicks through the real input path", () => {
  // A click on a title control activates it, with no frame advanced.
  resetTo(h, 1);
  clickControl(h, TITLE_NEW_GAME);
  expect(h.snapshot().screen).toBe("playing");
  expect(cardsHome(h.snapshot()) + h.snapshot().stock.length).toBeGreaterThan(
    0,
  );

  // A drop: a run carried far enough to be a drop, released over a foundation
  // that accepts it.
  openTable(h);
  poseColumn(h, 0, [card("spades", ACE)]);
  const from = grabPoint(h.snapshot(), 0, 0);
  const to = rectCenter(dropRectIn(h.snapshot(), "foundation", 0));
  drag(h, from, to);
  expect(pileOf(h.snapshot(), "foundation", 0)).toHaveLength(1);
  expect(pileOf(h.snapshot(), "tableau", 0)).toHaveLength(0);

  // A CLICK on the stock turns it, because the release lies zero units from the
  // press and so is a click rather than a drop (specs/controls.md).
  openTable(h);
  poseStock(h, [card("clubs", 8)]);
  const stock = rectCenter(dropRectIn(h.snapshot(), "stock"));
  clickAt(h, stock.x, stock.y);
  expect(pileOf(h.snapshot(), "waste").length).toBeGreaterThan(0);

  // A double click: two clicks with no game time between them send a card home.
  openTable(h);
  poseColumn(h, 1, [card("hearts", ACE)]);
  const at = grabPoint(h.snapshot(), 1, 0);
  doubleClickAt(h, at.x, at.y);
  expect(cardsHome(h.snapshot())).toBe(1);
});

it("delivers a whole gesture inside one frame through the sample list", async () => {
  openTable(h);
  poseColumn(h, 0, [card("spades", ACE)]);
  const from = grabPoint(h.snapshot(), 0, 0);
  const to = rectCenter(dropRectIn(h.snapshot(), "foundation", 3));

  await dragThroughEvents(h, from, to);

  expect(pileOf(h.snapshot(), "foundation", 3)).toHaveLength(1);
  expect(h.snapshot().drag).toBeNull();
});

it("enters the cascade through the game's own win path", async () => {
  const posed = startCascade(h);

  const won = h.snapshot();
  expect(won.screen).toBe("won");
  expect(cardsHome(won)).toBe(DECK_SIZE);
  expect(cardById(won, posed.id)?.suit).toBe(posed.suit);

  // The launch clock opens holding one interval, so the first card launches on
  // the cascade's first frame; the harness only ran the frames.
  expect(won.launched).toBe(0);
  await h.advance(1);
  expect(h.snapshot().launched).toBe(1);
  expect(h.snapshot().flyers).toHaveLength(1);
});

it("poses a flyer the build's own cascade then carries", async () => {
  openTable(h);
  h.debug.setLaunching(false);
  const id = poseFlyer(h, card("hearts", KING), 400, 200, 240, 0);

  const before = flyerById(h.snapshot(), id);
  expect(before?.x).toBeCloseTo(400, 6);
  expect(before?.vy).toBeCloseTo(0, 6);

  await h.advanceSeconds(0.25);
  const after = flyerById(h.snapshot(), id);
  // Gravity is the build's, and so is the travel: the harness posed and stepped.
  expect(after?.x).toBeGreaterThan(before!.x);
  expect(after?.vy).toBeGreaterThan(0);
});

it("counts frames against the clock the harness installed", async () => {
  expect(h.hz).toBe(60);
  expect(h.framesFor(0.5)).toBe(30);
  expect(h.secondsFor(30)).toBeCloseTo(0.5, 9);

  openTable(h);
  await h.advanceSeconds(1);
  expect(h.snapshot().simTime).toBeCloseTo(1, 6);

  // A cascade suite steps finer, because a quantity under acceleration is not
  // independent of how the interval was divided.
  const fine = await createHarness({ hz: CASCADE_HZ });
  try {
    expect(fine.hz).toBe(CASCADE_HZ);
    expect(fine.framesFor(LAUNCH_INTERVAL * 2)).toBe(86);
    openTable(fine);
    await fine.advanceSeconds(0.5);
    expect(fine.snapshot().simTime).toBeCloseTo(0.5, 6);
  } finally {
    fine.dispose();
  }
});

it("reads the text, the pixels and the geometry a frame drew", async () => {
  resetTo(h, 1);
  const title = await h.drawFrame();
  expect(drewText(title, TITLE_TEXT)).toBe(true);
  expect(drawnText(title).length).toBeGreaterThan(0);
  expect(drawOps(title)).toBeGreaterThan(0);

  const span = drawnTextSpans(h, title).find((entry) =>
    entry.text.toLowerCase().includes(TITLE_TEXT.toLowerCase()),
  );
  expect(span, "the title copy, placed").toBeDefined();
  expect(span!.left).toBeLessThan(span!.right);

  // A card drawn on the felt reads apart from the felt it was drawn on.
  openTable(h);
  await h.advance(1);
  const bare = canvasPixels(h);
  poseCard(h, "tableau", 6, card("hearts", KING));
  await h.advance(1);
  expect(pixelsChanged(bare, canvasPixels(h))).toBeGreaterThan(0);

  const face = sampleCard(h, COLUMN_X[6], TABLEAU_Y);
  expect(colorDistance(face, clearColor())).toBeGreaterThan(30);
});

it("hears the cues the build played, on the frame it played them", async () => {
  openTable(h);
  const played = watchCues(h);

  poseStock(h, [card("spades", 5)]);
  h.debug.turnStock();
  expect(played.filter((cue) => cue.cue === CUES.turn).length).toBe(1);
  expect(cuesNamed(h, CUES.turn)).toHaveLength(1);

  // The bus is the engine's: a muted cue still announces itself, at zero gain,
  // which is how a check tells a build that reacted from one that never did.
  clearCues(h);
  clickControl(h, HUD_SOUND);
  await h.advance(1);
  expect(h.snapshot().muted).toBe(true);
  clearCues(h);
  poseStock(h, [card("spades", 6)]);
  h.debug.turnStock();
  const muted = cuesNamed(h, CUES.turn);
  expect(muted).toHaveLength(1);
  expect(muted[0].gain).toBe(0);
});

it("observes the diagnostics overlay through the recorded context", async () => {
  openTable(h);
  const bare = drawnText(await h.drawFrame());

  // Backquote toggles the engine-owned overlay; the sources the build
  // registered draw through the same recorded context, so new text runs appear.
  const overlaid = drawnText(await toggleOverlay(h));
  expect(overlaid.length).toBeGreaterThan(bare.length);

  // And toggling again takes it back down.
  const gone = drawnText(await toggleOverlay(h));
  expect(gone.length).toBeLessThan(overlaid.length);
  expect(gone.length).toBe(bare.length);
});

it("sweeps with until, and drives the engine's own loop with runFor", async () => {
  startCascade(h);

  const flying = await h.until((s) => s.flyers.length >= 3, {
    maxFrames: h.framesFor(2),
    poll: 2,
  });
  expect(flying.hit).toBe(true);
  expect(flying.frames).toBeGreaterThan(0);

  // A sweep that never sees its predicate reports so rather than hanging.
  const missed = await h.until((s) => s.screen === "title", { maxFrames: 8 });
  expect(missed.hit).toBe(false);
  expect(missed.frames).toBe(8);

  const before = h.engine.frame().count;
  await h.runFor(60);
  expect(h.engine.frame().count).toBeGreaterThan(before);
});

it("writes a still and a replay under the suite's own address", async () => {
  dealInPlay(h, 5);
  await h.advance(1);
  captureStill(h, "dealt");

  // Armed around the section alone: the frames before it are not in the file.
  await captureReplay(h, "turn", async () => {
    h.debug.turnStock();
    await h.advance(4);
  });

  expect(written()).toEqual(["dealt.png", "turn.json.gz"]);

  // The still is a PNG: the eight-byte signature opens the file.
  const png = readFileSync(join(mediaDir, SUITE_DIR, "dealt.png"));
  expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);

  // The replay is really gzip-framed (RFC 1952), and the document inside holds
  // the four frames the section drove and no more.
  const bytes = readFileSync(join(mediaDir, SUITE_DIR, "turn.json.gz"));
  expect([bytes[0], bytes[1]]).toEqual([0x1f, 0x8b]);
  const recording = JSON.parse(gunzipSync(bytes).toString("utf8")) as {
    format: number;
    frames: unknown[];
  };
  expect(recording.format).toBeGreaterThan(0);
  expect(recording.frames).toHaveLength(4);
});

it("costs nothing and changes nothing when nobody is collecting media", async () => {
  delete process.env[MEDIA_DIR_ENV];
  openTable(h);

  const value = await captureReplay(h, "unused", async () => {
    await h.advance(2);
    return "the scenario's own value";
  });
  captureStill(h, "unused");

  expect(value).toBe("the scenario's own value");
  expect(written()).toEqual([]);
});

it("hands a scenario's failure on, and still writes what it recorded", async () => {
  openTable(h);

  await expect(
    captureReplay(h, "failing", async () => {
      await h.advance(6);
      throw new Error("the check's own failure");
    }),
  ).rejects.toThrow("the check's own failure");

  expect(written()).toEqual(["failing.json.gz"]);
});

it("names the missing surface rather than throwing a TypeError", () => {
  // A build whose `initialize` returned no surface is a fault in the BUILD, and
  // it must land on the check that reached for an operation rather than on the
  // `beforeEach` that built the harness — which is why nothing is thrown when
  // the surface is read and everything is thrown when it is used.
  const standIn = readDebugSurface({
    debug: null,
  } as unknown as Parameters<typeof readDebugSurface>[0]);

  // The machinery's own probes are answered quietly, so the verdict below is not
  // buried under noise from the reporter trying to print it.
  expect((standIn as unknown as { then?: unknown }).then).toBeUndefined();

  // And the verdict itself is the Expected/Actual pair the runner stores.
  let message = "";
  try {
    standIn.snapshot();
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  expect(message).toContain("Expected: the debug surface");
  expect(message).toContain("engine.debug");
  expect(message).toContain('Actual: "engine.debug holds null, not an object"');
});

it("poses a nearly-won table one legal move from the win", () => {
  const posed = poseNearlyWon(h, { suit: "hearts", column: 5 });

  const s = h.snapshot();
  expect(cardsHome(s)).toBe(DECK_SIZE - 1);
  expect(s.screen).toBe("playing");
  expect(pileOf(s, "tableau", posed.column)).toHaveLength(1);
  expect(topOf(pileOf(s, "tableau", posed.column))?.rank).toBe(KING);
  expect(topOf(pileOf(s, "foundation", posed.foundation))?.rank).toBe(QUEEN);
  expect(s.stock).toHaveLength(0);
  expect(s.waste).toHaveLength(0);
});
