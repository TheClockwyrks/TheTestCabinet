// showcase-capture — record a REAL PLAY clip for the case showcase.
//
// Not a validator: a temporary capture driver staged beside the harness to
// (re)record `showcase/base/`'s media from the reference implementation. It
// walks the title menus with real key input, opens Containment on Easy, builds
// on the floor with the real pointer — arming from the shop panel, carrying the
// preview, pressing tiles — sends each wave early from the panel's own SEND
// control, and lets the build's own rules decide everything that happens.
//
// NOTHING IS POSED MID-PLAY. The one call this file makes to the debug surface
// is `reset()`, before the take begins. From the title screen on, every input is
// a key edge or a pointer event at the engine's own event target: the same path
// a human uses. The heat that climbs, the emitters that trip, the units that die
// and the waves that clear are all the game's own arithmetic under that input,
// and the vent each unit enters at is the game's own draw.
//
// WHAT THE PLAYER IS. A script, not an AI. Its decisions are the ones a player
// makes with the floor in front of them, and the shape of the take is the shape
// of Meltdown's own loop:
//
//   1. A short wall goes down — four guns across the middle of the floor and two
//      up the top vent's lane — and Wave 1 is sent early.
//   2. Those few guns do all of the shooting, so the money that comes back goes
//      into making them BETTER rather than into more of them: two of them take an
//      upgrade mid-wave, which raises their heat per shot as well as their
//      damage.
//   3. Between the waves a Forge drops into the gap left in the middle of the
//      wall and is taken to level III, whose thermostat holds everything it
//      touches near the top of the scale. That is Meltdown's tagline played
//      straight: run it hot, because hot is where the damage is.
//   4. Wave 2 is sent early into that, and the floor cooks itself. Guns cross
//      100 and trip offline, the surge walks past the dark ones, and the player
//      answers with a Sink dropped against a face of the first gun to go — the
//      one tower in the game that cools a core with no air left to shed
//      through.
//   5. With the wave paying out, the player builds the wall out into the cross
//      the maze was always going to be, one tower at a time, while the wave is
//      still running.
//
// Two of those are reactive and both are read off the floor rather than
// arranged: WHICH gun trips depends on where the surge walked, and where the
// Sink goes depends on which side of that gun is open. Everything else is a
// fixed script. Because the vents are the game's own draw, no take can be played
// again: every take is RECORDED as it is auditioned, under its own output names,
// and the one that judged best is the one to keep.
//
// Run from the reference workspace root:
//   TCAB_VALIDATION_MEDIA_DIR=<out> TCAB_SHOWCASE_MAX_REPLAY_FRAMES=2600 \
//     npx vitest run --config validation/vitest.config.ts \
//     validation/showcase-capture.test.ts

import { afterEach, beforeEach, it } from "vitest";
import {
  captureReplay,
  captureStill,
  createHarness,
  footprintCenter,
  movePointerTo,
  pressAt,
  rectCenter,
  shopEntry,
  tapAction,
  TICK_HZ,
  type Harness,
  type MeltdownSnapshot,
  type TowerSnapshot,
  type TowerType,
} from "./harness";

/* -------------------------------------------------------------------------- */
/* The floor the player builds                                                */
/* -------------------------------------------------------------------------- */

/** One placement: a type and the top-left tile of its footprint. */
interface Spot {
  readonly type: TowerType;
  readonly col: number;
  readonly row: number;
}

const arc = (col: number, row: number): Spot => ({ type: "arc", col, row });

/**
 * The opening wall, in the order it is laid down: four guns across the middle
 * of the floor, with a gap left in the centre, and two up the top vent's lane.
 *
 * It is deliberately SHORT. A player opening a run has a few hundred to spend,
 * and a few guns are what makes the first wave worth watching: every unit that
 * walks the floor is shot at by the same handful of emitters, so their heat
 * climbs the way it never does once a floor is full.
 *
 * The gap in the middle is left for the Forge, which is what turns this wall
 * from a cool one into a hot one between the waves.
 */
const OPENING_WALL: readonly Spot[] = [
  arc(22, 20),
  arc(26, 20),
  arc(20, 20),
  arc(28, 20),
  arc(24, 18),
  arc(24, 16),
];

/** The gap in the middle of the wall, and what goes in it. */
const FORGE_SPOT: Spot = { type: "forge", col: 24, row: 20 };

/**
 * What the second wave's takings go on, one tower at a time, WHILE that wave is
 * being fought — because building is allowed in every phase and a player with
 * money in hand does not sit on it.
 *
 * The wall reaches out to both sides and the stem grows in both directions, so
 * the floor the take ends on is the cross a maze is supposed to be: the left
 * vent's run to its exhaust has to dip around it and the top vent's drop has to
 * swing around it, and every gun on it is looking at the ground they cross.
 */
