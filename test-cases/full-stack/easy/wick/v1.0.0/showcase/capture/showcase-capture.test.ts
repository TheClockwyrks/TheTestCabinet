// showcase-capture — record a REAL STRETCH OF THE NIGHT for the case showcase.
//
// Not a validator: a temporary capture driver staged beside the harness to
// (re)record `showcase/base/gameplay.json.gz` and its two stills from the
// variant's reference implementation. It opens on the title, lights the lamp
// with a key press, and then plays the night the way a player does — walking
// with the arrow keys, kiting the crowd that is chasing, sweeping through the
// gems the kills leave, and taking each level-up by moving the highlight and
// pressing confirm. The recorder joins that night part way through; see
// LEAD_SECONDS below.
//
// EVERY OUTCOME ON SCREEN IS THE GAME'S. Two debug operations are called and
// no others: `reset({ seed })`, which lays the generator the night's spawns,
// offers, and drops are drawn from and is how a take is auditioned at all,
// and `snapshot()`, a reading that changes nothing. Nothing is placed, killed,
// healed, levelled, or steered through the surface — the lamplighter walks
// because an arrow key is down, every moth is where the director put it, every
// slash is Taper's own timer coming due, every gem is a kill's, and every
// offer is the pool's draw. Arranging the input is authoring; posing the
// outcome would be fabrication.
//
// AUDITIONING. A seed fixes the whole night, so a take could in principle be
// played silently and replayed identically under the recorder. It is recorded
// as it is played anyway: the take that was judged is then provably the take
// that was committed, and re-playing a take is the expensive half. The judge
// scores what makes a watchable clip of THIS game — kills, the size of the
// crowd on screen at once, gems collected, level-ups taken and the tools they
// put on the HUD, surviving to the end, and a clean ending on the beat a kill
// gives.
//
// Run from the staged reference workspace root; `showcase/capture/README.md`
// has the staging steps and the knobs:
//   TCAB_VALIDATION_MEDIA_DIR=<out> TCAB_SHOWCASE_MAX_REPLAY_FRAMES=2500 \
//     TCAB_SHOWCASE_TAKES=10 \
//     npx vitest run --config validation/vitest.config.ts \
//     validation/showcase-capture.test.ts

import { it } from "vitest";

import {
  BINDINGS,
  ENEMIES,
  MOVE_SPEED,
  PLAYER_RADIUS,
  STAGE_CX,
  STAGE_CY,
  TAPER_LEVELS,
  TICK_DT,
  TICK_HZ,
} from "./constants";
import {
  captureReplay,
  captureStill,
  createHarness,
  type Harness,
} from "./harness";
import type { OfferId, SnapshotEnemy, WickSnapshot } from "./surface";

/* -------------------------------------------------------------------------- */
/* The clip's shape                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Frames covering `s` seconds of the take.
 *
 * Under this engine one frame is one tick (`specs/instrumentation.md`, "What
 * the runtime provides instead"), so the take runs at `TICK_HZ` frames a
 * second and a replay carries each kept frame's delta — the clip plays back at
 * the rate it was recorded at.
 */
const seconds = (s: number): number => Math.round(s * TICK_HZ);

/** Bounds on the recorded take, in frames. */
const MIN_FRAMES = seconds(
  Number(process.env.TCAB_SHOWCASE_MIN_SECONDS ?? "24"),
);
const MAX_FRAMES = seconds(
  Number(process.env.TCAB_SHOWCASE_MAX_SECONDS ?? "30"),
);

/** How long the title screen is left up before the lamp is lit. */
const TITLE_HOLD = seconds(1.3);

/** How long an overlay is read before the highlight moves, and between moves. */
const OVERLAY_READ = seconds(0.5);
const OVERLAY_STEP = seconds(0.28);

/** How long the night is watched on after the kill the clip ends on. */
const SETTLE = seconds(1.1);

