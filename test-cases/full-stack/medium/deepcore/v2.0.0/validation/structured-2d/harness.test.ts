// harness — the shared machinery every validator in this project stands on.
//
// The suites next door are validators: each decides one review point against the
// build. This file decides nothing about the build. It checks the HARNESS, whose
// faults are invisible from inside a suite and wrong in ways nothing else
// catches:
//
//  - a surface never read off the engine reports a build that returned one
//    perfectly well as one that returned none;
//  - a clock that ran a different number of frames than a check asked for makes
//    every rate this specification states unreadable;
//  - a key dispatched at the wrong target never reaches the game, which turns
//    every movement, drill and menu check into a check of nothing;
//  - a check that reads the BUILD's own controller consumes the press the build
//    was going to read, so the build behaves as though the key was never struck
//    and the check grades a game nobody played;
//  - a scene helper that leaves the previous check's terrain, cargo or faculty in
//    place makes a hundred isolated validators into a hundred that are not;
//  - a replay written in the wrong framing reaches the console as something it
//    cannot read, and one written for a section that drew nothing is reported to
//    the reviewer as evidence that exists.
//
// So each of those is exercised here, against the reference implementation the
// project is developed on. That does mean a few assertions below read the build:
// a held key has to move SOMETHING for the input path to be shown working. Those
// are deliberately the weakest readings that still prove the machinery — the
// miner moved east rather than by how much — because the figure is the business
// of the validator that owns it, and stating it twice would fail one build twice
// for one fault.
//
// No review item names this file, so a run never loads it. It runs with the whole
// project, which is how a case author runs these suites while writing them:
//
//   npx vitest run --config validation/vitest.config.ts validation/harness.test.ts

import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { Recording } from "@clockwyrks/structured-2d";
import {
  BAND_HEALTH,
  CAVE_MOUTH_COL,
  DEEPCORE_DEBUG_VERSION,
  MINER_H,
  SPAWN_COL,
  STAGE_H,
  STAGE_W,
  TILE,
} from "./constants";
import { REQUIRED_OPS } from "./surface";
import {
  ACTION_KEY,
  DISTINCT_MIN,
  UNBOUND_KEY,
  callsTo,
  captureReplay,
  captureStill,
  cellCenter,
  colorDistance,
  coreRowFor,
  createHarness,
  digShaft,
  driveCut,
  driveFall,
  drewText,
  imageDraws,
  layCamp,
  layFloor,
  layOre,
  loadToFraction,
  minerYOn,
  openExpedition,
  openScene,
  pinDrill,
  pinMiner,
  retable,
  sampleCell,
  seconds,
  sounded,
  stageCargo,
  standAtBuilding,
  standAtCamp,
  standOn,
  startWithKeys,
  textSpans,
  ticks,
  watchCues,
  worldToStage,
  type Harness,
} from "./harness";

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
  mediaDir = mkdtempSync(join(tmpdir(), "deepcore-replay-"));
  process.env[MEDIA_DIR_ENV] = mediaDir;
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
  if (collecting === undefined) delete process.env[MEDIA_DIR_ENV];
  else process.env[MEDIA_DIR_ENV] = collecting;
  rmSync(mediaDir, { recursive: true, force: true });
});

/* -------------------------------------------------------------------------- */
/* The surface                                                                */
/* -------------------------------------------------------------------------- */

it("reaches the surface the build's instance returned", () => {
  const probed = h.probe(REQUIRED_OPS);

  expect(probed.version).toBe(DEEPCORE_DEBUG_VERSION);
  const missing = REQUIRED_OPS.filter((op) => probed.ops[op] !== "function");
  expect(missing).toEqual([]);
});

it("poses the live world and reads it back at the call", () => {
  openScene(h);
  h.debug.setCredits(1234);

  // The pose acted on the world the engine has open, and the reading was built
  // off that same world — so neither needed a frame between them.
  expect(h.snapshot().credits).toBe(1234);
});

it("hands back the engine's own world, state and instance", async () => {
  openScene(h);
  await h.advance(4);

  // Live reads rather than captures: what a check holds is the world the frame
  // it just ran left behind.
  expect(h.world).toBe(h.engine.world);
  expect(h.state).toBe(h.engine.world.state);
  expect(h.instance).toBe(h.engine.instance);
  expect(h.world.level).toBe("mine");
});