const EXPANSION: readonly Spot[] = [
  arc(18, 20),
  arc(30, 20),
  arc(24, 14),
  arc(24, 22),
  arc(16, 20),
  arc(32, 20),
  arc(24, 12),
  arc(24, 24),
  arc(14, 20),
  arc(34, 20),
  arc(24, 10),
  arc(24, 26),
];

/* -------------------------------------------------------------------------- */
/* Driving the game the way a player does                                     */
/* -------------------------------------------------------------------------- */

/** Whole frames of the suite's clock covering `duration` seconds. */
const framesFor = (duration: number): number => Math.round(duration * TICK_HZ);

/** The pace a tower is laid at, in seconds between presses. */
const BUILD_BEAT = 0.3;

/** The cues that count as something happening on the floor. */
const NOTABLE = new Set(["death", "leak", "trip", "place", "sell"]);

/** The tower whose footprint is anchored at `(col, row)`, if one stands there. */
function towerAt(
  snapshot: MeltdownSnapshot,
  col: number,
  row: number,
): TowerSnapshot | undefined {
  return snapshot.towers.find((t) => t.col === col && t.row === row);
}

/** The tower with that id, if it is still standing. */
function byId(
  snapshot: MeltdownSnapshot,
  id: number,
): TowerSnapshot | undefined {
  return snapshot.towers.find((t) => t.id === id);
}

/** Whether every tile of a `size` footprint at `(col, row)` is open floor. */
function footprintIsClear(
  snapshot: MeltdownSnapshot,
  col: number,
  row: number,
  size: number,
): boolean {
  if (col < 0 || row < 0 || col + size > 50 || row + size > 36) return false;
  return !snapshot.towers.some(
    (tower) =>
      col < tower.col + tower.size &&
      tower.col < col + size &&
      row < tower.row + tower.size &&
      tower.row < row + size,
  );
}

/**
 * Where to put a Sink so it draws on `tower`: the first side of it with two
 * clear tiles, taken south first so the Sink lands on the corridor side of the
 * wall where it can be seen.
 *
 * This is the player looking at the floor. It reads only what the floor shows —
 * which tiles are covered — and decides nothing about what the Sink will do once
 * it is there. That is the heat model's business.
 */
function sinkSpotFor(
  snapshot: MeltdownSnapshot,
  tower: TowerSnapshot,
): Spot | null {
  const sides = [
    { col: tower.col, row: tower.row + tower.size },
    { col: tower.col, row: tower.row - 2 },
    { col: tower.col - 2, row: tower.row },
    { col: tower.col + tower.size, row: tower.row },
  ];
  for (const side of sides) {
    if (footprintIsClear(snapshot, side.col, side.row, 2)) {
      return { type: "sink", col: side.col, row: side.row };
    }
  }
  return null;
}

/** The hottest emitter standing. */
function hottest(snapshot: MeltdownSnapshot): TowerSnapshot | undefined {
  return [...snapshot.towers]
    .filter((t) => t.type !== "sink" && t.type !== "forge")
    .sort((a, b) => b.heat - a.heat)[0];
}

/** A take, as it plays: the harness, plus the tally of what it did. */
class Player {
  /** Frames of game time the take has run for, over every phase. */
  frames = 0;
  /** The widest stretch with nothing happening on the floor, in seconds. */
  maxGap = 0;
  private readonly from: number;
  private lastEvent = 0;
  private seen: number;

  constructor(readonly h: Harness) {
    this.from = h.cues.length;
    this.seen = h.cues.length;
  }

  /** How many times `name` has sounded since the take opened. */
  count(name: string): number {
    return this.h.cues.slice(this.from).filter((c) => c.cue === name).length;
  }

  /** A fresh read of the game's own state. */
  snapshot(): MeltdownSnapshot {
    return this.h.snapshot();
  }

  /** Run one frame, keeping the tally the take is judged on. */
  async step(): Promise<void> {
    await this.h.advance(1);
    this.frames += 1;
    for (; this.seen < this.h.cues.length; this.seen += 1) {
      if (NOTABLE.has(this.h.cues[this.seen].cue)) this.lastEvent = this.frames;
    }
    this.maxGap = Math.max(
      this.maxGap,
      (this.frames - this.lastEvent) / TICK_HZ,
    );
  }