/**
 * Where the recorded stretch opens, in run-clock seconds.
 *
 * Wick's first half-minute is one moth a second against one tool, and a clip
 * of it shows a mostly empty field. The night the case is about is the one a
 * couple of minutes in — bats, rats and beetles arriving every half second
 * against a lamplighter carrying five tools, and the night's first elite due
 * at two minutes — so the take plays the night up to here unrecorded and
 * records from there, through the elite's arrival.
 */
const LEAD_SECONDS = Number(process.env.TCAB_SHOWCASE_LEAD_SECONDS ?? "105");

/** How often the player reconsiders which way to walk, in frames. */
const DECIDE_EVERY = 6;

/** The key each of the four movement actions is held with, per `specs/controls.md`. */
const MOVE_KEYS = {
  up: BINDINGS.up[0],
  down: BINDINGS.down[0],
  left: BINDINGS.left[0],
  right: BINDINGS.right[0],
} as const;

/** The keys that work a menu. */
const DOWN_KEY = BINDINGS.down[0];
const CONFIRM_KEY = BINDINGS.confirm[0];

/* -------------------------------------------------------------------------- */
/* Walking the night                                                          */
/* -------------------------------------------------------------------------- */
//
// The routing below is ordinary play reasoning over what a player can see: the
// crowd closing in, the gems it left behind, and where Taper's next slash will
// land. It reads all of that off `snapshot()` rather than out of the build's
// modules, and it never writes any of it.

/** One of the nine ways a player can hold the four movement keys. */
interface Heading {
  readonly keys: readonly string[];
  readonly x: number;
  readonly y: number;
}

/** The nine headings, each already normalized as `specs/world.md` normalizes it. */
const HEADINGS: readonly Heading[] = (() => {
  const steps: Array<[number, number, string[]]> = [
    [0, 0, []],
    [1, 0, [MOVE_KEYS.right]],
    [-1, 0, [MOVE_KEYS.left]],
    [0, 1, [MOVE_KEYS.down]],
    [0, -1, [MOVE_KEYS.up]],
    [1, 1, [MOVE_KEYS.right, MOVE_KEYS.down]],
    [1, -1, [MOVE_KEYS.right, MOVE_KEYS.up]],
    [-1, 1, [MOVE_KEYS.left, MOVE_KEYS.down]],
    [-1, -1, [MOVE_KEYS.left, MOVE_KEYS.up]],
  ];
  return steps.map(([x, y, keys]) => {
    const length = Math.hypot(x, y) || 1;
    return { keys, x: x / length, y: y / length };
  });
})();

/** How far ahead a candidate heading is walked before it is judged, in ticks. */
const LOOKAHEAD = 26;

/**
 * How far ahead Taper's next slash is planned for, in ticks.
 *
 * Longer than the lookahead: Taper's cooldown is well over a second
 * (`specs/weapons.md`), and a player who only started turning toward the crowd
 * a quarter of a second before the slash landed would never reach it.
 */
const SLASH_HORIZON = 48;

/**
 * How far from the nearest enemy this player likes to walk, in units.
 *
 * Taper is a rectangle reaching `width` units in the facing direction, so
 * standing off the crowd entirely is standing out of the lamp's own reach.
 * That is the whole shape of this game and the reason the number is small:
 * every tool fires on its own, killing is the only thing that thins a crowd,
 * and a lamplighter who walks away from the night stops killing, stops
 * levelling, and is overrun by the night that caught up. So the player walks
 * the edge of the crowd, close enough to sweep it and far enough not to be
 * touched.
 */
const HOVER = 70;

/** Half the view, in world units: what a player can actually see coming. */
const VIEW_HX = STAGE_CX;
const VIEW_HY = STAGE_CY;

/**
 * How near the lamplighter an enemy has to be to read as part of the press,
 * in units: a still ranked on the whole view is won by a picture of a mostly
 * empty field with a few specks at its edges.
 */
const CLOSE_IN = 420;