it("opens at the title screen, on an empty mine", () => {
  const snapshot = h.snapshot();

  expect(snapshot.screen).toBe("title");
  expect(snapshot.simTime).toBe(0);
  expect(h.frame()).toBe(0);
});

/* -------------------------------------------------------------------------- */
/* The clock                                                                  */
/* -------------------------------------------------------------------------- */

it("runs exactly the frames a check asks for, and no others", async () => {
  openScene(h);
  await h.advance(60);

  expect(h.frame()).toBe(60);
  expect(h.snapshot().simTime).toBeCloseTo(seconds(60), 6);
});

it("covers a named span of game time in however many frames it is given", async () => {
  openScene(h);
  pinMiner(h);
  pinDrill(h);
  await h.advanceSeconds(90, 90);

  expect(h.frame()).toBe(90);
  expect(h.snapshot().simTime).toBeCloseTo(90, 6);
});

it("puts the harness clock back after a span driven at another step", async () => {
  openScene(h);
  await h.advanceSeconds(4, 4);
  const after = h.snapshot().simTime;
  await h.advance(120);

  // The 120 frames that followed were the harness's own 120 Hz second, not the
  // one-second steps the span was driven at.
  expect(h.snapshot().simTime - after).toBeCloseTo(1, 6);
});

it("refuses a span it cannot divide into whole frames", async () => {
  openScene(h);

  await expect(h.advanceSeconds(1, 0)).rejects.toThrow(RangeError);
  await expect(h.advanceSeconds(1, 2.5)).rejects.toThrow(RangeError);
});

it("sweeps until a predicate holds and reports where it stopped", async () => {
  openScene(h);
  pinDrill(h);
  layFloor(h, 20);
  standOn(h, 10, 20);

  const found = await h.until((s) => s.miner.grounded, { maxFrames: 60 });
  expect(found.hit).toBe(true);
  expect(found.frames).toBeLessThan(60);

  const never = await h.until(() => false, { maxFrames: 10 });
  expect(never.hit).toBe(false);
  expect(never.frames).toBe(10);
});

it("hands the game back to its own loop, and takes it back", async () => {
  openScene(h);
  const before = h.frame();
  await h.runFor(80);
  const during = h.frame();
  expect(during).toBeGreaterThan(before);

  // Halted: nothing runs once `runFor` has returned.
  await new Promise((resolve) => setTimeout(resolve, 40));
  expect(h.frame()).toBe(during);
});

/* -------------------------------------------------------------------------- */
/* Input                                                                      */
/* -------------------------------------------------------------------------- */

it("drives the miner with a key held through the engine", async () => {
  openScene(h);
  pinDrill(h);
  layFloor(h, 20);
  standOn(h, 10, 20);
  const start = h.snapshot().miner.x;

  h.hold(ACTION_KEY.right);
  await h.advance(30);
  h.release(ACTION_KEY.right);

  // The figure is the walk validator's; what this proves is that the key
  // reached the game at all.
  expect(h.snapshot().miner.x).toBeGreaterThan(start);
});

it("lets every held key up when the drive is over", async () => {
  openScene(h);
  pinDrill(h);
  layFloor(h, 20);
  standOn(h, 10, 20);

  h.hold(ACTION_KEY.right);
  await h.advance(10);
  h.releaseAll();
  await h.advance(30);
  const settled = h.snapshot().miner.x;
  await h.advance(30);

  expect(h.snapshot().miner.x).toBeCloseTo(settled, 6);
});

it("delivers a tap as a press the game sees, and ignores an unbound key", async () => {
  openScene(h, { screen: "title" });
  const before = h.snapshot().menuIndex;

  await h.tap(UNBOUND_KEY);
  expect(h.snapshot().menuIndex).toBe(before);

  await h.tap(ACTION_KEY.down);
  expect(h.snapshot().menuIndex).not.toBe(before);
});