  /** Let the game run for `duration` seconds of game time. */
  async beat(duration: number): Promise<void> {
    for (let i = framesFor(duration); i > 0; i -= 1) await this.step();
  }

  /** Move the pointer, then press and release, one frame apart. */
  private async tapAt(x: number, y: number): Promise<void> {
    await movePointerTo(this.h, x, y);
    await pressAt(this.h, x, y);
    this.frames += 3;
  }

  /** Arm a type by pressing its entry in the build panel, as a player does. */
  async armFromShop(type: TowerType): Promise<void> {
    const entry = shopEntry(this.snapshot(), type);
    if (entry === undefined) throw new Error(`no shop entry for ${type}`);
    const { x, y } = rectCenter(entry);
    await this.tapAt(x, y);
  }

  /**
   * Carry the held preview onto a footprint and press the floor.
   *
   * The pointer moves to the footprint's centre, which is the point
   * specs/building.md's preview rule resolves to exactly that footprint, and
   * the press is a real pointer event at the engine's own event target. A
   * refused placement leaves the floor as it was, and the caller sees that in
   * the roster.
   */
  async placeAt(spot: Spot): Promise<boolean> {
    const { x, y } = footprintCenter(spot.type, spot.col, spot.row);
    await this.tapAt(x, y);
    return towerAt(this.snapshot(), spot.col, spot.row) !== undefined;
  }

  /** Arm, place, and put the preview down again — one tower, start to finish. */
  async buildOne(spot: Spot): Promise<boolean> {
    await this.armFromShop(spot.type);
    const placed = await this.placeAt(spot);
    await this.disarm();
    return placed;
  }

  /** Lay a run of towers down at a watchable pace, arming once at the front. */
  async build(spots: readonly Spot[]): Promise<void> {
    let armed: TowerType | null = null;
    for (const spot of spots) {
      if (spot.type !== armed) {
        await this.armFromShop(spot.type);
        armed = spot.type;
      }
      await this.placeAt(spot);
      await this.beat(BUILD_BEAT);
    }
    await this.disarm();
  }

  /**
   * Put the held preview down, through the panel's own CANCEL control.
   *
   * Placement stays armed after a tower lands (specs/building.md), so a player
   * who has finished a run of wall cancels before pressing the floor for
   * anything else.
   */
  async disarm(): Promise<void> {
    const control = this.snapshot().controls.cancel;
    if (control === null) return;
    const { x, y } = rectCenter(control);
    await this.tapAt(x, y);
  }

  /**
   * Close the inspector, through `back` — which deselects when a tower is
   * selected (specs/controls.md). Guarded on there being a selection to close,
   * because `back` on a bare floor opens the pause menu instead.
   */
  async deselect(): Promise<void> {
    await this.disarm();
    if (this.snapshot().selected === null) return;
    await tapAction(this.h, "back");
    this.frames += 1;
  }

  /** Click a placed tower, which opens its inspector and nothing else. */
  async select(tower: TowerSnapshot): Promise<void> {
    await this.disarm();
    const { x, y } = footprintCenter(tower.type, tower.col, tower.row);
    await this.tapAt(x, y);
  }

  /**
   * Select the tower at `(col, row)` and press UPGRADE on its inspector,
   * `times` times, then close the inspector again.
   *
   * The real path: the tower is clicked, the panel draws its inspector, and the
   * inspector's own control is pressed. What the upgrade costs and what it
   * changes are the game's — including that it raises the gun's heat per shot as
   * well as its damage, which is why a player thinks twice about it.
   */
  async upgrade(col: number, row: number, times: number): Promise<void> {
    const tower = towerAt(this.snapshot(), col, row);
    if (tower === undefined) return;
    await this.select(tower);
    await this.beat(0.4);
    for (let i = 0; i < times; i += 1) {
      const control = this.snapshot().controls.upgrade;
      if (control === null) break;
      const { x, y } = rectCenter(control);
      await this.tapAt(x, y);
      await this.beat(0.35);
    }
    await this.beat(0.3);
    await this.deselect();
  }

  /** Press the panel's SEND control, which starts the wave early. */
  async send(): Promise<void> {
    const { x, y } = rectCenter(this.snapshot().controls.send);
    await this.tapAt(x, y);
  }
}

/* -------------------------------------------------------------------------- */
/* One take                                                                   */
/* -------------------------------------------------------------------------- */

/** Something the player does at a fixed moment of the wave being fought. */
interface Move {
  /** Seconds into the wave. */
  readonly at: number;
  readonly act: (p: Player) => Promise<void>;
}

