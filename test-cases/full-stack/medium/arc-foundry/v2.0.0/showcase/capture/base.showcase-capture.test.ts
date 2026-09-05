// showcase-capture — record a REAL SESSION of Arc Foundry for the case showcase.
//
// Not a validator: a temporary capture driver staged beside the harness to
// (re)record `showcase/base/`'s replay and its two stills from the reference
// implementation. It walks the title menu into a run with pointer presses, then
// plays the run the way a player does — pull the press, sweep the cursor over the
// yard, drop the five rocks the level allows, read what they rolled, fold or keep
// one of them to send the wave, push the speed up while the Load crosses, and
// refine the press out of the bounty the wave paid.
//
// EVERY OUTCOME ON SCREEN IS THE GAME'S. The only calls this driver makes on the
// debug surface are the three READINGS — `snapshot()`, `panelButtons()`, and
// `statusControls()` — which change nothing. Nothing is placed, rolled,
// killed, or paid for through the surface: a rock lands because the pointer
// pressed a legal footprint, it rolls what the run's own generator gave it, the
// harvest is whichever inspector action the game offered, and every kill and every
// leak is the simulation's. Arranging the input is authoring; posing the outcome
// would be fabrication.
//
// AUDITIONING. Confirming a difficulty starts a run and reseeds the press, which is
// the game keeping two runs started from the menu off the same rolls, so a take
// cannot be played silently and then replayed identically under the recorder. Every
// take is therefore recorded as it is played and the best one is kept: the take that
// was judged is the take that was committed. The judge scores what makes a watchable
// clip — structures standing, kills landed, waves cleared, folds committed (a recipe
// fold most of all, because a combination tower is the deepest thing a level
// produces), Grid Integrity held, and a clean ending on the settled beat a wave
// clear gives.
//
// Run from the reference workspace root:
//   TCAB_VALIDATION_MEDIA_DIR=<out> TCAB_SHOWCASE_MAX_REPLAY_FRAMES=1500 \
//     TCAB_SHOWCASE_TAKES=8 \
//     npx vitest run --config validation/vitest.config.ts \
//     validation/showcase-capture.test.ts

import { ConstantClock } from "@clockwyrks/structured-2d";
import { it } from "vitest";

import { STAMPS_PER_LEVEL } from "../src/constants";
import {
  captureReplay,
  captureStill,
  clickAt,
  createHarness,
  structureCenter,
  tileCenter,
  pressAction,
  pressMenu,
  type FoundrySnapshot,
  type Harness,
  type PanelButton,
  type StructureView,
} from "./harness";

/* -------------------------------------------------------------------------- */
/* The clip's shape                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The frame the take is played and recorded at.
 *
 * A replay carries each kept frame's own delta, so the clip plays back at the rate
 * it was recorded at. Sixty is the rate the game is drawn at in a browser, and it
 * divides the replay cap into exactly the clip length wanted: at
 * `TCAB_SHOWCASE_MAX_REPLAY_FRAMES=1500` a take of `1500` frames is kept whole,
 * with no thinning at all.
 */
const SHOW_HZ = 60;
const SHOW_MS = 1000 / SHOW_HZ;

const seconds = (s: number): number => Math.round(s * SHOW_HZ);

/** Bounds on the recorded take, in frames. */
const MIN_FRAMES = seconds(Number(process.env.TCAB_SHOWCASE_MIN_SECONDS ?? "20"));
const MAX_FRAMES = seconds(Number(process.env.TCAB_SHOWCASE_MAX_SECONDS ?? "27"));

/** Frames a level needs before it is worth opening another one. */
const LEVEL_ROOM = seconds(6);

/**
 * The speed multiplier the player pushes to once the Load is crossing.
 *
 * The Substation's chain is a lap of the whole yard, so a Mote spends the better
 * part of a minute walking it, and nobody watches that at `1`. Four is the rung
 * that keeps the Load readable — strung out along the maze, taking hits, dropping
 * one at a time — while still fitting several levels into one clip.
 */
const WAVE_SPEED = Number(process.env.TCAB_SHOWCASE_WAVE_SPEED ?? "4");

/* -------------------------------------------------------------------------- */
/* Where the rocks go                                                         */
/* -------------------------------------------------------------------------- */
//
// One ordered plan of anchors, walked from the front: each stamp takes the next
// anchor whose footprint the game reports legal under the pointer, so a plan entry
// the never-seal rule or a standing structure refuses is simply passed over rather
// than fought with. The anchors flank and pinch The Substation's chain — the top
// run out to WP1, the drop down its right side to WP2, and the bottom run back to
// WP3 — alternating above and below the lane so the route weaves between them and
// every component stands within reach of something walking past it.