it("delivers a click at a logical stage point", async () => {
  openScene(h);
  layCamp(h);
  standAtBuilding(h, "ore-market");
  await h.advance(2);
  h.debug.setPanel("ore-market");
  await h.advance(1);

  // A click somewhere the panel is not closes nothing by itself; what this
  // proves is that a pointer event reaches the game's own pointer at all, which
  // the panel checks then read for their own controls.
  await h.click(STAGE_W / 2, STAGE_H / 2);
  expect(h.snapshot().panel).not.toBeUndefined();
});

it("reads a press through a controller of its own, not the build's", async () => {
  openScene(h);
  pinDrill(h);
  layFloor(h, 20);
  standOn(h, 10, 20);
  await h.advance(2);
  const observer = h.addObserver();
  const start = h.snapshot().miner.x;

  h.hold(ACTION_KEY.right);
  await h.advance(30);

  // An armed edge is `pressed` once PER PLAYER CONTROLLER, so the observer's
  // copy is its own: reading it here took nothing away from the build's, and the
  // miner moved on the same frames the observer saw the action held.
  expect(observer.input.value("right")).toBe(1);
  expect(h.snapshot().miner.x).toBeGreaterThan(start);
  h.release(ACTION_KEY.right);
});

it("adds an observer that possesses nothing and drives nothing", async () => {
  openScene(h);
  pinDrill(h);
  layFloor(h, 20);
  standOn(h, 10, 20);
  await h.advance(2);

  const before = h.world.actors().length;
  const observer = h.addObserver("watcher");
  await h.advance(4);

  // A seat at the input and nothing else: no pawn spawned, and the build's own
  // player is still the one the game is played through.
  expect(observer.pawn).toBeNull();
  expect(h.world.actors().length).toBe(before);
  expect(h.world.players().length).toBe(2);
});

it("leaves the game running exactly as it does with no observer watching", async () => {
  // `addPlayer` builds the game mode's OWN player controller class when its
  // options name none, and that class is where a build reads its input and runs
  // its screen machine — so an observer built that way would be a second seat
  // driving the game. This is the check that says the observer is inert: the
  // menu answers one press once, whether or not anything is watching, and the
  // observer's own copy of the edge is left unread so nothing but its presence
  // can account for a difference.
  openScene(h, { screen: "title" });
  await h.tap(ACTION_KEY.down);
  const alone = h.snapshot().menuIndex;

  openScene(h, { screen: "title" });
  h.addObserver();
  await h.tap(ACTION_KEY.down);

  expect(alone).toBe(1);
  expect(h.snapshot().menuIndex).toBe(alone);
});

/* -------------------------------------------------------------------------- */
/* Isolation                                                                  */
/* -------------------------------------------------------------------------- */

it("opens a scene that carries nothing the check before it left behind", async () => {
  openScene(h);
  stageCargo(h, { ferron: 5 });
  h.debug.setCredits(900);
  h.debug.setTier("drill", 3);
  h.debug.setTile(6, 40, "lava");
  await h.advance(4);

  openScene(h);
  const snapshot = h.snapshot();
  expect(snapshot.credits).toBe(0);
  expect(snapshot.cargo.slotsUsed).toBe(0);
  expect(snapshot.tiers.drill).toBe(1);
  expect(snapshot.screen).toBe("in-mine");
  expect(h.tileAt(6, 40).kind).toBe("tunnel");
});

it("opens a scene at a named size with a grid that agrees with it", () => {
  openScene(h, { size: "quick" });

  const snapshot = h.snapshot();
  expect(snapshot.worldSize).toBe("quick");
  expect(snapshot.coreRow).toBe(coreRowFor("quick"));
  // The grid was cleared with the size, so the deepest playable row is open.
  expect(h.tileAt(10, snapshot.coreRow - 1).kind).toBe("tunnel");
});

it("holds the miner's body still and leaves everything else running", async () => {
  openScene(h);
  pinMiner(h);
  layFloor(h, 20);
  standOn(h, 10, 20);
  const before = h.snapshot();

  h.hold(ACTION_KEY.right);
  await h.advance(60);
  h.release(ACTION_KEY.right);
  const after = h.snapshot();

  expect(after.miner.x).toBeCloseTo(before.miner.x, 6);
  expect(after.miner.y).toBeCloseTo(before.miner.y, 6);
  // Everything else carries on: life support still burns.
  expect(after.miner.fuel).toBeLessThan(before.miner.fuel);
});

