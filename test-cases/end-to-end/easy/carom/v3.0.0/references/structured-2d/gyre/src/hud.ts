// Carom — the in-match HUD: the two scores near the top of the field, player
// one's left of center and player two's right of center, and the label naming
// the mode (specs/ui.md). The copy, placement, and type are this build's own,
// from `src/theme.ts`.
//
// The scores are a draw component so they read the game state at the moment the
// frame renders — after the mode's tick has judged the frame's goals — and the
// scoreboard can never show last frame's total. The mode label is a plain
// `TextComponent` refreshed each tick, because `setMode` poses the mode on a
// match that is already open (specs/instrumentation.md).

import {
  Actor,
  DrawComponent,
  TextComponent,
} from "@test-cabinet/structured-2d";
import type { DrawApi } from "@test-cabinet/structured-2d";
import { drawText, type Ctx } from "./draw";
import { caromState, type CaromState } from "./state";
import {
  COLOR,
  LAYER,
  MODE_LABEL,
  MONO,
  SCORE_FONT_PX,
  SCORE_P1_X,
  SCORE_P2_X,
  SCORE_TOP_Y,
} from "./theme";

/** The screens on which the HUD is part of the picture. */
function hudVisible(state: CaromState): boolean {
  return (
    state.screen === "countdown" ||
    state.screen === "playing" ||
    state.screen === "paused"
  );
}

export class Hud extends Actor {
  private readonly label: TextComponent;

  constructor() {
    super();
    this.attach(new Scores()).layer = LAYER.hud;

    this.label = this.attach(
      new TextComponent({
        text: "",
        font: `18px ${MONO}`,
        fill: COLOR.textFaint,
        align: "left",
        baseline: "top",
      }),
    );
    this.label.layer = LAYER.hud;
    this.label.offset.x = 32;
    this.label.offset.y = 28;
  }

  tick(): void {
    const state = caromState(this.world);
    this.label.text = MODE_LABEL[state.game.mode];
    this.label.visible = hudVisible(state);
  }
}

class Scores extends DrawComponent {
  draw(api: DrawApi): void {
    const state = caromState(this.actor.world);
    if (!hudVisible(state)) return;

    const ctx = api.ctx as Ctx;
    const opts = {
      size: SCORE_FONT_PX,
      weight: 700,
      color: COLOR.text,
      spacing: 4,
      align: "center" as const,
      baseline: "top" as const,
    };
    drawText(ctx, api.mode, `${state.score.p1}`, SCORE_P1_X, SCORE_TOP_Y, opts);
    drawText(ctx, api.mode, `${state.score.p2}`, SCORE_P2_X, SCORE_TOP_Y, opts);
  }
}