interface Anchor {
  col: number;
  row: number;
}

const PLAN: readonly Anchor[] = [
  // The top run, from the feeder vent out to WP1: a comb across the lane.
  { col: 8, row: 4 },
  { col: 12, row: 6 },
  { col: 16, row: 4 },
  { col: 20, row: 6 },
  { col: 24, row: 4 },
  { col: 28, row: 6 },
  { col: 32, row: 4 },
  { col: 36, row: 6 },
  { col: 40, row: 4 },
  { col: 6, row: 6 },
  { col: 10, row: 6 },
  { col: 14, row: 4 },
  { col: 18, row: 6 },
  { col: 22, row: 4 },
  { col: 26, row: 6 },
  { col: 30, row: 4 },
  { col: 34, row: 6 },
  { col: 38, row: 4 },
  // The drop down the right side, WP1 to WP2.
  { col: 43, row: 9 },
  { col: 45, row: 12 },
  { col: 43, row: 15 },
  { col: 45, row: 18 },
  { col: 43, row: 21 },
  { col: 45, row: 24 },
  { col: 41, row: 11 },
  { col: 41, row: 17 },
  { col: 41, row: 23 },
  // The bottom run back to WP3.
  { col: 38, row: 26 },
  { col: 34, row: 28 },
  { col: 30, row: 26 },
  { col: 26, row: 28 },
  { col: 22, row: 26 },
  { col: 18, row: 28 },
  { col: 14, row: 26 },
  { col: 10, row: 28 },
];

/** A patch of yard well clear of the plan, pressed to drop the selection. */
const EMPTY_YARD: Anchor = { col: 2, row: 30 };

/* -------------------------------------------------------------------------- */
/* The session                                                                */
/* -------------------------------------------------------------------------- */

/** What a take left behind, and what the judge reads it by. */
interface Take {
  frames: number;
  wave: number;
  cleared: number;
  structures: number;
  kills: number;
  folds: number;
  specials: number;
  integrity: number;
  charge: number;
  refinement: number;
  endedOnBeat: boolean;
}

/** One played take of the session, driven entirely through input. */
class Session {
  /** Frames advanced since the take opened. */
  private spent = 0;
  /** How far down {@link PLAN} the level's stamps have walked. */
  private at = 0;
  private folds = 0;
  private specials = 0;
  private cleared = 0;
  /** The most of the Load and its incoming fire ever at once, for the still. */
  private busiest = 0;
  private endedOnBeat = false;

  constructor(
    private readonly h: Harness,
    /** What this take's stills are written under, or `null` outside a capture. */
    private readonly stills: string | null,
  ) {}

  private get budget(): boolean {
    return this.spent < MAX_FRAMES;
  }

  /** Advance `n` frames of the take's own clock, counting them. */
  private async run(n: number): Promise<void> {
    await this.h.advance(n);
    this.spent += n;
  }

  /** A pointer press, and the frame it is delivered on, counted. */
  private async press(x: number, y: number): Promise<void> {
    await clickAt(this.h, x, y);
    this.spent += 1;
  }

  private async pressTile(anchor: Anchor): Promise<void> {
    const at = structureCenter(anchor.col, anchor.row);
    await this.press(at.x, at.y);
  }

  private snapshot(): FoundrySnapshot {
    return this.h.snapshot();
  }

  /** The inspector's controls for whatever is selected right now. */
  private panel(): PanelButton[] {
    return this.h.debug.panelButtons();
  }

  private control(action: string): PanelButton | undefined {
    return this.panel().find((b) => b.action === action && !b.disabled);
  }

  /** Walk the title menu into a run on The Substation at Medium. */
  async enterRun(): Promise<void> {
    await this.run(seconds(0.5));
    await pressMenu(this.h, "salvage");
    await this.run(seconds(0.45));
    await pressMenu(this.h, "map-substation");
    await this.run(seconds(0.45));
    await pressMenu(this.h, "difficulty-medium");
    await this.run(seconds(0.5));
  }