it("holds the miner's drill and leaves everything else running", async () => {
  openScene(h);
  pinDrill(h);
  layFloor(h, 20);
  standOn(h, 10, 20);
  const health = h.tileAt(10, 20).health;

  h.hold(ACTION_KEY.down);
  await h.advance(120);
  h.release(ACTION_KEY.down);

  expect(h.tileAt(10, 20).health).toBe(health);
  expect(h.snapshot().miner.grounded).toBe(true);
});

/* -------------------------------------------------------------------------- */
/* The terrain a check lays                                                   */
/* -------------------------------------------------------------------------- */

it("stands the miner on the cell a held down cut bites into", async () => {
  openScene(h);
  layFloor(h, 20);
  standOn(h, 10, 20);
  await h.advance(2);

  const miner = h.snapshot().miner;
  expect(miner.grounded).toBe(true);
  // Within a hundredth of a unit: a build is free to rest the box a hair above
  // the cell it stands on, and where the contact is resolved to is its own.
  expect(miner.y).toBeCloseTo(minerYOn(20), 1);

  h.hold(ACTION_KEY.down);
  await h.advance(30);
  h.release(ACTION_KEY.down);
  const drilling = h.snapshot().miner.drilling;
  expect(drilling?.row).toBe(20);
});

it("lays a camp the miner stands on, with the cave mouth still open", async () => {
  openScene(h);
  layCamp(h);
  standAtCamp(h);
  await h.advance(10);

  expect(h.tileAt(SPAWN_COL, 1).kind).toBe("rock");
  expect(h.tileAt(CAVE_MOUTH_COL, 1).kind).toBe("tunnel");
  expect(h.snapshot().miner.grounded).toBe(true);
});

it("digs a shaft with walls that hold a drifting miner inside it", async () => {
  openScene(h);
  pinDrill(h);
  digShaft(h, 12, 10, 20);

  expect(h.tileAt(12, 15).kind).toBe("tunnel");
  expect(h.tileAt(11, 15).kind).toBe("rock");
  expect(h.tileAt(13, 15).kind).toBe("rock");
  expect(h.tileAt(12, 21).kind).toBe("rock");

  standOn(h, 12, 21);
  h.hold(ACTION_KEY.right);
  await h.advance(60);
  h.release(ACTION_KEY.right);
  expect(h.snapshot().miner.col).toBe(12);
});

it("lays an ore vein a cut banks a unit of", async () => {
  openScene(h);
  layFloor(h, 20);
  layOre(h, 10, 20, "ferron");
  standOn(h, 10, 20);
  expect(h.tileAt(10, 20).ore).toBe("ferron");

  const cut = await driveCut(h, "down", { col: 10, row: 20 });
  expect(cut.broke).toBe(true);
  expect(h.snapshot().cargo.ore.ferron).toBe(1);
});

it("loads the bay to a named load fraction, off the tier's own lift limit", () => {
  openScene(h);
  const loaded = loadToFraction(h, 0.5);

  expect(loaded.count).toBeGreaterThan(0);
  expect(loaded.fraction).toBeGreaterThanOrEqual(0.5);
  expect(h.snapshot().miner.overloaded).toBe(false);
});

/* -------------------------------------------------------------------------- */
/* Compound sequences                                                         */
/* -------------------------------------------------------------------------- */

it("opens an expedition through the surface, on a generated mine", async () => {
  openExpedition(h, { seed: 7 });
  await h.advance(4);

  const snapshot = h.snapshot();
  expect(snapshot.screen).toBe("in-mine");
  expect(snapshot.miner.grounded).toBe(true);
  // A generated mine is not an empty one.
  expect(h.tileAt(10, 40).kind).not.toBe("tunnel");
});

it("starts an expedition from the title with menu keys alone", async () => {
  await startWithKeys(h, { mode: "hardcore", size: "quick" });

  const snapshot = h.snapshot();
  expect(snapshot.screen).toBe("in-mine");
  expect(snapshot.mode).toBe("hardcore");
  expect(snapshot.worldSize).toBe("quick");
});