/** An enemy reduced to what the lookahead needs of it. */
interface Chaser {
  x: number;
  y: number;
  speed: number;
  radius: number;
}

/** The enemies close enough to matter to the next half second. */
function chasers(s: WickSnapshot): Chaser[] {
  const { x, y } = s.run.player;
  const near: Chaser[] = [];
  for (const enemy of s.run.enemies) {
    if (Math.hypot(enemy.x - x, enemy.y - y) > 700) continue;
    near.push({
      x: enemy.x,
      y: enemy.y,
      speed: ENEMIES[enemy.type].speed,
      radius: ENEMIES[enemy.type].radius,
    });
  }
  return near;
}

/** Whether an enemy is inside the view the camera shows. */
function onScreen(
  player: { x: number; y: number },
  enemy: SnapshotEnemy,
): boolean {
  return (
    Math.abs(enemy.x - player.x) <= VIEW_HX &&
    Math.abs(enemy.y - player.y) <= VIEW_HY
  );
}

/**
 * How many enemies Taper's next slash would sweep, walking `heading`.
 *
 * The slash is a rectangle whose near vertical edge sits at the lamplighter's
 * `x`, extending `width` in the facing direction and centred on `y`
 * (`specs/weapons.md`, Taper); with amount `2` a second slash mirrors it. The
 * facing a heading leaves is the sign of its horizontal component, and a
 * heading with none leaves the facing as it was (`specs/world.md`, Facing).
 * Only a slash that comes due inside the lookahead is counted.
 */
function slashValue(
  s: WickSnapshot,
  heading: Heading,
  live: readonly Chaser[],
  after?: number,
): number {
  const taper = s.run.weapons.find((weapon) => weapon.id === "taper");
  if (taper === undefined) return 0;
  const ticks = after ?? Math.round(taper.cooldown * TICK_HZ);
  if (ticks > SLASH_HORIZON) return 0;

  const row = TAPER_LEVELS[Math.min(taper.level, TAPER_LEVELS.length) - 1];
  const step = MOVE_SPEED * TICK_DT;
  const px = s.run.player.x + heading.x * step * ticks;
  const py = s.run.player.y + heading.y * step * ticks;
  const sign =
    heading.x > 0
      ? 1
      : heading.x < 0
        ? -1
        : s.run.player.facing === "left"
          ? -1
          : 1;
  const sides = row.amount >= 2 ? [sign, -sign] : [sign];

  let swept = 0;
  for (const chaser of live) {
    // Where the chaser will be when the slash lands, closing on the player.
    const toX = px - chaser.x;
    const toY = py - chaser.y;
    const away = Math.hypot(toX, toY) || 1;
    const travel = Math.min(away, chaser.speed * TICK_DT * ticks);
    const ex = chaser.x + (toX / away) * travel;
    const ey = chaser.y + (toY / away) * travel;
    if (Math.abs(ey - py) > row.height / 2 + chaser.radius) continue;
    for (const side of sides) {
      const near = side > 0 ? px : px - row.width;
      const far = near + row.width;
      if (ex + chaser.radius > near && ex - chaser.radius < far) {
        swept += 1;
        break;
      }
    }
  }
  return swept;
}

/**
 * The heading the player takes next.
 *
 * Every one of the nine is walked forward for {@link LOOKAHEAD} ticks against
 * a crowd that walks straight at wherever the lamplighter has got to, and each
 * is scored the way a player weighs one: does it keep the crowd off, does it
 * sweep the gems the last kills left, does it hold the fight close enough to
 * be a fight at all, and does it put the next slash through something.
 */