  /**
   * Pull the press and spend the level's whole allowance.
   *
   * The cursor is moved onto an anchor and left there for a moment before the
   * press, so the held footprint is seen travelling and reading legal or illegal
   * the way it does under a hand. A footprint the game reports illegal is passed
   * over for the next anchor in the plan rather than pressed.
   */
  async stampOut(): Promise<void> {
    await pressAction(this.h, "stamp");
    this.spent += 1;
    await this.run(seconds(0.2));

    for (let dropped = 0; dropped < STAMPS_PER_LEVEL && this.budget; ) {
      if (this.at >= PLAN.length) break;
      const anchor = PLAN[this.at]!;
      this.at += 1;
      const at = structureCenter(anchor.col, anchor.row);
      this.h.pointerMove(at.x, at.y);
      await this.run(seconds(0.15));
      if (!this.snapshot().held.legal) continue;
      // The build phase, as a player sees it: the odds and the allowance on the
      // panel, the candidates already rolled, and the next footprint reading legal
      // under the cursor. Overwritten by every later level.
      if (this.stills !== null) captureStill(this.h, `${this.stills}-build`);
      const before = this.snapshot().structures.length;
      await this.press(at.x, at.y);
      await this.run(seconds(0.12));
      if (this.snapshot().structures.length > before) dropped += 1;
    }
  }

  /** The candidates standing on the yard, in the order they were placed. */
  private candidates(): StructureView[] {
    return this.snapshot().structures.filter((s) => s.kind === "candidate");
  }

  /**
   * Commit the level's harvest, which is what sends the wave.
   *
   * Each candidate is selected in turn and the inspector is READ: whatever fold the
   * game offers on it is what gets pressed, a recipe first because a combination
   * tower is the deepest thing a level can produce, then a quality fold, and a
   * plain KEEP of the best roll when it offers neither. Nothing here decides what a
   * candidate is worth beyond preferring the higher tier.
   */
  async harvest(): Promise<void> {
    const rolled = this.candidates();
    if (rolled.length === 0) return;

    // A level yields exactly one firing structure, so what it is worth is what it
    // will shoot with: a roll that fires beats one that cannot, and among those the
    // heaviest hitter wins. `damage` is the game's own figure for the roll,
    // read off the snapshot rather than worked out here.
    const rank = (one: StructureView): number =>
      one.type === "regulator" ? -1 : one.damage;
    let best = rolled[0]!;
    for (const candidate of rolled) {
      await this.pressTile(candidate);
      await this.run(seconds(0.18));
      const special = this.control("combine-special");
      if (special !== undefined) {
        await this.press(special.x + special.w / 2, special.y + special.h / 2);
        await this.run(seconds(0.5));
        this.folds += 1;
        this.specials += 1;
        return;
      }
      if (rank(candidate) > rank(best)) best = candidate;
    }

    for (const candidate of rolled) {
      if (candidate.type === "regulator") continue;
      await this.pressTile(candidate);
      await this.run(seconds(0.15));
      const fold = this.control("combine");
      if (fold !== undefined) {
        await this.press(fold.x + fold.w / 2, fold.y + fold.h / 2);
        await this.run(seconds(0.5));
        this.folds += 1;
        return;
      }
    }

    await this.pressTile(best);
    await this.run(seconds(0.25));
    const keep = this.control("keep");
    if (keep === undefined) return;
    await this.press(keep.x + keep.w / 2, keep.y + keep.h / 2);
    await this.run(seconds(0.3));
  }

  /** Push the speed control up to {@link WAVE_SPEED}, one press per step. */
  async pushSpeed(): Promise<void> {
    for (let guard = 0; guard < 4; guard += 1) {
      const control = this.h.debug
        .statusControls()
        .find((c) => c.action === "speed");
      if (control === undefined || control.state === WAVE_SPEED) return;
      await this.press(control.x + control.w / 2, control.y + control.h / 2);
      await this.run(seconds(0.12));
    }
  }

  /**
   * Watch the wave cross, and stop at the clear.
   */
  async watchWave(): Promise<void> {
    while (this.budget) {
      const s = this.snapshot();
      if (s.phase !== "wave") break;
      await this.run(6);
      // The still is taken on the busiest frame the take ever reaches, each new
      // high overwriting the last: the most of the Load and its incoming fire on
      // the yard at once is where the game looks most like itself, and that comes
      // later in a take, over a fuller yard.
      const busy = this.snapshot();
      const live = busy.units.length + busy.projectiles.length;
      if (this.stills !== null && live > this.busiest && busy.units.length > 0) {
        this.busiest = live;
        captureStill(this.h, `${this.stills}-wave`);
      }
    }
    if (this.snapshot().phase === "build") this.cleared += 1;
  }