it("stands the miner at a building the activate control opens", async () => {
  openScene(h);
  layCamp(h);
  const box = standAtBuilding(h, "fuel-depot");
  await h.advance(2);
  await h.tap(ACTION_KEY.activate);

  expect(box.w).toBeGreaterThan(0);
  expect(h.snapshot().panel).toBe("fuel-depot");
});

it("names the building it could not find rather than throwing past the check", () => {
  openScene(h);

  expect(() => standAtBuilding(h, "no-such-building")).toThrow(/Expected:/);
});

it("runs a real cut to the frame the cell breaks on", async () => {
  openScene(h);
  layFloor(h, 20);
  standOn(h, 10, 20);
  const band = h.tileAt(10, 20).band;
  expect(band).not.toBeNull();
  expect(h.tileAt(10, 20).maxHealth).toBe(BAND_HEALTH[band!]);

  const cut = await driveCut(h, "down", { col: 10, row: 20 });
  expect(cut.broke).toBe(true);
  expect(cut.tile.kind).toBe("tunnel");
  expect(cut.frames).toBeGreaterThan(0);
});

it("drops the miner onto a floor and reports the landing", async () => {
  openScene(h);
  pinDrill(h);
  layFloor(h, 30);
  const fall = await driveFall(h, 10, 30, 12 * TILE);

  expect(fall.landed).toBe(true);
  expect(fall.impactSpeed).toBeGreaterThan(0);
  expect(fall.hullAfter).toBeLessThanOrEqual(fall.hullBefore);
});

/* -------------------------------------------------------------------------- */
/* Reading the render                                                         */
/* -------------------------------------------------------------------------- */

it("maps a world cell to where the build drew it", async () => {
  openScene(h);
  layFloor(h, 20);
  standOn(h, 10, 20);
  await h.advance(4);

  const snapshot = h.snapshot();
  const centre = cellCenter(10, 20);
  const at = worldToStage(snapshot, centre.x, centre.y);
  // The cell the miner stands on is drawn inside the mine viewport.
  expect(at.x).toBeGreaterThan(0);
  expect(at.x).toBeLessThan(STAGE_W);
  expect(at.y).toBeGreaterThan(0);
  expect(at.y).toBeLessThan(STAGE_H);
});

it("samples a posed cell, and tells two kinds apart", async () => {
  openScene(h);
  pinMiner(h);
  pinDrill(h);
  layFloor(h, 20);
  h.debug.setTile(8, 20, "rock");
  h.debug.setTile(12, 20, "lava");
  standOn(h, 10, 20);
  await h.advance(4);

  const snapshot = h.snapshot();
  const rock = sampleCell(h, snapshot, 8, 20);
  const lava = sampleCell(h, snapshot, 12, 20);
  expect(colorDistance(rock, lava)).toBeGreaterThan(DISTINCT_MIN);
});

it("reads the runs of text a frame drew, and where they landed", async () => {
  openScene(h, { screen: "title" });
  const calls = await h.frameCalls();

  expect(drewText(calls, "DEEPCORE")).toBe(true);
  const spans = textSpans(h, calls);
  const title = spans.find((span) =>
    span.text.toUpperCase().includes("DEEPCORE"),
  );
  expect(title).toBeDefined();
  expect(title!.left).toBeGreaterThanOrEqual(0);
  expect(title!.right).toBeLessThanOrEqual(STAGE_W);
});

it("attributes a cue to the frame of the drive that played it", async () => {
  openScene(h);
  layFloor(h, 20);
  layOre(h, 10, 20, "ferron");
  standOn(h, 10, 20);
  await h.advance(2);
  const played = watchCues(h);

  const at = h.frame();
  await driveCut(h, "down", { col: 10, row: 20 });

  // The engine announces a cue BY NAME, so what a check reads is which of the
  // thirteen the build asked for rather than that some sound happened.
  expect(sounded(played, "ore-pickup")).toBe(true);
  for (const cue of played) expect(cue.frame).toBeGreaterThanOrEqual(at);
});

/* -------------------------------------------------------------------------- */
/* The host the produced files and the save slot need                         */
/* -------------------------------------------------------------------------- */

it("leaves the produced sprites unloaded unless a check asks for them", async () => {
  openScene(h);
  await h.advance(2);

  // A Node process has no `fetch`, so the build's own loading path refuses every
  // sprite and draws its fallbacks — which is what a check about the simulation
  // wants, and it is what makes those checks cost nothing.
  expect(h.assetFailures.some((failure) => failure.path.endsWith(".png"))).toBe(
    true,
  );
});