function steer(s: WickSnapshot): Heading {
  const live = chasers(s);
  const gems = s.run.gems;
  const pickups = s.run.pickups;
  const step = MOVE_SPEED * TICK_DT;

  let best = HEADINGS[0];
  let bestScore = -Infinity;
  for (const heading of HEADINGS) {
    let px = s.run.player.x;
    let py = s.run.player.y;
    const crowd = live.map((chaser) => ({ ...chaser }));
    let clearance = Infinity;

    for (let tick = 0; tick < LOOKAHEAD; tick += 1) {
      px += heading.x * step;
      py += heading.y * step;
      for (const chaser of crowd) {
        const dx = px - chaser.x;
        const dy = py - chaser.y;
        const away = Math.hypot(dx, dy) || 1;
        const travel = Math.min(away, chaser.speed * TICK_DT);
        chaser.x += (dx / away) * travel;
        chaser.y += (dy / away) * travel;
        clearance = Math.min(
          clearance,
          away - travel - chaser.radius - PLAYER_RADIUS,
        );
      }
    }

    let nearestEnemy = Infinity;
    for (const chaser of crowd) {
      nearestEnemy = Math.min(
        nearestEnemy,
        Math.hypot(px - chaser.x, py - chaser.y),
      );
    }

    let gathered = 0;
    let nearestGem = Infinity;
    for (const gem of gems) {
      const away = Math.hypot(px - gem.x, py - gem.y);
      if (away <= s.run.pickupRadius) gathered += 1;
      nearestGem = Math.min(nearestGem, away);
    }
    let nearestPickup = Infinity;
    for (const pickup of pickups) {
      nearestPickup = Math.min(
        nearestPickup,
        Math.hypot(px - pickup.x, py - pickup.y),
      );
    }

    // Walking the edge of the crowd is the game: the score wants the nearest
    // enemy held at arm's length rather than shaken off, the next slash put
    // through as much of it as possible, and the gems the last ones left swept
    // up on the way — with a hard penalty on the one thing that ends the run.
    const contact =
      clearance < 0 ? clearance * 25 : Math.min(clearance, 30) * 2;
    const hover =
      nearestEnemy === Infinity ? 0 : -Math.abs(nearestEnemy - HOVER) * 0.6;
    const gemPull =
      gathered * 30 +
      (nearestGem === Infinity ? 0 : -Math.min(nearestGem, 700) * 0.05);
    const pickupPull =
      nearestPickup === Infinity ? 0 : -Math.min(nearestPickup, 700) * 0.12;
    const score =
      contact +
      hover +
      gemPull +
      pickupPull +
      slashValue(s, heading, live) * 45 +
      // The standing lineup: how much of the crowd this heading would have in
      // Taper's rectangle at the end of the lookahead whether or not the next
      // slash lands there. Walking the crowd into line is what makes the slash
      // after the next one worth anything.
      slashValue(s, heading, live, LOOKAHEAD) * 14;

    if (score > bestScore) {
      bestScore = score;
      best = heading;
    }
  }
  return best;
}

/* -------------------------------------------------------------------------- */
/* Taking a level-up                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The order this player takes offers in, best first.
 *
 * A tool that keeps drawing something is what a clip of a survival game is
 * made of, so the tools that hold an effect on screen — lanterns riding their
 * orbit, an aura the crowd walks into, bolts and darts crossing the field —
 * come before the ones that flash once, and every tool comes before a trinket
 * that only moves a number. An offer this list does not name is taken last,
 * and where several are offered the highest-ranked is the one the highlight
 * walks to.
 */
const OFFER_RANK: readonly OfferId[] = [
  "lantern",
  "halo",
  "ember",
  "shard",
  "pin",
  "spark",
  "oil-splash",
  "taper",
  "sconce",
  "flare",
  // A trinket only moves a number, so it comes after every tool; the two that
  // keep a lamplighter alive long enough to be worth filming come first of
  // them.
  "bellows",
  "tallow",
  "wick",
  "oil",
  "glass",
  "lure",
  "soot",
  "tinder",
  "brass",
  "mirror",
];