  /**
   * Spend the wave's bounty on the press, which is the run's only lasting
   * investment: a refinement lifts every roll the press makes from here on, and the
   * panel's odds change under it.
   *
   * The `upgrade` action refines the press whenever the selection is not a
   * combination tower (specs/controls.md), so the selection is dropped on a bare
   * patch of yard first, exactly as a player clearing it would.
   */
  async refine(): Promise<void> {
    const at = tileCenter(EMPTY_YARD.col, EMPTY_YARD.row);
    await this.press(at.x, at.y);
    await this.run(seconds(0.2));
    const before = this.snapshot().refinement;
    await pressAction(this.h, "upgrade");
    this.spent += 1;
    await this.run(seconds(0.4));
    if (this.snapshot().refinement > before) await this.run(seconds(0.5));
  }

  /** Play the session out, and report what it produced. */
  async play(): Promise<Take> {
    await this.enterRun();

    let pushed = false;
    while (this.spent < MAX_FRAMES - LEVEL_ROOM) {
      await this.stampOut();
      if (!this.budget) break;
      await this.harvest();
      if (this.snapshot().phase !== "wave") break;
      if (!pushed) {
        await this.pushSpeed();
        pushed = true;
      }
      await this.watchWave();
      if (this.spent >= MIN_FRAMES && this.snapshot().phase === "build") {
        // A wave clear is the settled beat: the yard is standing, the Load is
        // gone, the bonus has landed, and the next build phase has just opened.
        await this.run(seconds(0.8));
        this.endedOnBeat = true;
        break;
      }
      await this.refine();
    }

    const s = this.snapshot();
    return {
      frames: this.spent,
      wave: s.wave,
      cleared: this.cleared,
      structures: s.structures.length,
      kills: s.structures.reduce((total, one) => total + one.kills, 0),
      folds: this.folds,
      specials: this.specials,
      integrity: s.integrity,
      charge: s.charge,
      refinement: s.refinement,
      endedOnBeat: this.endedOnBeat,
    };
  }
}

/* -------------------------------------------------------------------------- */
/* The take                                                                   */
/* -------------------------------------------------------------------------- */

/** A take is judged on what makes a watchable clip. */
function judge(take: Take): number {
  return (
    take.cleared * 25 +
    take.specials * 30 +
    take.folds * 12 +
    take.kills * 0.5 +
    take.structures * 1.5 +
    take.refinement * 8 +
    (take.integrity >= 20 ? 10 : take.integrity * 0.5) +
    (take.endedOnBeat ? 25 : -25)
  );
}

it("records session clips", async () => {
  // EVERY TAKE IS RECORDED, AND THE BEST ONE IS KEPT.
  //
  // Confirming a difficulty is what starts a run, and the game reseeds its press
  // there on purpose, so that two runs started from the menu never draw the same
  // rolls. A take driven the way a player drives one therefore cannot be
  // auditioned with the recorder off and then replayed identically under it: the
  // second playing is a different session. So each take is recorded as it is
  // played, judged on what it actually produced, and the winner's files are the
  // ones committed — the take that was judged is the take that was kept.
  //
  // Each take gets its own engine as well: a session replayed over a world that
  // has already run inherits its frame counter, its pointer, the effects still
  // playing, and whatever input edges the last take left armed.
  const takes = Number(process.env.TCAB_SHOWCASE_TAKES ?? "8");

  const runTake = async (label: string): Promise<Take> => {
    const h = await createHarness({ clock: new ConstantClock(SHOW_MS) });
    try {
      await h.advance(1);
      const session = new Session(h, label);
      return await captureReplay(h, label, () => session.play());
    } finally {
      h.dispose();
    }
  };

  let best: { label: string; score: number } | null = null;
  for (let take = 1; take <= takes; take += 1) {
    const label = `take-${String(take).padStart(2, "0")}`;
    const played = await runTake(label);
    const score = judge(played);
    console.log(
      `${label}: wave ${played.wave}, ${played.cleared} cleared, ` +
        `${played.structures} standing, ${played.kills} kills, ` +
        `${played.folds} folds (${played.specials} recipe), ` +
        `R${played.refinement}, ${played.integrity} integrity, ` +
        `${(played.frames / SHOW_HZ).toFixed(1)}s, ` +
        `${played.endedOnBeat ? "clean end" : "ran out"} -> ${score.toFixed(0)}`,
    );
    if (best === null || score > best.score) best = { label, score };
  }

  console.log(
    `best take: ${best!.label} (${best!.score.toFixed(0)}) — commit ` +
      `${best!.label}.json.gz as gameplay.json.gz, ` +
      `${best!.label}-wave.png as mid-wave.png, and ` +
      `${best!.label}-build.png as build-phase.png`,
  );
}, 1_800_000);
