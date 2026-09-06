// showcase-capture — record a REAL EXPEDITION of Deepcore for the case showcase.
//
// Not a validator: a temporary capture driver staged beside the harness to
// (re)record `showcase/base/`'s replay and its two stills from the reference
// implementation. It opens an expedition off the title menu, sinks a shaft from
// the camp, cuts out every vein it can see in the shaft walls on the way down,
// turns around when the bay is full or the gauge says the climb home is only
// just affordable, flies the loaded haul out, sells it at the Ore Market and
// puts the money straight back into fuel.
//
// EVERY OUTCOME ON SCREEN IS THE GAME'S. What this driver touches on the debug
// surface is INPUT and READINGS, and nothing else:
//
//   - `reset()` leaves the game on its title screen exactly as a launched build
//     opens, with the mine the expedition then generates its own.
//   - `snapshot()`, `tileAt()` and `buildings()` are readings and change nothing.
//   - `sell()` and `fillFuel()` are the named counterparts of the two panel
//     controls a player clicks, and `specs/instrumentation.md` fixes them as
//     running the game's own rule for that control on the game as it stands.
//     Neither poses an outcome: a sale the market refuses changes nothing.
//   - Everything else is keys, held and released through the engine's own input.
//
// No cell is posed, no ore is placed, no fuel or hull or Credit is set. The mine
// is the one the game generated, every unit in the bay was drilled out of a wall,
// and the fuel left at the surface is what the descent and the climb actually
// cost. Arranging the input is authoring; posing the outcome would be
// fabrication.
//
// AUDITIONING. Every expedition opens on a mine the game generates afresh, so
// no take can be played twice. Each take is therefore played under the recorder,
// judged as it stands, and the files of every take are kept; the driver names the
// winner, and the winner's files are the ones committed. The take that was
// judged is the take that was recorded.
//
// Run from a PRIVATE COPY of the reference workspace, never from the reference
// itself — `showcase/capture/README.md` has the staging steps and the knobs:
//   TCAB_VALIDATION_MEDIA_DIR=<out> TCAB_SHOWCASE_MAX_REPLAY_FRAMES=1200 \
//     npx vitest run --config validation/vitest.config.ts \
//     validation/showcase-capture.test.ts

import { ConstantClock } from "@clockwyrks/structured-2d";
import { it } from "vitest";

import { MINER_W, SPAWN_COL } from "../src/constants";
import {
  ACTION_KEY,
  captureReplay,
  captureStill,
  createHarness,
  type BuildingBox,
  type DeepcoreSnapshot,
  type Harness,
} from "./harness";

/* -------------------------------------------------------------------------- */
/* The clip's shape                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The frame the take is played and recorded at.
 *
 * Sixty is the rate a browser draws this game at, and the rate the clip plays
 * back at: a replay carries each kept frame's own delta. It is not merely a
 * cosmetic choice here. Deepcore integrates every rate against the frame's delta
 * and so reaches the same place however the time was divided, but the drill lands
 * a hit every 0.125 s and a coarser division rounds those hits differently: the
 * same expedition played at 30 Hz spends enough extra fuel on the way down to
 * strand the miner on the way up. Sixty divides the drill's interval exactly.
 */
const SHOW_HZ = 60;
const SHOW_MS = 1000 / SHOW_HZ;
const seconds = (s: number): number => Math.round(s * SHOW_HZ);

/** The column the shaft is sunk in: the one the miner spawns standing on. */
const SHAFT = SPAWN_COL;

/** How far down the plan looks. The turnaround is decided by the bay and the gauge. */
const DEPTH = Number(process.env.TCAB_SHOWCASE_DEPTH ?? "44");

/**
 * The height the climb's thrust is cut at, in world units, above the camp ground
 * line at `SURFACE_Y`.
 *
 * Two traps sit here. A miner that lets go of thrust over the mouth of its own
 * shaft drops straight back down it, so the burn has to carry the box clear of
 * the ground line before the drift starts. And a miner that thrusts to the top of
 * its arc falls far enough to land above `IMPACT_SAFE_SPEED` and pay hull for it.
 * Cutting the burn just past the line and letting the coast do the rest clears the
 * shaft and lands under the impact speed.
 */