/** What the take carries between its phases. */
interface State {
  /** The emitter that tripped and got the Sink, once one has. */
  cooled: number | null;
  sinkPlaced: boolean;
  settledHeat: number | null;
  peak: number;
  /** How far down {@link EXPANSION} the player has got. */
  built: number;
  lastBuilt: number;
}

/** Whether each still has been written yet, and the take's output prefix. */
interface Stills {
  label: string;
  mid: boolean;
  inspector: boolean;
}

/** What a take turned out to be, which is what a take is judged on. */
interface Take {
  seconds: number;
  towers: number;
  kills: number;
  leaks: number;
  trips: number;
  /** The peak heat any emitter reached, over the whole take. */
  peakHeat: number;
  sinkPlaced: boolean;
  /** The heat the cooled gun was holding at the end, with the Sink on it. */
  settledHeat: number | null;
  maxGap: number;
  wavesCleared: number;
  score: number;
}

/** The ceiling on a take's game time, in seconds. */
const maxSeconds = (): number =>
  Number(process.env.TCAB_SHOWCASE_MAX_SECONDS ?? "48");

/** How each wave is fought: the scripted moves, and whether to build out. */
interface WavePlan {
  readonly moves: readonly Move[];
  /** Seconds into the wave that the build-out starts, or `null` for none. */
  readonly expandFrom: number | null;
}

/**
 * Fight the wave that is running until it clears, or until the take's ceiling.
 *
 * Everything a player does mid-wave happens here, and none of it arranges an
 * outcome: the floor is read, and what a player would do about what it says is
 * done through the pointer.
 */
async function fightWave(
  p: Player,
  record: boolean,
  state: State,
  stills: Stills,
  plan: WavePlan,
): Promise<boolean> {
  const cap = framesFor(maxSeconds());
  const clears = p.count("wave-clear");
  const opened = p.frames;
  const moves = [...plan.moves];
  let clearedAt: number | null = null;

  while (p.frames < cap) {
    await p.step();
    const snapshot = p.snapshot();
    for (const tower of snapshot.towers) {
      state.peak = Math.max(state.peak, tower.heat);
    }
    const into = (p.frames - opened) / TICK_HZ;

    // A gun has gone over the top and tripped. The player reads it off the
    // floor and drops a Sink against it — the one tower that cools a gun with
    // no air left to shed through.
    if (!state.sinkPlaced && snapshot.money >= 20) {
      const tripped = snapshot.towers.find((t) => t.tripped);
      if (tripped !== undefined) {
        const spot = sinkSpotFor(snapshot, tripped);
        if (spot !== null) {
          state.sinkPlaced = await p.buildOne(spot);
          if (state.sinkPlaced) state.cooled = tripped.id;
        }
      }
    }

    // Where the cooled gun is held once the Sink is drawing on it.
    if (state.cooled !== null) {
      const gun = byId(snapshot, state.cooled);
      if (gun !== undefined && !gun.tripped) state.settledHeat = gun.heat;
    }

    // The scripted moves, each at its moment.
    if (moves.length > 0 && into >= moves[0].at) {
      const move = moves.shift();
      if (move !== undefined) await move.act(p);
      continue;
    }

    // The build-out: with the takings piling up, the player goes on building
    // through the wave, one tower at a time as the money comes in.
    if (
      plan.expandFrom !== null &&
      into >= plan.expandFrom &&
      state.built < EXPANSION.length &&
      p.frames - state.lastBuilt >= framesFor(1.0) &&
      snapshot.money >= 15
    ) {
      if (await p.buildOne(EXPANSION[state.built])) state.built += 1;
      state.lastBuilt = p.frames;
      continue;
    }

    // The inspector: the player clicks the hottest gun on the floor to read
    // what it is doing. Selecting changes nothing but the selection, and the
    // clip shows the click happen and the panel fill in.
    if (!stills.inspector && state.sinkPlaced) {
      const gun = hottest(snapshot);
      if (gun !== undefined) {
        await p.select(gun);
        await p.beat(0.9);
        if (record) captureStill(p.h, `${stills.label}-inspector`);
        stills.inspector = true;
        await p.beat(0.7);
        await p.deselect();
        continue;
      }
    }

    // A still of the floor mid-wave, and the one that has to carry the case:
    // the maze half built out, a stream walking it, the guns up their glow ramp
    // and the ones that went over the top dark. It waits for a tripped tower to
    // be on the floor, and settles for a full floor if the wave never gives it
    // one.
    if (
      !stills.mid &&
      stills.inspector &&
      state.built >= 5 &&
      snapshot.surge.length >= 6 &&
      (snapshot.towers.some((t) => t.tripped) || state.built >= 9)
    ) {
      if (record) captureStill(p.h, `${stills.label}-mid-wave`);
      stills.mid = true;
    }

    if (clearedAt === null && p.count("wave-clear") > clears) {
      clearedAt = p.frames;
    }
    if (clearedAt !== null && p.frames - clearedAt >= framesFor(1.4)) break;
  }
  return clearedAt !== null;
}

