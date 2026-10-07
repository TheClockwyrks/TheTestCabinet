// Floe — the screens in front of the player, drawn in code.
//
// `specs/ui.md` fixes the six screens, what each shows, and that the highlighted
// menu item is drawn distinctly; the cards, the type and the copy of the how-to
// lines are the build's. Every screen but `playing` lays a veil and a card over
// the strait, so the strait shows as a dim slice behind it.
//
// This is one `DrawComponent` on the topmost layer, reading the live state at the
// draw and writing nothing.

import { Actor, DrawComponent, type DrawApi } from "@clockwyrks/structured-2d";
import {
  STAGE_H,
  STAGE_W,
  STRAIT_TOP,
  TAGLINE_TEXT,
  TITLE_TEXT,
  TOTAL_LEVELS,
} from "./constants";
import { floeState, type Screen } from "./game";
import { menuBaseline, menuLayout } from "./menus";
import { COLOR, LAYER, MONO_FONT, UI_FONT } from "./theme";

/** What the how-to screen covers (specs/ui.md). */
const HOWTO_LINES: readonly string[] = [
  "FILL ALL FIVE BAYS IN THE FAR SHORE TO CLEAR A LEVEL",
  "ARROW KEYS OR WASD HOP THE CRITTER ONE TILE AT A TIME",
  "A POLAR BEAR HUNTS YOU ACROSS THE WHOLE STRAIT",
  "PLOWS, DOGSLEDS AND CARS SLIDE ALONG THE ICE BAND",
  "FLOES DRIFT ALONG THE WATER BAND - RIDE THEM ACROSS",
  "EACH CROSSING IS UNDER A TIMER, SO KEEP MOVING",
];

class ScreensArt extends DrawComponent {
  draw(api: DrawApi): void {
    const state = floeState(this.world);
    const { ctx } = api;
    if (state.screen === "playing") return;

    this.veil(ctx);
    switch (state.screen) {
      case "title":
        this.card(ctx, 340, 150, 600, 400);
        this.line(ctx, TITLE_TEXT, 268, 104, COLOR.text);
        this.line(ctx, TAGLINE_TEXT, 316, 26, COLOR.textDim);
        this.menu(ctx, "title", state.menuIndex);
        return;
      case "howto":
        this.card(ctx, 180, 130, 920, 490);
        this.line(ctx, "HOW TO PLAY", 196, 46, COLOR.text);
        HOWTO_LINES.forEach((text, index) => {
          this.line(ctx, text, 260 + index * 44, 22, COLOR.textDim);
        });
        this.line(
          ctx,
          "PRESS ENTER OR ESCAPE TO GO BACK",
          592,
          20,
          COLOR.highlight,
        );
        return;
      case "paused":
        this.card(ctx, 420, 220, 440, 280);
        this.line(ctx, "PAUSED", 288, 46, COLOR.text);
        this.menu(ctx, "paused", state.menuIndex);
        return;
      case "victory":
        this.card(ctx, 360, 170, 560, 380);
        this.line(ctx, "THE FAR SHORE", 234, 46, COLOR.highlight);
        this.line(ctx, `SCORE ${state.score}`, 292, 28, COLOR.text, MONO_FONT);
        this.line(
          ctx,
          `LEVELS CLEARED ${TOTAL_LEVELS}`,
          330,
          24,
          COLOR.textDim,
          MONO_FONT,
        );
        this.line(
          ctx,
          `LIVES REMAINING ${state.lives}`,
          366,
          24,
          COLOR.textDim,
          MONO_FONT,
        );
        this.menu(ctx, "victory", state.menuIndex);
        return;
      case "gameover":
        this.card(ctx, 360, 170, 560, 380);
        this.line(ctx, "THE BEAR GOT YOU", 234, 46, COLOR.text);
        this.line(ctx, `SCORE ${state.score}`, 292, 28, COLOR.text, MONO_FONT);
        this.line(
          ctx,
          `LEVEL REACHED ${state.reachedLevel}`,
          336,
          24,
          COLOR.textDim,
          MONO_FONT,
        );
        this.menu(ctx, "gameover", state.menuIndex);
        return;
    }
  }

  /** Dim the strait behind a screen, so it shows as a slice rather than as play. */
  private veil(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = "rgba(6, 16, 25, 0.74)";
    ctx.fillRect(0, STRAIT_TOP, STAGE_W, STAGE_H - STRAIT_TOP);
  }

  /** A card the screens' text is set on, so every line is legible over the strait. */
  private card(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void {
    ctx.fillStyle = COLOR.panel;
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = COLOR.panelEdge;
    ctx.lineWidth = 3;
    ctx.strokeRect(x, y, width, height);
  }

  /** One centered line. */
  private line(
    ctx: CanvasRenderingContext2D,
    text: string,
    y: number,
    size: number,
    color: string,
    font = UI_FONT,
  ): void {
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.font = `700 ${size}px ${font}`;
    ctx.fillStyle = color;
    ctx.fillText(text, STAGE_W / 2, y);
    ctx.textAlign = "left";
  }

  /**
   * A vertical menu, the highlighted item drawn distinctly (specs/ui.md).
   *
   * The baselines come from `src/menus.ts`, which is also what `menuItemRect`
   * reports its regions around, so a pointer aimed at a reported region lands on
   * the entry a player sees there.
   */
  private menu(
    ctx: CanvasRenderingContext2D,
    screen: Screen,
    selected: number,
  ): void {
    const layout = menuLayout(screen);
    if (layout === null) return;
    layout.items.forEach((item, index) => {
      const chosen = index === selected;
      this.line(
        ctx,
        chosen ? `> ${item} <` : item,
        menuBaseline(layout, index),
        chosen ? 32 : 26,
        chosen ? COLOR.highlight : COLOR.textDim,
      );
    });
  }
}

/** Whatever screen is in front of the player. */
export class Screens extends Actor {
  constructor() {
    super();
    this.attach(new ScreensArt()).layer = LAYER.screen;
  }
}
