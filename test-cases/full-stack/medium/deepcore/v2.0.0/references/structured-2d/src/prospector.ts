// Deepcore — the prospector: the pawn the one player possesses.
//
// The miner's authoritative figures — its box, its velocity, its fuel and hull,
// the cut it is making — live on the world's `DeepcoreState`, because the drill,
// the physics, the hazards, and the economy all read and write them together and
// the debug surface poses them (specs/instrumentation.md). What the pawn adds is
// the world's own object model: it is the thing in the world the player drives,
// it carries the miner's held intent from the controller into the frame, its
// transform tracks the box the simulation settled on, and it draws itself.
//
// The pawn holds no authoritative state of its own. `drive` records the frame's
// held actions and its tick hands them to the state before the game mode's tick
// runs the movement they ask for, which is the order the engine fixes:
// controllers, then actors, then the mode (engine/frame.md).

import { DrawComponent, Pawn } from "@test-cabinet/structured-2d";
import type { DrawApi } from "@test-cabinet/structured-2d";
import { cameraCorner } from "./camera";
import { deepcoreState } from "./game";
import type { DeepcoreState, MoveInput } from "./game";
import { LAYER } from "./layers";
import { closeView, openView, renderMiner, showsMine } from "./render";

/** The miner's own layer: the produced cycle for the state it is in. */
class MinerLayer extends DrawComponent {
  constructor() {
    super();
    this.layer = LAYER.miner;
  }

  draw(api: DrawApi): void {
    const state = deepcoreState(this.world);
    if (!showsMine(state)) return;
    openView(api.ctx, state, cameraCorner(this.world));
    renderMiner(api.ctx, state);
    closeView(api.ctx);
  }
}

/** No actions held, which is what a pawn holds before its controller ticks. */
function idleIntent(): MoveInput {
  return { left: false, right: false, down: false, thrust: false };
}

export class Prospector extends Pawn {
  private intent: MoveInput = idleIntent();

  constructor() {
    super();
    this.attach(new MinerLayer());
  }

  /** The whole interface the controller drives the miner through. */
  drive(input: MoveInput): void {
    this.intent = { ...input };
  }

  override tick(): void {
    const state = deepcoreState(this.world);
    // What the simulation reads for this frame's movement and cut.
    state.input = { ...this.intent };
    this.follow(state);
  }

  /** Put the pawn on the box the simulation settled the miner into. */
  follow(state: DeepcoreState): void {
    this.transform.x = state.miner.x;
    this.transform.y = state.miner.y;
  }
}
