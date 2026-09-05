// Carom — the in-match HUD: the two scores near the top of the field, player
// one's left of center and player two's right of center, and the label naming
// the mode (specs/overview.md). The copy, placement, and type are this build's
// own, from `src/theme.ts`.
//
// The scores are a draw component so they read the player states at the moment
// the frame renders — after the mode's tick has judged the frame's goals — and
// the scoreboard can never show last frame's total. The mode label is a plain
// `TextComponent` refreshed each tick, because `mode` is state a pose can
// change at any moment (specs/instrumentation.md) rather than a figure fixed
// for the life of a world.

import {
  Actor,
  DrawComponent,
  TextComponent,
} from "@clockwyrks/structured-2d";
import type { DrawApi } from "@clockwyrks/structured-2d";
import { drawText, type Ctx } from "./draw";
import { caromState, type Screen } from "./state";
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
function hudVisible(screen: Screen): boolean {
  return screen === "countdown" || screen === "playing" || screen === "paused";
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
    this.label.text = MODE_LABEL[state.mode];
    this.label.visible = hudVisible(state.screen);
  }
}

class Scores extends DrawComponent {
  draw(api: DrawApi): void {
    const state = caromState(this.actor.world);
    if (!hudVisible(state.screen)) return;

    const ctx = api.ctx as Ctx;
    const [p1, p2] = state.players;
    const opts = {
      size: SCORE_FONT_PX,
      weight: 700,
      color: COLOR.text,
      spacing: 4,
      align: "center" as const,
      baseline: "top" as const,
    };
    drawText(ctx, api.mode, `${p1?.score ?? 0}`, SCORE_P1_X, SCORE_TOP_Y, opts);
    drawText(ctx, api.mode, `${p2?.score ?? 0}`, SCORE_P2_X, SCORE_TOP_Y, opts);
  }
}
