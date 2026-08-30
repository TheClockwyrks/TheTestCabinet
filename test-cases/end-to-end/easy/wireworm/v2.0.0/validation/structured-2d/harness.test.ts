// harness — self-checks for the shared machinery the suites in this directory
// stand on.
//
// The suites next door are validators: each decides one review point against
// the build. This file decides nothing about the build. It proves the
// HARNESS's own load-bearing pieces against the reference implementation,
// because each is invisible from inside a suite and wrong in ways nothing else
// catches: a surface the harness cannot reach fails every suite at once, a
// `startPlaying` that leaves a gate open pollutes every scenario posed on it,
// an id read from the wrong end of a roster addresses the wrong entity, a
// sprite shim that does not serve the seeded tree grades every art check
// against fallback shapes, and media written in the wrong framing reaches the
// console as something it cannot read.
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
  CURSOR_X_MAX,
  CURSOR_Y_MIN,
  CUES,
  DROPPER_CHECK_INTERVAL,
  START_LIVES,
  TITLE_TEXT,
  tileCX,
  tileCY,
} from "../src/constants";
import {
  BAND_CX,
  BAND_CY,
  canvasPixels,
  captureReplay,
  captureStill,
  chargeAt,
  clearCues,
  createHarness,
  cuesNamed,
  drawnImages,
  drawnText,
  drewText,
  foeById,
  headOf,
  holdFor,
  nearestSeededFrame,
  nodeAt,
  pixelsChanged,
  poseBoltAtTile,
  poseFoe,
  poseWorm,
  poseWormPath,
  resetTo,
  sampleTile,
  startPlaying,
  tapAction,
  ticksFor,
  toggleOverlay,
  watchCues,
  wormById,
  type Harness,
} from "./harness";
import { REQUIRED_OPS, WIREWORM_DEBUG_VERSION } from "./surface";

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
  mediaDir = mkdtempSync(join(tmpdir(), "wireworm-media-"));
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

it("reaches the surface the reference returned from initialize", () => {
  expect(h.engine.debug).not.toBeNull();
  expect(typeof h.engine.debug).toBe("object");
  const api = h.engine.debug as unknown as Record<string, unknown>;
  expect(api.version).toBe(WIREWORM_DEBUG_VERSION);
  for (const op of REQUIRED_OPS) {
    expect(typeof api[op], op).toBe("function");
  }
});

it("resets to the title without advancing a frame", () => {
  h.debug.setScreen("playing");
  h.debug.setScore(4321);
  h.debug.setNode(5, 5, 3);

  resetTo(h, 7);

  const s = h.snapshot();
  expect(s.screen).toBe("title");
  expect(s.phase).toBe("banner");
  expect(s.score).toBe(0);
  expect(s.lives).toBe(START_LIVES);
  expect(s.level).toBe(1);
  expect(s.nodes).toHaveLength(0);
  expect(s.simTime).toBe(0);
  // The three world gates come back on, whatever a scenario left them at.
  expect(s.foeSpawning).toBe(true);
  expect(s.wormEntry).toBe(true);
  expect(s.cursor.contact).toBe(true);
});

it("poses an empty, quiet board with startPlaying", async () => {
  startPlaying(h);

  const posed = h.snapshot();
  expect(posed.screen).toBe("playing");
  expect(posed.phase).toBe("active");
  expect(posed.level).toBe(1);
  expect(posed.nodes).toHaveLength(0);
  expect(posed.worms).toHaveLength(0);
  expect(posed.foes).toHaveLength(0);
  expect(posed.bolts).toHaveLength(0);
  expect(posed.foeSpawning).toBe(false);
  expect(posed.wormEntry).toBe(false);
  expect(posed.cursor.contact).toBe(false);
  expect(posed.cursor.x).toBeCloseTo(BAND_CX, 6);
  expect(posed.cursor.y).toBeCloseTo(BAND_CY, 6);

  // Quiet holds while the game runs. At level 3 an empty board is maximally
  // sparse, so the dropper's own check would draw one in on its first interval
  // and a banner would bring a worm in; with the gates off, neither happens and
  // the level does not clear underneath the scenario either.
  h.debug.setLevel(3);
  await h.advance(ticksFor(DROPPER_CHECK_INTERVAL * 1.5));
  const after = h.snapshot();
  expect(after.foes).toHaveLength(0);
  expect(after.worms).toHaveLength(0);
  expect(after.level).toBe(3);
  expect(after.screen).toBe("playing");
});