/** Which of the listed offers this player walks the highlight to. */
function chooseOffer(offers: readonly OfferId[]): number {
  let best = 0;
  let bestRank = Infinity;
  for (let at = 0; at < offers.length; at += 1) {
    const rank = OFFER_RANK.indexOf(offers[at]);
    const placed = rank === -1 ? OFFER_RANK.length : rank;
    if (placed < bestRank) {
      bestRank = placed;
      best = at;
    }
  }
  return best;
}

/* -------------------------------------------------------------------------- */
/* The take                                                                   */
/* -------------------------------------------------------------------------- */

/** What a take left behind, and what the judge reads it by. */
interface Take {
  frames: number;
  seed: number;
  /** Where the recorded stretch opened, in run-clock seconds. */
  from: number;
  /** Kills, level-ups and chests taken INSIDE the recorded stretch. */
  kills: number;
  levelUps: number;
  chests: number;
  level: number;
  tools: number;
  trinkets: number;
  peakCrowd: number;
  hp: number;
  died: boolean;
  endedOnBeat: boolean;
}

/** One played stretch of the night, driven entirely through the keyboard. */
class Session {
  private spent = 0;
  private levelUps = 0;
  private chests = 0;
  private peakCrowd = 0;
  private died = false;
  private endedOnBeat = false;
  /** Whether the frames now running are the ones being kept. */
  private keeping = false;
  /** The seed this night was laid with, for the record. */
  private seed = 0;
  /** What the best crowd still so far was worth; see {@link Session.offerCrowd}. */
  private crowdWorth = -1;
  /** What the best overlay still so far was worth. */
  private overlayWorth = -1;
  private readonly held = new Set<string>();

  constructor(
    private readonly h: Harness,
    /** What this take's stills are written under, or `null` outside a capture. */
    private readonly stills: string | null,
  ) {}

  /** Bring the keys that are down into line with `want`, as a player's hands do. */
  private setKeys(want: readonly string[]): void {
    for (const code of this.held) {
      if (!want.includes(code)) {
        this.h.releaseKey(code);
        this.held.delete(code);
      }
    }
    for (const code of want) {
      if (!this.held.has(code)) {
        this.h.holdKey(code);
        this.held.add(code);
      }
    }
  }

  /**
   * Advance `n` frames of the take's own clock.
   *
   * Frames are counted against the clip's bounds only once the recorder is
   * running: the lead-in below is the same night played the same way, and it
   * is simply not the part being kept.
   */
  private async run(n: number): Promise<void> {
    for (let frame = 0; frame < n; frame += 1) {
      await this.h.advance(1);
      if (this.keeping) this.spent += 1;
    }
  }

  /** Strike a key, and the frame that delivers its edge. */
  private async press(code: string): Promise<void> {
    this.h.holdKey(code);
    try {
      await this.h.advance(1);
    } finally {
      this.h.releaseKey(code);
    }
    if (this.keeping) this.spent += 1;
  }

  /**
   * Keep this frame as the take's crowd still if it beats the one held.
   *
   * What is ranked is what a visitor reads off the picture: how much of the
   * night is on screen at once, then how many of the lamplighter's tools are
   * drawing something, then the gems in flight. Each new high overwrites the
   * last, so what survives is the most crowded the night ever was.
   */
  private offerCrowd(s: WickSnapshot): void {
    if (!this.keeping) return;
    const player = s.run.player;
    let crowd = 0;
    let close = 0;
    for (const enemy of s.run.enemies) {
      if (!onScreen(player, enemy)) continue;
      crowd += 1;
      if (Math.hypot(enemy.x - player.x, enemy.y - player.y) <= CLOSE_IN) {
        close += 1;
      }
    }
    this.peakCrowd = Math.max(this.peakCrowd, crowd);
    if (this.stills === null || close < 4) return;
    const effects = s.run.projectiles.length + s.run.zones.length;
    const worth = close * 1_000 + crowd * 40 + effects * 30 + s.run.gems.length;
    if (worth <= this.crowdWorth) return;
    this.crowdWorth = worth;
    captureStill(this.h, `${this.stills}-crowd`);
  }

