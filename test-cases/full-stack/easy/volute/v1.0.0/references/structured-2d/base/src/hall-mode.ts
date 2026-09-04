// Volute — the rules of the hall (specs/channel.md "The order of a tick",
// specs/progression.md, specs/machinery.md).
//
// The game mode is where Volute's rules live. The engine ticks the controllers
// first, so the frame's input is already on the injector by the time this runs;
// then this one method resolves the whole train in the order the specification
// fixes, because that order is global over the channel and cannot be split
// across actors ticking in spawn order.
//
// The mode reaches the rest of the game through {@link HallPorts}, which it
// implements itself: spawning and destroying the bodies, drawing from the game's
// one seeded generator (which lives on the instance, since it must survive a
// level transition), raising a cue, and playing an effect.

import { GameMode } from "@test-cabinet/structured-2d";
import {
  AIM_START,
  BORE_RADIUS,
  CELLS,
  CLEAR_SCORE,
  DANGER_S,
  FIELD_H,
  FIELD_W,
  FIRE_COOLDOWN,
  INJECTOR_X,
  INJECTOR_Y,
  INTERLUDE,
  LEVELS,
  LEVEL_COUNT,
  MACHINERY_DURATIONS,
  PATH_LENGTH,
  PRESSURE_BLEED,
  PRESSURE_FREE,
  PRESSURE_MAX,
  PRESSURE_MIN,
  PRESSURE_RISE_PER_CORE,
  PROJECTILE_SPEED,
  SCORE_PER_CORE,
  SEEDED_CORES,
  SPACING,
  TAGS,
  CUES,
} from "./constants";
import type { ChargeId, CueName, MachineryKind } from "./constants";
import { Core, Injector, Projectile } from "./actors";
import { INTAKE, pointAt } from "./channel";
import { runBeds, playCue } from "./audio";
import { InjectorController } from "./controller";
import type { FxEvent } from "./fx";
import { Effects } from "./fx";
import type { VoluteGame } from "./game";
import {
  clearChannel,
  clearProjectiles,
  drawEmissionCharge,
  emitCore,
  levelSpec,
  openLevel as openLevelRules,
  openRun as openRunRules,
  type HallPorts,
} from "./level";
import { clamp, normalizeAngle, radians } from "./math";
import { HallState } from "./state";
import {
  advanceTrain,
  effectiveFeed,
  findStrike,
  insertCore,
  removeCores,
  resegment,
  type PendingGrant,
} from "./train";

/**
 * The three kinds that become the active machinery.
 *
 * `bore` is the fourth machinery kind and is not one of these: it "resolves at
 * once" (specs/machinery.md) and so is never granted through the debug surface,
 * which poses preconditions alone (specs/instrumentation.md, `grantMachinery`).
 */
export const TIMED_MACHINERY_KINDS = [
  "choke",
  "backflow",
  "sightline",
] as const;

/** One of the three kinds `grantMachinery` accepts. */
export type TimedMachineryKind = (typeof TIMED_MACHINERY_KINDS)[number];

/** Whether the run is in danger: a head standing at or past the threshold. */
export function inDanger(state: HallState): boolean {
  return state.cores.length > 0 && state.cores[0].s >= DANGER_S;
}

/** The hall's rules, and the screens the run passes through. */
export class HallMode extends GameMode implements HallPorts {
  declare readonly state: HallState;

  gameStateClass = HallState;
  playerControllerClass = InjectorController;
  // The controller drives the injector, which never moves and so is not a pawn.
  pawnClass = null;

  /**
   * The game instance, bound by `VoluteGame.worldOpened` before the world's
   * first frame. It carries the seeded generator, which must survive a level
   * transition (specs/state.md).
   */
  private boundGame: VoluteGame | null = null;

  /** The cues this tick raised, each sounding at most once (specs/ui.md). */
  private readonly raised = new Set<CueName>();

  private cachedInjector: Injector | null = null;
  private cachedEffects: Effects | null = null;

  override beginPlay(): void {
    // One controller, which is the only place an action or the pointer is read
    // (the engine's `input.md`). It possesses nothing: the injector never moves.
    this.addPlayer({ name: "Operator" });
    this.setPhase("playing");
  }

  /** Bind the instance, before any frame of this world runs. */
  bind(game: VoluteGame): void {
    this.boundGame = game;
  }

  /** The game instance this world belongs to. */
  get game(): VoluteGame {
    if (this.boundGame === null) {
      throw new Error("Volute: the world was ticked before it was bound");
    }
    return this.boundGame;
  }

  // ---- The ports the rules reach the world through -----------------------