/**
 * Play one take start to finish and report what it turned out to be.
 *
 * `record` gates only the writing of the stills, under `label`. Every input the
 * player makes is made either way.
 */
async function runTake(
  h: Harness,
  label: string,
  record: boolean,
): Promise<Take> {
  h.debug.reset();
  await h.advance(1);
  const p = new Player(h);

  // The title menus, walked with real key input: PLAY, CONTAINMENT, EASY.
  await tapAction(h, "confirm");
  await p.beat(0.4);
  await tapAction(h, "confirm");
  await p.beat(0.4);
  await tapAction(h, "confirm");
  await p.beat(0.45);

  const state: State = {
    cooled: null,
    sinkPlaced: false,
    settledHeat: null,
    peak: 0,
    built: 0,
    lastBuilt: 0,
  };
  const stills: Stills = { label, mid: false, inspector: false };

  // Wave 1: the short wall, sent early, and the takings spent on making the
  // guns that are already there better rather than on more of them.
  await p.build(OPENING_WALL);
  await p.beat(0.5);
  await p.send();
  const first = await fightWave(p, record, state, stills, {
    moves: [
      { at: 4.0, act: (q) => q.upgrade(22, 20, 1) },
      { at: 8.5, act: (q) => q.upgrade(26, 20, 1) },
    ],
    expandFrom: null,
  });

  // Between the waves: the Forge fills the gap in the middle of the wall and is
  // taken to level III, so its thermostat holds the whole wall near the top of
  // the scale — and one more gun takes an upgrade on top of that.
  await p.beat(0.6);
  await p.build([FORGE_SPOT]);
  await p.upgrade(FORGE_SPOT.col, FORGE_SPOT.row, 2);
  await p.upgrade(20, 20, 1);
  await p.beat(0.4);
  await p.send();
  const second = await fightWave(p, record, state, stills, {
    moves: [],
    expandFrom: 2.0,
  });

  const snapshot = p.snapshot();
  return {
    seconds: p.frames / TICK_HZ,
    towers: snapshot.towers.length,
    kills: p.count("death"),
    leaks: p.count("leak"),
    trips: p.count("trip"),
    peakHeat: state.peak,
    sinkPlaced: state.sinkPlaced,
    settledHeat: state.settledHeat,
    maxGap: p.maxGap,
    wavesCleared: (first ? 1 : 0) + (second ? 1 : 0),
    score: snapshot.score,
  };
}

/** What makes a watchable clip, scored so takes can be ranked against it. */
function judge(take: Take): number {
  return (
    take.kills * 2 +
    take.wavesCleared * 20 +
    (take.trips > 0 ? 15 : -15) +
    (take.sinkPlaced ? 10 : -10) +
    (take.settledHeat !== null ? 5 : 0) +
    take.towers -
    take.leaks * 4 -
    take.maxGap * 4
  );
}

const report = (label: string, take: Take): string =>
  `${label}: ${take.seconds.toFixed(1)}s, ${take.towers} towers, ` +
  `${take.kills} kills, ${take.leaks} leaks, ${take.trips} trips, ` +
  `peak ${take.peakHeat.toFixed(0)}, sink ${take.sinkPlaced ? "in" : "no"}, ` +
  `settled ${take.settledHeat === null ? "-" : take.settledHeat.toFixed(0)}, ` +
  `gap ${take.maxGap.toFixed(1)}s, ${take.wavesCleared} cleared, ` +
  `score ${take.score} -> ${judge(take).toFixed(0)}`;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("records a gameplay clip", async () => {
  const h = harness;
  const takes = Number(process.env.TCAB_SHOWCASE_TAKES ?? "6");

  // Every take is recorded as it plays, because a take cannot be played again:
  // the vents are the game's own draw. The winner is named at the end, and its
  // three outputs are the ones to keep.
  let best: { label: string; rating: number } | null = null;
  for (let index = 1; index <= takes; index += 1) {
    const label = `take-${index}`;
    const take = await captureReplay(h, `${label}-gameplay`, () =>
      runTake(h, label, true),
    );
    const rating = judge(take);
    console.log(report(label, take));
    if (best === null || rating > best.rating) best = { label, rating };
  }

  console.log(`best ${best!.label}`);
}, 1_800_000);
