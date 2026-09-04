// Kessler — the actors that populate the field, and the components that draw
// them.
//
// The world's game state (`src/game.ts`) is the one authoritative record of
// the simulation; the actors here draw it and hold nothing of their own
// beyond which record each one shows. Each kind of thing on the field —
// every ball, the deflector, every derelict target, every falling pod —
// carries its tag from `TAGS`, so a lookup by the build's fixed vocabulary
// finds it, and `reconcileActors` keeps the actor population mirroring the
// state after every frame's ticks: a record that appeared gains an actor, a
// record that resolved away loses one, wherever the change came from — play,
// or a debug pose.
//
// Rendering goes through the engine's pipeline: every picture below is a
// render component collected and ordered by layer (`src/theme.ts` numbers
// them), and each `draw` is a pure read of the live state at the frame being
// drawn, so a pose made between frames is on screen the next frame.

import {
  Actor,
  DrawComponent,
  Pawn,
  type DrawApi,
  type World,
} from "@test-cabinet/structured-2d";
import { kesslerAssets } from "./assets";
import { RINGS, TAGS } from "./constants";
import { FxLayer } from "./fx";
import { kesslerState } from "./state";
import { pointAt } from "./polar";
import {
  drawBackdrop,
  drawBall,
  drawDeflector,
  drawPlanetAndShield,
  drawPod,
  drawTarget,
} from "./render";
import { drawScreenChrome } from "./screens";
import type { Ball, Pod } from "./session";
import { LAYERS } from "./theme";

// --- The scenery ----------------------------------------------------------

/** The stage ground, the starfield, the containment field, and the lanes. */
class BackdropLayer extends DrawComponent {
  constructor() {
    super();
    this.layer = LAYERS.field;
  }

  draw(api: DrawApi): void {
    drawBackdrop(api.ctx, kesslerState(this.world));
  }
}

/** The produced planet sprite, with the shield ring over it while active. */
class PlanetLayer extends DrawComponent {
  constructor() {
    super();
    this.layer = LAYERS.planet;
  }

  draw(api: DrawApi): void {
    drawPlanetAndShield(api.ctx, kesslerState(this.world), kesslerAssets());
  }
}

/** The field's fixed scenery. The level declares one, at the stage center. */
export class FieldActor extends Actor {
  constructor() {
    super();
    this.attach(new BackdropLayer());
    this.attach(new PlanetLayer());
  }
}

// --- The deflector --------------------------------------------------------

/** The deflector's picture: the track, the body, and the aiming notch. */
class DeflectorLayer extends DrawComponent {
  constructor() {
    super();
    this.layer = LAYERS.paddle;
  }

  draw(api: DrawApi): void {
    drawDeflector(api.ctx, kesslerState(this.world));
  }
}

/**
 * The deflector, the one pawn: the player controller possesses it, and the
 * simulation's step 1 is what moves it, so its tick only mirrors the state's
 * angle onto its transform.
 */
export class PaddlePawn extends Pawn {
  constructor() {
    super();
    this.addTag(TAGS.paddle);
    this.attach(new DeflectorLayer());
  }

  override tick(): void {
    const state = kesslerState(this.world);
    const at = pointAt(178, state.paddleAngleDeg);
    this.transform.x = at.x;
    this.transform.y = at.y;
    this.transform.rotation = (state.paddleAngleDeg * Math.PI) / 180;
  }
}

// --- The populated field --------------------------------------------------

/** One derelict target's plating. */
class TargetLayer extends DrawComponent {
  constructor(
    private readonly ringIndex: number,
    private readonly slot: number,
  ) {
    super();
    this.layer = LAYERS.rings;
  }

  draw(api: DrawApi): void {
    drawTarget(api.ctx, kesslerState(this.world), this.ringIndex, this.slot);
  }
}

/** One derelict target: slot `slot` of ring `ringIndex` (0-based). */
export class TargetActor extends Actor {
  ringIndex = 0;
  slot = 0;

  /** Attach the picture once the slot is configured. */
  place(ringIndex: number, slot: number): void {
    this.ringIndex = ringIndex;
    this.slot = slot;
    this.attach(new TargetLayer(ringIndex, slot));
  }
}

/** One ball's spinning sprite. */
class BallLayer extends DrawComponent {
  constructor(private readonly owner: BallActor) {
    super();
    this.layer = LAYERS.balls;
  }

  draw(api: DrawApi): void {
    const state = kesslerState(this.world);
    if (!state.balls.includes(this.owner.ball)) return;
    drawBall(api.ctx, this.owner.ball, state, kesslerAssets());
  }
}