  spawnCore(
    charge: ChargeId,
    s: number,
    mark: MachineryKind | null,
    hold: number,
  ): Core {
    return this.world.spawn(Core, {
      tags: [TAGS.core],
      configure: (core) => {
        core.setCharge(charge);
        core.setArc(s);
        core.setMark(mark);
        core.hold = hold;
      },
    });
  }

  destroyCore(core: Core): void {
    core.destroy();
  }

  destroyProjectile(projectile: Projectile): void {
    projectile.destroy();
  }

  cue(cue: CueName): void {
    this.raised.add(cue);
  }

  fx(event: FxEvent): void {
    this.effects().spawn(event);
  }

  drawCharge(from: readonly ChargeId[]): ChargeId {
    return this.game.drawCharge(from);
  }

  clearEffects(): void {
    this.effects().clear();
  }

  /** The hall's one injector, found by the tag `src/constants.ts` fixes. */
  injector(): Injector {
    const found = this.cachedInjector;
    if (found !== null && found.alive) return found;
    const actor = this.world.byTag(TAGS.injector)[0];
    if (!(actor instanceof Injector)) {
      throw new Error(`Volute: no injector carries the "${TAGS.injector}" tag`);
    }
    this.cachedInjector = actor;
    return actor;
  }

  /** The layer the sheets and the particle systems play on. */
  effects(): Effects {
    const found = this.cachedEffects;
    if (found !== null && found.alive) return found;
    const actor = this.world.find(Effects);
    if (actor === null)
      throw new Error("Volute: the hall has no effects layer");
    this.cachedEffects = actor;
    return actor;
  }

  // ---- The frame ----------------------------------------------------------

  override tick(dt: number): void {
    const state = this.state;

    switch (state.screen) {
      case "cleared":
      case "setback":
        this.advanceInterlude(dt);
        break;
      case "playing":
        this.playingTick(dt);
        break;
      case "title":
      case "paused":
      case "gameover":
      case "victory":
        break;
    }

    // The beds are driven from the state on every tick, so the change happens
    // on the tick the danger condition changes (specs/ui.md).
    runBeds(this.world, state.screen === "playing", inDanger(state));
    this.flushCues();
  }

  /** Sound every cue this tick raised, each exactly once. */
  private flushCues(): void {
    for (const cue of this.raised) playCue(this.world, cue);
    this.raised.clear();
  }

  /** The interlude's own timer, and nothing else, then the level that follows. */
  private advanceInterlude(dt: number): void {
    const state = this.state;
    if (dt <= 0) return;
    state.interlude = Math.max(0, state.interlude - dt);
    if (state.interlude > 0) return;
    const next = state.screen === "cleared" ? state.level + 1 : state.level;
    openLevelRules(state, this, next);
  }

  /** Everything: the train, the projectiles, pressure, every timer, the inlet. */
  private playingTick(dt: number): void {
    const state = this.state;
    if (dt <= 0) return;

    // 1. Every running timer falls by the tick's elapsed time.
    this.runTimers(dt);

    // 2. Every segment advances, and a merge that completes a run extracts it.
    // The step is skipped entirely while the train's gate is held: "no segment
    // advances, no merge follows from an advance, and an active `backflow` moves
    // nothing" (specs/instrumentation.md, `setFeed`).
    const grants: PendingGrant[] = [];
    if (this.game.feed) advanceTrain(state, this, dt, grants);

    // 3. Every projectile advances, oldest first, and a strike seats.
    this.advanceProjectiles(dt, grants);

    // 4. Every removal grants the machinery its marked cores carry.
    for (const grant of grants) this.applyGrant(grant);

    // 5. Pressure rises or bleeds.
    this.runPressure(dt);

    // 6. A core at the intake spends a cell; else an emptied level is cleared.
    if (this.spendCell()) return;
    if (state.quotaRemaining <= 0 && state.cores.length === 0) {
      this.clearLevel();
      return;
    }

    // 7. The inlet emits.
    this.runInlet();
  }

  /** Step 1: every running timer falls by the tick's elapsed time. */
  private runTimers(dt: number): void {
    const state = this.state;
    const injector = this.injector();
    injector.cooldown = Math.max(0, injector.cooldown - dt);

    if (state.chainTimer > 0) {
      state.chainTimer = Math.max(0, state.chainTimer - dt);
      if (state.chainTimer === 0) state.chainStep = 1;
    }

    for (const core of state.cores) core.hold = Math.max(0, core.hold - dt);
    resegment(state);

    const machinery = state.machinery;
    if (machinery !== null) {
      machinery.remaining -= dt;
      if (machinery.remaining <= 0) state.machinery = null;
    }
  }