const EXIT_Y = Number(process.env.TCAB_SHOWCASE_EXIT_Y ?? "-20");

/**
 * The fuel a miner standing at `row` keeps back for the climb home.
 *
 * A loaded climb out of the topsoil costs a little over a unit of fuel per row at
 * tier-1 gear on a `quick` world, where the thrust burn is doubled, so the
 * turnaround is that plus a margin for the drift off the shaft. This is the
 * prospector watching the gauge: the dig ends when the bay is full or when what
 * is left is only just enough to get home on.
 */
const RESERVE_PER_ROW = Number(
  process.env.TCAB_SHOWCASE_RESERVE_PER_ROW ?? "1.25",
);
const RESERVE_FLOOR = Number(process.env.TCAB_SHOWCASE_RESERVE_FLOOR ?? "6");
const reserve = (row: number): number => row * RESERVE_PER_ROW + RESERVE_FLOOR;

/** How many takes are auditioned. Each is one generated mine, and one expedition. */
const TAKES = Number(process.env.TCAB_SHOWCASE_TAKES ?? "24");

/** The clip is judged unwatchable outside this span, in seconds. */
const MIN_SECONDS = Number(process.env.TCAB_SHOWCASE_MIN_SECONDS ?? "24");
const MAX_SECONDS = Number(process.env.TCAB_SHOWCASE_MAX_SECONDS ?? "40");

/* -------------------------------------------------------------------------- */
/* What a take left behind                                                    */
/* -------------------------------------------------------------------------- */

interface Take {
  take: number;
  frames: number;
  /** The row the turnaround was made at, and its depth in meters. */
  rows: number;
  meters: number;
  slots: number;
  slotCap: number;
  loadFraction: number;
  /** Credits banked by the sale. */
  credits: number;
  /** Fuel held the moment the miner set down on the camp ground. */
  fuelAtSurface: number;
  maxFuel: number;
  hull: number;
  maxHull: number;
  /** The climb failed and the miner never reached the camp. */
  stranded: boolean;
  /** The loop closed: sold, and the tank filled again. */
  closed: boolean;
}

/** A take is judged on what makes Deepcore read in one clip. */
function judge(take: Take): number {
  if (take.stranded) return -1000;
  const length = take.frames / SHOW_HZ;
  const spare = take.fuelAtSurface / take.maxFuel;
  // The hook is a loaded climb that only just makes it, so a thin margin scores
  // and a comfortable one does not. An empty tank at the surface is a stranding
  // by another name and is punished as one.
  const margin =
    spare <= 0
      ? -100
      : spare < 0.2
        ? 40 - spare * 100
        : Math.max(0, 30 - spare * 100);
  return (
    (take.slots / take.slotCap) * 40 +
    take.credits / 25 +
    take.loadFraction * 30 +
    (take.hull / take.maxHull) * 25 +
    margin +
    (length >= MIN_SECONDS && length <= MAX_SECONDS ? 20 : -40) +
    (take.closed ? 20 : -20)
  );
}

function describe(label: string, take: Take, score: number): string {
  return (
    `${label}: row ${take.rows} (${take.meters} m), ` +
    `${take.slots}/${take.slotCap} slots, load ${take.loadFraction.toFixed(2)}, ` +
    `${take.credits} Cr, ${take.fuelAtSurface.toFixed(1)}/${take.maxFuel} fuel at the surface, ` +
    `${take.hull.toFixed(0)}/${take.maxHull} hull, ${(take.frames / SHOW_HZ).toFixed(1)}s` +
    `${take.stranded ? ", STRANDED" : ""}${take.closed ? ", loop closed" : ""}` +
    ` -> ${score.toFixed(0)}`
  );
}

/* -------------------------------------------------------------------------- */
/* The player                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * One expedition, driven with held keys and counted in frames.
 *
 * Every method here is input: a key down, a key up, and the frames between them.
 * Nothing on this class touches the world.
 */
class Session {
  spent = 0;
  constructor(readonly h: Harness) {}

  snapshot(): DeepcoreSnapshot {
    return this.h.snapshot();
  }

  async run(frames: number): Promise<void> {
    await this.h.advance(frames);
    this.spent += frames;
  }

  /** A menu press: down, the frame that delivers it, up, and the frame that acts. */
  async tap(code: string): Promise<void> {
    this.h.hold(code);
    await this.run(1);
    this.h.release(code);
    await this.run(1);
  }