it("stands the produced files up off disk when a check asks for them", async () => {
  const loaded = await createHarness({ assets: true });
  try {
    openScene(loaded);
    layCamp(loaded);
    standAtCamp(loaded);
    await loaded.advance(2);

    const refused = loaded.assetFailures.filter((failure) =>
      failure.path.endsWith(".png"),
    );
    expect(refused).toEqual([]);
    const calls = await loaded.frameCalls();
    expect(imageDraws(calls).length).toBeGreaterThan(0);
  } finally {
    loaded.dispose();
  }
});

it("gives the game a save slot when a check asks for one", async () => {
  const saved = await createHarness({ storage: true });
  try {
    openScene(saved);
    layCamp(saved);
    standAtCamp(saved);
    await saved.advance(2);
    expect(saved.snapshot().hasSave).toBe(false);

    saved.debug.save();
    expect(saved.snapshot().hasSave).toBe(true);
  } finally {
    saved.dispose();
  }
});

/* -------------------------------------------------------------------------- */
/* Evidence capture                                                           */
/* -------------------------------------------------------------------------- */

/** What this suite wrote into its own output directory, by file name. */
function written(): string[] {
  try {
    return readdirSync(join(mediaDir, SUITE_DIR)).sort();
  } catch {
    // The directory is made only when there is something to put in it.
    return [];
  }
}

/** One operation of a recording, as the console's player reads it. */
type RecordedOp =
  | { op: "call"; method: string; args: unknown[] }
  | { op: "set"; property: string; value: unknown };

/** One run of path operations, and the transform they were issued under. */
interface RecordedPathSegment {
  transform: number[] | null;
  ops: RecordedOp[];
}

/** A recording read back off disk, in the shape the assertions below read. */
interface WrittenRecording {
  format: number;
  images: unknown[];
  resources: {
    make: { method: string; args: unknown[] };
    then: RecordedOp[];
  }[];
  ops: RecordedOp[];
  states: {
    properties: Record<string, unknown>;
    clip: RecordedPathSegment[];
    path: RecordedPathSegment[];
  }[];
  frames: {
    count: number;
    timeMs: number;
    deltaMs: number;
    state: number;
    stack: number[];
    ops: number[];
  }[];
}

/** The recording written under `name`, read back off disk. */
function readBack(name: string): WrittenRecording {
  const bytes = readFileSync(join(mediaDir, SUITE_DIR, name));
  // The framing read off the bytes rather than off the name: a gzip member opens
  // `0x1f 0x8b` (RFC 1952), so this is the capture actually being compressed
  // rather than named as though it were.
  expect([bytes[0], bytes[1]]).toEqual([0x1f, 0x8b]);
  return JSON.parse(gunzipSync(bytes).toString("utf8")) as WrittenRecording;
}

/**
 * Every index in `recording` that addresses nothing, named.
 *
 * A recording is almost entirely indices — a frame names its state, the states
 * saved under it and each of its operations by index, and an operation names the
 * gradients and images it draws with the same way. Every one of them has to
 * address the table it belongs to, because a player that resolves an index past
 * the end of a table draws a frame the build never drew and says nothing about
 * it.
 */