  /** Step 3: every projectile advances along its heading, oldest first. */
  private advanceProjectiles(dt: number, grants: PendingGrant[]): void {
    const state = this.state;
    if (state.projectiles.length === 0) return;
    const step = PROJECTILE_SPEED * dt;
    const surviving: Projectile[] = [];

    for (const projectile of state.projectiles) {
      const heading = radians(projectile.angle);
      projectile.transform.x += Math.cos(heading) * step;
      projectile.transform.y += Math.sin(heading) * step;

      // A projectile whose center leaves the field is discarded on that tick,
      // changing nothing about the train.
      if (
        projectile.transform.x < 0 ||
        projectile.transform.x > FIELD_W ||
        projectile.transform.y < 0 ||
        projectile.transform.y > FIELD_H
      ) {
        projectile.destroy();
        continue;
      }

      const strike = findStrike(state.cores, projectile.transform);
      if (strike === null) {
        surviving.push(projectile);
        continue;
      }
      this.cue(CUES.seat);
      insertCore(state, this, strike, projectile.charge, grants);
      projectile.destroy();
    }

    state.projectiles = surviving;
  }

  /** Step 4: a grant, resolved against the positions the removal left. */
  private applyGrant(grant: PendingGrant): void {
    this.cue(CUES.machinery);
    if (grant.kind === "bore") {
      this.detonate(grant.x, grant.y);
      return;
    }
    this.state.machinery = {
      kind: grant.kind,
      remaining: MACHINERY_DURATIONS[grant.kind],
    };
  }

  /**
   * A bore: every core whose center lies within `BORE_RADIUS` of the extraction
   * point is removed together and scored, at the chain step already in force.
   *
   * The chain step and the window that resets it are both left alone, so a bore
   * pays at the step the chain stands at and carries the chain no further.
   */
  detonate(x: number, y: number): void {
    const state = this.state;
    this.fx({ kind: "bore", x, y });
    const caught: number[] = [];
    for (let i = 0; i < state.cores.length; i += 1) {
      const point = pointAt(state.cores[i].s);
      if (Math.hypot(point.x - x, point.y - y) <= BORE_RADIUS) caught.push(i);
    }
    if (caught.length === 0) return;
    state.score += SCORE_PER_CORE * caught.length * state.chainStep;
    removeCores(state, this, caught, null);
  }

  /** Step 5: pressure rises with a crowded channel, bleeds off an uncrowded one. */
  private runPressure(dt: number): void {
    const state = this.state;
    const count = state.cores.length;
    const rise = Math.max(0, count - PRESSURE_FREE) * PRESSURE_RISE_PER_CORE;
    const bleed = count <= PRESSURE_FREE ? PRESSURE_BLEED : 0;
    state.pressure = clamp(
      state.pressure + (rise - bleed) * dt,
      PRESSURE_MIN,
      PRESSURE_MAX,
    );
  }

  /**
   * Step 6, first half: a core standing at the intake spends a cell.
   *
   * A tick spends one cell at most. The spend sets the run back to what a level
   * start leaves it and, when it takes the count to `0`, ends the run in place
   * of restarting the level.
   */
  private spendCell(): boolean {
    const state = this.state;
    if (!state.cores.some((core) => core.s >= PATH_LENGTH)) return false;

    this.cue(CUES.intake);
    this.cue(CUES.cellLost);
    this.fx({ kind: "intake", x: INTAKE.x, y: INTAKE.y });

    state.cells = Math.max(0, state.cells - 1);
    clearChannel(state, this);
    clearProjectiles(state, this);
    state.pressure = 0;
    state.machinery = null;
    state.chainStep = 1;
    state.chainTimer = 0;
    state.quotaRemaining = levelSpec(state.level).quota - SEEDED_CORES;

    if (state.cells === 0) {
      state.screen = "gameover";
      state.interlude = 0;
    } else {
      state.screen = "setback";
      state.interlude = INTERLUDE;
    }
    return true;
  }

  /** Step 6, second half: an exhausted quota over an empty channel clears. */
  private clearLevel(): void {
    const state = this.state;
    state.score += CLEAR_SCORE;
    this.cue(CUES.levelClear);
    if (state.level >= LEVEL_COUNT) {
      state.screen = "victory";
      state.interlude = 0;
      return;
    }
    state.screen = "cleared";
    state.interlude = INTERLUDE;
  }