it("lays a worm the rules then drive, and hands back its id", async () => {
  startPlaying(h);
  const id = poseWorm(h, 10, 5, 4);

  const posed = wormById(h.snapshot(), id);
  expect(posed).toBeDefined();
  expect(posed?.segments).toEqual([
    { c: 10, r: 5 },
    { c: 9, r: 5 },
    { c: 8, r: 5 },
    { c: 7, r: 5 },
  ]);
  expect(posed?.dh).toBe(1);
  expect(posed?.dv).toBe(1);
  expect(posed?.stepping).toBe(true);
  expect(posed?.body).toBe(true);

  // The build's own step clock is what moves it: the harness only posed it.
  await h.advanceSeconds(h.snapshot().wormStepInterval * 1.5);
  expect(headOf(wormById(h.snapshot(), id)!)).toEqual({ c: 11, r: 5 });

  // A bent worm is posed tile by tile, head first.
  h.debug.clearWorms();
  const bent = poseWormPath(
    h,
    [
      { c: 20, r: 6 },
      { c: 20, r: 5 },
      { c: 19, r: 5 },
    ],
    -1,
    1,
  );
  expect(wormById(h.snapshot(), bent)?.segments).toHaveLength(3);
  expect(wormById(h.snapshot(), bent)?.dh).toBe(-1);
});

it("places foes, bolts and nodes where it was asked to", async () => {
  startPlaying(h);

  const glitch = poseFoe(h, "glitch", 12, 8);
  const foe = foeById(h.snapshot(), glitch);
  expect(foe?.kind).toBe("glitch");
  expect(foe?.x).toBeCloseTo(tileCX(12), 6);
  expect(foe?.y).toBeCloseTo(tileCY(8), 6);

  h.debug.setNode(6, 12, 2);
  expect(chargeAt(h.snapshot(), 6, 12)).toBe(2);
  expect(nodeAt(h.snapshot(), 6, 13)).toBeUndefined();
  // An empty tile and an inert node are different states of the field.
  h.debug.setNode(6, 13, 0);
  expect(chargeAt(h.snapshot(), 6, 13)).toBe(0);

  // The bolt is the build's from the moment it is placed: it climbs on its own.
  const bolt = poseBoltAtTile(h, 6, 17);
  const before = h.snapshot().bolts.find((entry) => entry.id === bolt);
  expect(before?.y).toBeCloseTo(tileCY(17), 6);
  await h.advance(4);
  const climbing = h.snapshot().bolts.find((entry) => entry.id === bolt);
  if (climbing !== undefined) expect(climbing.y).toBeLessThan(before!.y);
});

it("serves the seeded art to a headless host, mirroring included", async () => {
  startPlaying(h);
  // Heading left, so the art — which faces right — is drawn flipped.
  poseWorm(h, 15, 9, 1, -1, 1);
  h.debug.setWormStepping(h.snapshot().worms[0].id, false);

  h.calls.length = 0;
  await h.advance(1);

  expect(h.assetFailures).toEqual([]);
  const head = drawnImages(h).find(
    (image) =>
      Math.abs(image.x - tileCX(15)) < 1 && Math.abs(image.y - tileCY(9)) < 1,
  );
  expect(head, "a bitmap blitted on the head's tile centre").toBeDefined();
  expect(head?.mirrored).toBe(true);
  expect(head?.w).toBeCloseTo(32, 3);

  const match = await nearestSeededFrame(head!.source);
  expect(match.folder).toBe("worm");
  // Identity, within the one lossy step of reading a bitmap back off a canvas.
  expect(match.distance).toBeLessThan(1);
});

it("drives the real input path: menus, holds, and the cues they play", async () => {
  // The menu moves through the registered action, and says so.
  resetTo(h, 1);
  const played = watchCues(h);
  await tapAction(h, "down");
  expect(h.snapshot().menuIndex).toBe(1);
  expect(played.filter((cue) => cue.cue === CUES.menu).length).toBe(1);
  expect(played[0].frame).toBeGreaterThan(0);

  // A held key moves the cursor, at the build's own rate against our clock.
  startPlaying(h);
  h.debug.setCursor(BAND_CX, BAND_CY);
  const from = h.snapshot().cursor.x;
  await holdFor(h, "ArrowRight", ticksFor(0.25));
  const moved = h.snapshot().cursor.x;
  expect(moved).toBeGreaterThan(from);
  expect(moved).toBeLessThanOrEqual(CURSOR_X_MAX);
  // And the release lands: the next frames move it no further.
  await h.advance(10);
  expect(h.snapshot().cursor.x).toBeCloseTo(moved, 6);

  // Firing plays its cue, through the same action path.
  clearCues(h);
  h.debug.setFireCooldown(0);
  await holdFor(h, "Space", 2);
  expect(cuesNamed(h, CUES.fire).length).toBeGreaterThanOrEqual(1);
});