  /** Hold `code` until `done` reads true, sampling every frame. */
  async holdUntil(
    code: string,
    done: (snapshot: DeepcoreSnapshot) => boolean,
    maxFrames: number,
  ): Promise<boolean> {
    this.h.hold(code);
    try {
      for (let frame = 0; frame < maxFrames; frame += 1) {
        await this.run(1);
        if (done(this.snapshot())) return true;
      }
      return false;
    } finally {
      this.h.release(code);
    }
  }

  /**
   * Hold a direction until the cell it cuts is gone.
   *
   * The key is held across every row of a run rather than released between them:
   * `miner.row` flips PART-WAY through a down cut, so a driver that lets go there
   * lets collision push the miner back onto the cell it was cutting and pays for
   * the row twice. Watching the target cell instead ends the hold on the frame the
   * cell actually broke.
   */
  async cut(
    code: string,
    col: number,
    row: number,
    maxFrames: number,
    abort: (snapshot: DeepcoreSnapshot) => boolean = () => false,
  ): Promise<boolean> {
    this.h.hold(code);
    try {
      for (let frame = 0; frame < maxFrames; frame += 1) {
        if (this.h.tileAt(col, row).kind === "tunnel") return true;
        await this.run(1);
        if (abort(this.snapshot())) return false;
      }
      return this.h.tileAt(col, row).kind === "tunnel";
    } finally {
      this.h.release(code);
    }
  }

  bayFull(): boolean {
    const snapshot = this.snapshot();
    return snapshot.cargo.slotsUsed >= snapshot.cargo.slotCap;
  }

  /** Walk along the camp until the miner stands in the middle of `box`. */
  async walkTo(box: BuildingBox): Promise<void> {
    const target = box.x + box.w / 2 - MINER_W / 2;
    const code =
      target > this.snapshot().miner.x ? ACTION_KEY.right : ACTION_KEY.left;
    await this.holdUntil(
      code,
      (v) => Math.abs(v.miner.x - target) < 10,
      seconds(10),
    );
  }
}