  /**
   * Keep this level-up overlay as the take's overlay still if it beats the one
   * held: the later the level-up, the more the HUD behind it has on it.
   */
  private offerOverlay(s: WickSnapshot): void {
    if (!this.keeping || this.stills === null) return;
    const worth = s.run.level * 100 + s.run.weapons.length * 10 + s.run.kills;
    if (worth <= this.overlayWorth) return;
    this.overlayWorth = worth;
    captureStill(this.h, `${this.stills}-levelup`);
  }

  /** Work a level-up overlay: read it, walk the highlight down, take the offer. */
  private async takeLevelUp(): Promise<void> {
    this.setKeys([]);
    await this.run(OVERLAY_READ);
    const overlay = this.h.snapshot();
    const wanted = chooseOffer(overlay.run.offers);
    for (let at = 0; at < wanted; at += 1) {
      await this.press(DOWN_KEY);
      await this.run(OVERLAY_STEP);
    }
    // With the highlight standing on the offer that is about to be taken.
    this.offerOverlay(overlay);
    await this.press(CONFIRM_KEY);
    if (this.keeping) this.levelUps += 1;
  }

  /** Work a chest overlay: read what it opened into, then close it. */
  private async takeChest(): Promise<void> {
    this.setKeys([]);
    await this.run(OVERLAY_READ * 2);
    await this.press(CONFIRM_KEY);
    if (this.keeping) this.chests += 1;
  }

  /**
   * Light the lamp: `reset` to the seed, a beat on the title, and the confirm
   * that takes `LIGHT THE LAMP`.
   *
   * Choosing the seed is choosing the night; nothing else in this class
   * touches the surface but `snapshot()`.
   */
  async open(seed: number): Promise<void> {
    this.seed = seed;
    this.h.reset(seed);
    await this.run(TITLE_HOLD);
    // Entry 0 of the title menu is LIGHT THE LAMP (`specs/ui.md`), highlighted
    // on entry, so one confirm lights it.
    await this.press(CONFIRM_KEY);
  }

  /**
   * Play on, unrecorded, until the run clock reaches `until` seconds.
   *
   * The clip is a stretch of a night rather than the first half-minute of one,
   * and the only honest way to open the clip on a lamplighter carrying six
   * tools into a crowd is to have played the night up to that point. This is
   * that play: the same steering, the same offers, the same keyboard, with the
   * recorder not yet running. It stops early if the run ends.
   */
  async lead(until: number): Promise<void> {
    while (this.h.snapshot().run.time < until) {
      if (!(await this.step())) return;
    }
  }

  /** Play the stretch that is kept, and report what it produced. */
  async record(): Promise<Take> {
    const opened = this.h.snapshot();
    this.keeping = true;

    let lastKills = opened.run.kills;
    let endAt: number | null = null;
    while (this.spent < MAX_FRAMES) {
      const s = this.h.snapshot();
      if (s.screen === "playing" && s.run.kills > lastKills) {
        lastKills = s.run.kills;
        if (endAt === null && this.spent >= MIN_FRAMES) {
          // The settled beat: the crowd thins by one, its gem is drawn in, and
          // the night is watched a moment longer before the clip stops.
          endAt = this.spent + SETTLE;
          this.endedOnBeat = true;
        }
      }
      if (endAt !== null && this.spent >= endAt) break;
      if (!(await this.step())) break;
    }

    this.setKeys([]);
    const ended = this.h.snapshot();
    return {
      frames: this.spent,
      seed: this.seed,
      from: opened.run.time,
      kills: ended.run.kills - opened.run.kills,
      levelUps: this.levelUps,
      chests: this.chests,
      level: ended.run.level,
      tools: ended.run.weapons.length,
      trinkets: ended.run.passives.length,
      peakCrowd: this.peakCrowd,
      hp: ended.run.player.hp,
      died: this.died,
      endedOnBeat: this.endedOnBeat,
    };
  }