it("samples pixels and finds the text a frame drew", async () => {
  // Text: the title frame draws the case-fixed copy.
  resetTo(h, 1);
  h.calls.length = 0;
  await h.advance(1);
  expect(drewText(h.calls, TITLE_TEXT)).toBe(true);

  // Pixels: a posed node's tile and a bare tile both read as colours, and the
  // frame that drew the node changed the canvas.
  startPlaying(h);
  await h.advance(1);
  const before = canvasPixels(h);
  h.debug.setNode(20, 10, 3);
  await h.advance(1);
  expect(pixelsChanged(before, canvasPixels(h))).toBeGreaterThan(0);

  for (const sample of [sampleTile(h, 20, 10), sampleTile(h, 2, 3)]) {
    for (const channel of [sample.r, sample.g, sample.b]) {
      expect(Number.isFinite(channel)).toBe(true);
      expect(channel).toBeGreaterThanOrEqual(0);
      expect(channel).toBeLessThanOrEqual(255);
    }
  }

  // The cursor sits inside its band, which is where a band sample must look.
  expect(h.snapshot().cursor.y).toBeGreaterThanOrEqual(CURSOR_Y_MIN);
});

it("observes the diagnostics overlay through the recorded context", async () => {
  startPlaying(h);
  h.calls.length = 0;
  await h.advance(1);
  const bare = drawnText(h.calls);

  // Backquote toggles the engine-owned overlay; the sources the build
  // registered draw through the same recorded context, so new text runs appear.
  h.calls.length = 0;
  await toggleOverlay(h);
  const overlaid = drawnText(h.calls);
  expect(overlaid.length).toBeGreaterThan(bare.length);

  // And toggling again takes it back down.
  h.calls.length = 0;
  await toggleOverlay(h);
  expect(drawnText(h.calls).length).toBeLessThan(overlaid.length);
});

it("writes a still and a replay under the suite's own address", async () => {
  startPlaying(h);
  h.debug.setNode(18, 12, 3);
  await h.advance(1);
  captureStill(h, "posed");

  await captureReplay(h, "discharge", async () => {
    poseBoltAtTile(h, 18, 17);
    await h.advance(ticksFor(0.4));
  });

  expect(written()).toEqual(["discharge.json.gz", "posed.png"]);

  // The still is a PNG: the eight-byte signature opens the file.
  const png = readFileSync(join(mediaDir, SUITE_DIR, "posed.png"));
  expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);

  // The replay is really gzip-framed (RFC 1952), and the document inside holds
  // the frames the section drew.
  const bytes = readFileSync(join(mediaDir, SUITE_DIR, "discharge.json.gz"));
  expect([bytes[0], bytes[1]]).toEqual([0x1f, 0x8b]);
  const recording = JSON.parse(gunzipSync(bytes).toString("utf8")) as {
    format: number;
    frames: unknown[];
  };
  expect(recording.format).toBeGreaterThan(0);
  expect(recording.frames.length).toBeGreaterThan(0);
});

it("costs nothing and changes nothing when nobody is collecting media", async () => {
  delete process.env[MEDIA_DIR_ENV];
  startPlaying(h);

  const value = await captureReplay(h, "unused", async () => {
    await h.advance(2);
    return "the scenario's own value";
  });
  captureStill(h, "unused");

  expect(value).toBe("the scenario's own value");
  expect(written()).toEqual([]);
});

it("hands a scenario's failure on, and still writes what it recorded", async () => {
  startPlaying(h);
  poseWorm(h, 8, 8, 2);

  await expect(
    captureReplay(h, "failing", async () => {
      await h.advance(6);
      throw new Error("the check's own failure");
    }),
  ).rejects.toThrow("the check's own failure");

  expect(written()).toEqual(["failing.json.gz"]);
});