function inRange(recording: WrittenRecording): string[] {
  const faults: string[] = [];
  const check = (label: string, index: number, table: unknown[]): void => {
    if (!Number.isInteger(index) || index < 0 || index >= table.length) {
      faults.push(`${label}: ${index} of ${table.length}`);
    }
  };
  const value = (label: string, entry: unknown): void => {
    if (Array.isArray(entry)) {
      for (const held of entry) value(label, held);
      return;
    }
    if (entry === null || typeof entry !== "object") return;
    const record = entry as Record<string, unknown>;
    if (typeof record.$img === "number") {
      check(`${label} $img`, record.$img, recording.images);
      return;
    }
    if (typeof record.$res === "number") {
      check(`${label} $res`, record.$res, recording.resources);
      return;
    }
    for (const held of Object.values(record)) value(label, held);
  };
  const operation = (label: string, op: RecordedOp): void => {
    if (op.op === "call") for (const arg of op.args) value(label, arg);
    else value(label, op.value);
  };

  for (const [at, op] of recording.ops.entries()) operation(`ops[${at}]`, op);
  for (const [at, state] of recording.states.entries()) {
    for (const held of Object.values(state.properties)) {
      value(`states[${at}]`, held);
    }
    for (const segment of state.clip) {
      for (const op of segment.ops) operation(`states[${at}].clip`, op);
    }
    for (const segment of state.path) {
      for (const op of segment.ops) operation(`states[${at}].path`, op);
    }
  }
  for (const [at, resource] of recording.resources.entries()) {
    for (const arg of resource.make.args) value(`resources[${at}]`, arg);
    for (const op of resource.then) operation(`resources[${at}]`, op);
  }
  for (const [at, frame] of recording.frames.entries()) {
    check(`frames[${at}].state`, frame.state, recording.states);
    for (const saved of frame.stack) {
      check(`frames[${at}].stack`, saved, recording.states);
    }
    for (const op of frame.ops) check(`frames[${at}].ops`, op, recording.ops);
  }
  return faults;
}

it("writes a captured section as gzip, under the replay extension", async () => {
  openScene(h);
  await captureReplay(h, "flight", () => h.advance(4));

  expect(written()).toEqual(["flight.json.gz"]);
  const recording = readBack("flight.json.gz");
  expect(recording.format).toBeGreaterThan(0);
  expect(recording.frames.length).toBe(4);
});

it("writes nothing at all for a section that drew no frames", async () => {
  // A scenario that runs no frame closes no frame, so there is no picture to
  // write. Leaving the file unwritten reports the output absent, which is the
  // truthful answer; a file holding an empty frame list would tell the reviewer
  // there is a replay to watch and then open a player on nothing.
  await captureReplay(h, "nothing", () => undefined);

  expect(written()).toEqual([]);
});

it("hands the scenario's own value back", async () => {
  openScene(h);
  const frames = await captureReplay(h, "value", async () => {
    await h.advance(2);
    return 2;
  });

  expect(frames).toBe(2);
  expect(written()).toEqual(["value.json.gz"]);
});

it("leaves the evidence of a section that failed", async () => {
  openScene(h);
  await expect(
    captureReplay(h, "failed", async () => {
      await h.advance(3);
      throw new Error("the scenario went wrong");
    }),
  ).rejects.toThrow("the scenario went wrong");

  // A failing check is the one whose replay a reviewer most wants.
  expect(written()).toEqual(["failed.json.gz"]);
  expect(readBack("failed.json.gz").frames.length).toBe(3);
});

it("keeps the whole of an over-long section, at a lower frame rate", async () => {
  // Far more frames than a written recording holds. What comes back covers the
  // whole section — the last frame driven is in it — rather than its opening.
  await captureReplay(h, "long", () => h.advance(1500));

  const recording = readBack("long.json.gz");
  expect(recording.frames.length).toBeGreaterThan(1);
  expect(recording.frames.length).toBeLessThanOrEqual(300);
  const counts = recording.frames.map((frame) => frame.count);
  expect([...counts].sort((a, b) => a - b)).toEqual(counts);
  // The deltas are restated against the frame kept before, so they still sum to
  // the section's elapsed time however many frames were dropped between them.
  const elapsed = recording.frames.reduce((sum, f) => sum + f.deltaMs, 0);
  expect(elapsed).toBeCloseTo((1500 * 1000) / 120, 3);
  // Dropping a frame drops the last reference to whatever only that frame drew
  // with, and the four tables in front of a recording are shared by every frame
  // in it. What is written names every entry of the tables it carries, so nothing
  // dropped is still being paid for.
  const named = new Set(recording.frames.flatMap((frame) => frame.ops));
  expect(named.size).toBe(recording.ops.length);
  const inherited = new Set(
    recording.frames.flatMap((frame) => [frame.state, ...frame.stack]),
  );
  expect(inherited.size).toBe(recording.states.length);
  // Minimal is only half of it. A table rebuilt against the wrong indices is the
  // same size as one rebuilt against the right ones, and it addresses entries
  // that are not there. Every index a frame carries has to address the table it
  // was interned into.
  expect(inRange(recording)).toEqual([]);
});