/** Play one expedition end to end and report what it produced. */
async function play(h: Harness, take: number, label: string): Promise<Take> {
  const g = new Session(h);

  // The title, then NEW EXPEDITION, then STANDARD, then QUICK — the first entry
  // of each menu, chosen with the confirm key, exactly as a player opens a game.
  h.debug.reset();
  await g.run(seconds(0.6));
  await g.tap(ACTION_KEY.activate);
  await g.run(seconds(0.45));
  await g.tap(ACTION_KEY.activate);
  await g.run(seconds(0.45));
  await g.tap(ACTION_KEY.activate);
  await g.run(seconds(0.5));

  // The rows worth stopping at on the way down: the ones whose shaft wall shows a
  // vein. An ore cell reads as flecks in the rock a player can see from inside the
  // shaft, so cutting sideways at exactly those rows is the dig a player does.
  // Ore that lies in the shaft column itself needs no stop: the bore takes it.
  const stops: number[] = [];
  for (let row = 1; row <= DEPTH; row += 1) {
    if (
      h.tileAt(SHAFT - 1, row).kind === "ore" ||
      h.tileAt(SHAFT + 1, row).kind === "ore"
    ) {
      stops.push(row);
    }
  }
  stops.push(DEPTH);

  for (const row of stops) {
    if (g.snapshot().miner.row >= row) continue;
    if (g.snapshot().miner.fuel <= reserve(g.snapshot().miner.row)) break;
    // The gauge is watched THROUGHOUT the bore, not only where the plan stops. A
    // long run of rows whose walls show nothing would otherwise spend the whole
    // reserve before the next chance to turn around.
    const sank = await g.cut(
      ACTION_KEY.down,
      SHAFT,
      row,
      seconds(8),
      (v) => v.miner.fuel <= reserve(v.miner.row),
    );
    if (!sank) break;
    if (g.bayFull()) break;
    for (const side of [-1, 1] as const) {
      if (h.tileAt(SHAFT + side, row).kind !== "ore") continue;
      await g.cut(
        side < 0 ? ACTION_KEY.left : ACTION_KEY.right,
        SHAFT + side,
        row,
        seconds(4),
      );
      if (g.bayFull()) break;
    }
    if (g.bayFull()) break;
  }

  const deep = g.snapshot();
  captureStill(h, `${label}-shaft`);

  // The climb: thrust up the shaft and just past the camp ground line, then let
  // go and drift clear of the hole while the coast carries it the rest of the way.
  await g.holdUntil(
    ACTION_KEY.up,
    (v) => v.miner.y <= EXIT_Y || v.miner.fuel <= 0,
    seconds(16),
  );
  await g.holdUntil(
    ACTION_KEY.right,
    (v) => v.miner.grounded && v.miner.y > 0,
    seconds(5),
  );
  const surfaced = g.snapshot();
  // A miner that never made it home, and one that died on the way, are the same
  // failed take: an expedition that ended leaves `in-mine` for its Game Over.
  const stranded =
    surfaced.screen !== "in-mine" ||
    surfaced.depthMeters > 0 ||
    !surfaced.miner.grounded;

  let closed = false;
  const market = h.debug.buildings().find((box) => box.id === "ore-market");
  const depot = h.debug.buildings().find((box) => box.id === "fuel-depot");
  if (!stranded && market !== undefined && depot !== undefined) {
    await g.walkTo(market);
    await g.tap(ACTION_KEY.activate);
    await g.run(seconds(0.55));
    // The haul on the counter, priced, before any of it is sold.
    captureStill(h, `${label}-market`);
    h.debug.sell();
    await g.run(seconds(1.0));
    await g.tap(ACTION_KEY.pause);
    await g.run(seconds(0.2));
    await g.walkTo(depot);
    await g.tap(ACTION_KEY.activate);
    await g.run(seconds(0.5));
    h.debug.fillFuel();
    await g.run(seconds(1.1));
    await g.tap(ACTION_KEY.pause);
    // The settled beat the clip ends on: back at the depot with a full tank and
    // the money that filled it cut out of the ground a minute ago.
    await g.run(seconds(0.9));
    const end = g.snapshot();
    closed = end.miner.fuel >= end.miner.maxFuel - 1;
  }

  const end = g.snapshot();
  return {
    take,
    frames: g.spent,
    rows: deep.miner.row,
    meters: Math.round(deep.deepestDepthMeters),
    slots: deep.cargo.slotsUsed,
    slotCap: deep.cargo.slotCap,
    loadFraction: deep.cargo.loadKg / deep.cargo.liftLimitKg,
    credits: end.credits,
    fuelAtSurface: surfaced.miner.fuel,
    maxFuel: surfaced.miner.maxFuel,
    hull: surfaced.miner.hull,
    maxHull: surfaced.miner.maxHull,
    stranded,
    closed,
  };
}

/**
 * One expedition on its own engine.
 *
 * A session replayed over a world that has already run inherits its frame
 * counter, its camera, the cues still playing and whatever key edges the last
 * take left armed, so each take is played on an engine of its own.
 */
async function runTake(take: number, label: string): Promise<Take> {
  const h = await createHarness({
    clock: new ConstantClock(SHOW_MS),
    // The produced sprites, animations and tiles, off disk, so the clip is the
    // game as it is played rather than the fallback shapes.
    assets: true,
  });
  try {
    await h.advance(1);
    return await captureReplay(h, label, () => play(h, take, label));
  } finally {
    h.dispose();
  }
}

it("records an expedition clip", async () => {
  // Every take is played under the recorder and judged as it stands; the winner
  // is the one whose files are committed.
  let best: { label: string; take: Take; score: number } | null = null;
  for (let n = 1; n <= TAKES; n += 1) {
    const label = `take-${String(n).padStart(2, "0")}`;
    const take = await runTake(n, label);
    const score = judge(take);
    console.log(describe(label, take, score));
    if (best === null || score > best.score) best = { label, take, score };
  }
  if (best === null) throw new Error("no take was auditioned");

  const { label, score } = best;
  console.log(
    `best take: ${label} (${score.toFixed(0)}) — commit ` +
      `${label}.json.gz as expedition.json.gz, ` +
      `${label}-shaft.png as loaded-at-depth.png, and ` +
      `${label}-market.png as the-haul-priced.png`,
  );
}, 3_600_000);