  /**
   * One decision of the night: work whatever screen is up, or walk on.
   *
   * Answers whether the night is still going, so both the lead-in and the
   * recorded stretch stop the moment the run ends.
   */
  private async step(): Promise<boolean> {
    const s = this.h.snapshot();
    if (s.screen === "fallen" || s.screen === "dawn") {
      this.died = s.screen === "fallen";
      return false;
    }
    if (s.screen === "levelup") {
      await this.takeLevelUp();
      return true;
    }
    if (s.screen === "chest") {
      await this.takeChest();
      return true;
    }
    if (s.screen !== "playing") return false;

    this.offerCrowd(s);
    this.setKeys(steer(s).keys);
    await this.run(DECIDE_EVERY);
    return true;
  }
}

/**
 * A take is judged on what makes a watchable clip of THIS game.
 *
 * Wick is a crowd closing in and a lamp that answers it on its own, so the
 * judge asks for both in one take: enemies on screen at once, kills taken out
 * of them, and the level-ups that put a second and a third tool on the HUD
 * while the night is still going. Everything else is ordinary watchability —
 * surviving the stretch, and a clean ending on the beat a kill gives.
 */
function judge(take: Take): number {
  return (
    take.kills * 1.5 +
    take.peakCrowd * 6 +
    take.levelUps * 18 +
    (take.levelUps >= 1 ? 20 : 0) +
    // Two overlays inside half a minute is the progression loop shown whole:
    // the bar filling, the choice, and the tool it puts on the HUD, twice.
    (take.levelUps >= 2 ? 30 : 0) +
    take.tools * 10 +
    take.trinkets * 4 +
    take.chests * 20 +
    (take.endedOnBeat ? 25 : -25) +
    (take.died ? -200 : 0)
  );
}

it("records night clips", async () => {
  // EVERY TAKE IS RECORDED, AND THE BEST ONE IS KEPT, so the take that was
  // judged is the take that was committed. Each take also gets its own engine:
  // a night replayed over a world that has already run inherits its frame
  // counter, the input edges the last take left armed, and whatever the last
  // render left on the canvas.
  const takes = Number(process.env.TCAB_SHOWCASE_TAKES ?? "8");
  const firstSeed = Number(process.env.TCAB_SHOWCASE_FIRST_SEED ?? "1");

  const runTake = async (label: string, seed: number): Promise<Take> => {
    const h = await createHarness();
    try {
      await h.advance(1);
      const session = new Session(h, label);
      await session.open(seed);
      await session.lead(LEAD_SECONDS);
      return await captureReplay(h, label, () => session.record());
    } finally {
      h.dispose();
    }
  };

  let best: { label: string; score: number } | null = null;
  for (let take = 0; take < takes; take += 1) {
    const seed = firstSeed + take;
    const label = `take-${String(seed).padStart(2, "0")}`;
    const played = await runTake(label, seed);
    const score = judge(played);
    console.log(
      `${label}: seed ${played.seed}, from ${played.from.toFixed(0)}s, ` +
        `${played.kills} killed, ${played.levelUps} level-ups to level ` +
        `${played.level}, ${played.chests} chests, ` +
        `${played.tools} tools and ${played.trinkets} trinkets, ` +
        `crowd peaked at ${played.peakCrowd}, ` +
        `${played.hp.toFixed(0)} hp, ` +
        `${(played.frames / TICK_HZ).toFixed(1)}s, ` +
        `${played.died ? "fell" : played.endedOnBeat ? "clean end" : "ran out"}` +
        ` -> ${score.toFixed(0)}`,
    );
    if (best === null || score > best.score) best = { label, score };
  }

  console.log(
    `best take: ${best!.label} (${best!.score.toFixed(0)}) — commit ` +
      `${best!.label}.json.gz as gameplay.json.gz, ` +
      `${best!.label}-crowd.png as the crowd still, and ` +
      `${best!.label}-levelup.png as the level-up still`,
  );
}, 3_600_000);