it("spends the budget on the section, never one frame past it", async () => {
  // The stride rounds up, which puts the sharp edge of the cap at a section whose
  // length is an exact multiple of it: the strided frames come to exactly the cap
  // and stop one stride short of the end. Both rules still hold there. Nothing
  // over the cap, because the cap is what makes `captureReplay` safe to wrap any
  // section in; and the section's last frame written, because it is the frame the
  // check's sweep stopped at.
  for (const length of [599, 600, 601]) {
    const at = `edge-${length}`;
    await captureReplay(h, at, () => h.advance(length));
    const frames = readBack(`${at}.json.gz`).frames;

    expect(frames.length, at).toBeLessThanOrEqual(300);
    // The first frame of a section is always kept — the stride opens on it — so
    // the span between the first count and the last is the whole section exactly
    // when the frame it ended on is the frame written last.
    expect(frames[frames.length - 1].count - frames[0].count, at).toBe(
      length - 1,
    );
    // Displacing a frame leaves the deltas summing to the elapsed time, the same
    // as dropping one does: the frame that replaces it is measured from where the
    // frame before it was kept.
    const elapsed = frames.reduce((sum, frame) => sum + frame.deltaMs, 0);
    expect(elapsed, at).toBeCloseTo((length * 1000) / 120, 3);
  }
});

it("keeps a still of the picture as it stands", async () => {
  openScene(h, { screen: "title" });
  await h.advance(1);
  captureStill(h, "title");

  expect(written()).toEqual(["title.png"]);
  const bytes = readFileSync(join(mediaDir, SUITE_DIR, "title.png"));
  // The PNG signature, so what was written is an image rather than a name.
  expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
});

it("writes nothing anywhere when nothing is collecting", async () => {
  delete process.env[MEDIA_DIR_ENV];
  openScene(h);
  const frames = await captureReplay(h, "unwatched", async () => {
    await h.advance(3);
    return 3;
  });
  captureStill(h, "unwatched");

  // The scenario still ran, and the suite behaves identically either way.
  expect(frames).toBe(3);
  expect(h.frame()).toBe(3);
  expect(written()).toEqual([]);
});

it("rewrites a field named __proto__ as a field", () => {
  // The tables a recording carries are rebuilt out of the frames that survived
  // decimation, and every value inside one is rewritten as it is reached. A field
  // named `__proto__` written with an assignment reaches the prototype setter
  // instead of becoming a field, so the rewrite silently drops it and replaces
  // the object's prototype with whatever it held.
  const held = JSON.parse('{"__proto__": {"tainted": true}}') as Record<
    string,
    never
  >;
  const recording: Recording = {
    format: 1,
    width: 8,
    height: 8,
    background: null,
    images: [],
    resources: [],
    ops: [{ op: "set", property: "fillStyle", value: held }],
    states: [
      { properties: held, transform: null, lineDash: null, clip: [], path: [] },
    ],
    frames: [
      {
        count: 1,
        timeMs: 8,
        deltaMs: 8,
        surface: { width: 8, height: 8 },
        state: 0,
        stack: [],
        ops: [0],
      },
    ],
  };

  const rewritten = retable(recording, recording.frames);
  const value = (rewritten.ops[0] as { value: object }).value;
  expect(Object.prototype.hasOwnProperty.call(value, "__proto__")).toBe(true);
  expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
  const properties = rewritten.states[0].properties;
  expect(Object.prototype.hasOwnProperty.call(properties, "__proto__")).toBe(
    true,
  );
  expect(Object.getPrototypeOf(properties)).toBe(Object.prototype);
});

it("counts a whole number of frames for a named duration", () => {
  // The unit every tolerance in this project is stated in: `ticks(s)` frames of
  // the default clock cover `s` seconds, and `seconds(n)` is the inverse.
  expect(ticks(0.125)).toBe(15);
  expect(ticks(0.4)).toBe(48);
  expect(ticks(1.5)).toBe(180);
  expect(seconds(120)).toBeCloseTo(1, 9);
  expect(MINER_H).toBeGreaterThan(0);
  expect(callsTo([], "arc")).toEqual([]);
});