  /**
   * Step 7: the inlet emits.
   *
   * One core at most per tick, only while the quota holds, only once the tail
   * has cleared one spacing, and never while backflow packs the train against
   * the inlet.
   */
  private runInlet(): void {
    const state = this.state;
    // The inlet's gate is independent of the quota (specs/instrumentation.md,
    // `setEmission`), so a held inlet emits nothing whatever the quota holds.
    if (!this.game.emission) return;
    if (state.quotaRemaining <= 0) return;
    if (state.machinery?.kind === "backflow") return;
    const tail = state.cores[state.cores.length - 1];
    if (tail !== undefined && tail.s < SPACING - 1e-9) return;
    emitCore(state, this);
  }

  // ---- What the controller and the debug surface drive --------------------

  /** Turn the aim to an absolute angle, normalized into `[0, 360)`. */
  aimAt(degrees: number): void {
    this.injector().setAim(normalizeAngle(degrees));
  }

  /**
   * Release the loaded core along the current aim.
   *
   * The queued charge becomes loaded, a fresh charge is drawn as queued, and the
   * cooldown is set. A call made while the injector holds no loaded core draws
   * one first, which is what lets the debug surface's `fire` launch from a bare
   * hall.
   */
  fire(): void {
    const state = this.state;
    const injector = this.injector();
    if (injector.loaded === null) {
      injector.setLoaded(drawEmissionCharge(state, this));
    }
    if (injector.queued === null) {
      injector.queued = drawEmissionCharge(state, this);
    }
    const charge = injector.loaded;
    if (charge === null) return;

    const projectile = this.world.spawn(Projectile, {
      tags: [TAGS.projectile],
      transform: { x: INJECTOR_X, y: INJECTOR_Y },
      configure: (shot) => {
        shot.launch(charge, normalizeAngle(injector.aim));
      },
    });
    state.projectiles.push(projectile);

    injector.setLoaded(injector.queued);
    injector.queued = drawEmissionCharge(state, this);
    injector.cooldown = FIRE_COOLDOWN;
    this.cue(CUES.fire);
    this.fx({ kind: "fire", x: INJECTOR_X, y: INJECTOR_Y });
  }

  /** The fire control: honored when the cooldown has expired, refused when not. */
  requestFire(): void {
    if (this.injector().cooldown > 0) {
      this.cue(CUES.denied);
      return;
    }
    this.fire();
  }

  /** The swap control: exchange the loaded and queued charges. */
  requestSwap(): void {
    const injector = this.injector();
    const loaded = injector.loaded;
    injector.setLoaded(injector.queued);
    injector.queued = loaded;
    this.cue(CUES.swap);
  }

  /**
   * Grant one of the three TIMED kinds, exactly as extracting a run holding its
   * mark grants it (specs/instrumentation.md, `grantMachinery`).
   *
   * `bore` is not granted here: it removes cores and scores the moment it
   * resolves, and no pose decides an outcome, so a bore is reached by extracting
   * a run that carries a `bore` mark.
   */
  grantTimedMachinery(kind: TimedMachineryKind): void {
    this.state.machinery = { kind, remaining: MACHINERY_DURATIONS[kind] };
    this.cue(CUES.machinery);
  }

  /**
   * The confirm control: it starts a run on the title, and dismisses an ending.
   *
   * Both cross a level transition, so both go through the instance, which is
   * what outlives one.
   */
  confirm(): void {
    const screen = this.state.screen;
    if (screen === "title") {
      this.game.startRun();
      return;
    }
    if (screen === "gameover" || screen === "victory") this.game.toTitle();
  }

  /**
   * Put every declared field back to its title-screen value.
   *
   * What a `reset` leaves behind when the title level is already open, and so
   * needs no transition to rebuild.
   */
  resetToTitle(): void {
    const state = this.state;
    state.screen = "title";
    state.score = 0;
    state.level = 1;
    state.cells = CELLS;
    state.quotaRemaining = LEVELS[0].quota;
    state.pressure = 0;
    state.chainStep = 1;
    state.chainTimer = 0;
    state.machinery = null;
    state.interlude = 0;
    clearChannel(state, this);
    clearProjectiles(state, this);
    this.clearEffects();

    const injector = this.injector();
    injector.setAim(AIM_START);
    injector.setLoaded(null);
    injector.queued = null;
    injector.cooldown = 0;
  }

  /** Open a level of the run, exactly as the interlude before it opens it. */
  openLevel(level: number): void {
    openLevelRules(this.state, this, level);
  }

  /** Open a fresh run on level 1, as the start control on the title does. */
  openRun(): void {
    openRunRules(this.state, this);
  }

  /** The effective feed speed the lead segment rides at. */
  feedSpeed(): number {
    return effectiveFeed(this.state);
  }
}
