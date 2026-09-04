// Carom — the paddle: a pawn any controller can drive.
//
// The pawn exposes one interface, `drive(vy)`, and every driver — the player
// controller reading held actions, the AI computing an intercept, and the
// debug driver holding a posed velocity — finishes with that same call. The
// pawn's own tick then integrates the request through the one integrator
// specs/playfield.md fixes, so every mover gets the same speed, the same
// clamp, and the same reported velocity. `vy` afterwards is the paddle's
// ACTUAL vertical velocity for the frame, which is what the spin mechanic
// reads at contact: a paddle pinned against a bound reports zero even while a
// movement action is held into it.
//
// The paddle simulates only on the live screens (`countdown` and `playing`,
// specs/ui.md); on the menus and the pause screen it stands exactly where it
// was. The title level places two unpossessed paddles as furniture, and the
// match mode spawns one per participant through possession.

import { DrawComponent, Pawn } from "@test-cabinet/structured-2d";
import type { DrawApi } from "@test-cabinet/structured-2d";
import { PADDLE_HALF, PADDLE_W } from "./constants";
import { glowRect, type Ctx } from "./draw";
import { integratePaddle, paddleBounds, type Side } from "./sim";
import { isSimulating, screenOf } from "./state";
import { COLOR, FURNITURE_ALPHA, LAYER } from "./theme";

/** The two sides' body colors and halos, from this build's theme. */
const BODY = {
  left: { color: COLOR.p1, glow: "rgba(58, 231, 196, 0.65)" },
  right: { color: COLOR.p2, glow: "rgba(255, 92, 138, 0.65)" },
} as const;

export class Paddle extends Pawn {
  /** Which goal this paddle defends. Set where the paddle is placed. */
  side: Side = "left";

  /**
   * The paddle's actual vertical velocity this frame, in units per second —
   * the clamped, integrated figure `snapshot()` reports and the ball reads at
   * contact.
   */
  vy = 0;

  /** The velocity the current driver asked for, consumed by the next tick. */
  private requested = 0;

  constructor() {
    super();
    this.attach(new PaddleBody()).layer = LAYER.paddles;
  }

  /**
   * Ask for a vertical velocity, in units per second. The whole driving
   * interface: whoever calls this last before the tick owns the frame.
   */
  drive(vy: number): void {
    this.requested = vy;
  }

  tick(dt: number): void {
    const requested = this.requested;
    this.requested = 0;
    if (!isSimulating(this.world)) return;

    const next = integratePaddle({ cy: this.transform.y, vy: requested }, dt);
    this.transform.y = next.cy;
    this.vy = next.vy;
  }
}

/** The rounded, glowing bar, dimmed with the rest of the field on a menu. */
class PaddleBody extends DrawComponent {
  draw(api: DrawApi): void {
    const paddle = this.actor as Paddle;
    const screen = screenOf(paddle.world);
    const ctx = api.ctx as Ctx;
    const { x0 } = paddleBounds(paddle.side);
    const body = BODY[paddle.side];

    ctx.save();
    ctx.globalAlpha = FURNITURE_ALPHA[screen];
    glowRect(
      ctx,
      api.mode,
      x0,
      paddle.transform.y - PADDLE_HALF,
      PADDLE_W,
      PADDLE_HALF * 2,
      8,
      body.color,
      body.glow,
      18,
    );
    ctx.restore();
  }
}