/** One live ball, following its record in the state's `balls`. */
export class BallActor extends Actor {
  ball!: Ball;

  constructor() {
    super();
    this.attach(new BallLayer(this));
  }

  override tick(): void {
    this.transform.x = this.ball.x;
    this.transform.y = this.ball.y;
  }
}

/** One falling pod's sprite. */
class PodLayer extends DrawComponent {
  constructor(private readonly owner: PodActor) {
    super();
    this.layer = LAYERS.pods;
  }

  draw(api: DrawApi): void {
    const state = kesslerState(this.world);
    if (!state.pods.includes(this.owner.pod)) return;
    drawPod(api.ctx, this.owner.pod, kesslerAssets());
  }
}

/** One falling salvage pod, following its record in the state's `pods`. */
export class PodActor extends Actor {
  pod!: Pod;

  constructor() {
    super();
    this.attach(new PodLayer(this));
  }

  override tick(): void {
    const at = pointAt(this.pod.r, this.pod.angleDeg);
    this.transform.x = at.x;
    this.transform.y = at.y;
  }
}

// --- The effects and the chrome -------------------------------------------

/** The live particle effects, composited in their place in the layer order. */
export class FxActor extends Actor {
  readonly fx: FxLayer;

  constructor() {
    super();
    this.fx = this.attach(new FxLayer());
  }
}

/** The open world's effects layer. */
export function fxOf(world: World): FxLayer {
  const actor = world.find(FxActor);
  if (actor === null) {
    throw new Error("Kessler: the effects actor is missing from the world");
  }
  return actor.fx;
}

/** The HUD and the screen chrome, over everything. */
class HudLayer extends DrawComponent {
  constructor() {
    super();
    this.layer = LAYERS.hud;
  }

  draw(api: DrawApi): void {
    drawScreenChrome(api.ctx, kesslerState(this.world), kesslerAssets());
  }
}

/** The chrome actor. The level declares one. */
export class HudActor extends Actor {
  constructor() {
    super();
    this.attach(new HudLayer());
  }
}

// --- Keeping the population honest ----------------------------------------

/**
 * Make the actor population mirror the state: one tagged actor per live
 * target, ball, and pod, spawned for a record that appeared and destroyed for
 * one that is gone. Run from the game mode after each frame's ticks, so the
 * frame's picture and every tag query describe the state the frame settled
 * on.
 */
export function reconcileActors(world: World, state: KesslerStateLike): void {
  // Targets, keyed by (ring, slot).
  const targetActors = world.ofType(TargetActor);
  const wanted = new Set<string>();
  for (let ring = 0; ring < RINGS.length; ring += 1) {
    const targets = state.rings[ring]?.targets ?? [];
    targets.forEach((hp, slot) => {
      if (hp !== null) wanted.add(`${ring}:${slot}`);
    });
  }
  for (const actor of targetActors) {
    const key = `${actor.ringIndex}:${actor.slot}`;
    if (wanted.has(key)) wanted.delete(key);
    else actor.destroy();
  }
  for (const key of wanted) {
    const [ring, slot] = key.split(":").map(Number);
    world.spawn(TargetActor, {
      tags: [TAGS.target],
      configure: (actor) => actor.place(ring, slot),
    });
  }

  // Balls and pods, keyed by record identity.
  const ballRecords = new Set(state.balls);
  for (const actor of world.ofType(BallActor)) {
    if (ballRecords.has(actor.ball)) ballRecords.delete(actor.ball);
    else actor.destroy();
  }
  for (const ball of ballRecords) {
    world.spawn(BallActor, {
      transform: { x: ball.x, y: ball.y },
      tags: [TAGS.ball],
      configure: (actor) => {
        actor.ball = ball;
      },
    });
  }

  const podRecords = new Set(state.pods);
  for (const actor of world.ofType(PodActor)) {
    if (podRecords.has(actor.pod)) podRecords.delete(actor.pod);
    else actor.destroy();
  }
  for (const pod of podRecords) {
    const at = pointAt(pod.r, pod.angleDeg);
    world.spawn(PodActor, {
      transform: { x: at.x, y: at.y },
      tags: [TAGS.pod],
      configure: (actor) => {
        actor.pod = pod;
      },
    });
  }
}

/** The slice of the game state the reconciler reads. */
interface KesslerStateLike {
  rings: { targets: (number | null)[] }[];
  balls: Ball[];
  pods: Pod[];
}
