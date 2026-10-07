// The program screen: the same yard and readouts as the build screen, with the
// tape editor over them (`specs/ui.md`).
//
// The panel is drawn straight onto the screen layer, from the very layout
// `handlePointer` hit-tests (`src/tape.ts`), so what is drawn and what a press
// works are one description and can never disagree. A tape's widgets run into
// the hundreds and change with every edit, which is exactly the picture the
// built-in components cannot state.

import { DrawComponent } from "@clockwyrks/structured-3d";
import type { DrawApi } from "@clockwyrks/structured-3d";
import { STAGE_W } from "../constants";
import { LAYER } from "../layers";
import {
  ACCENT,
  COOL,
  INK,
  INK_DIM,
  INK_FAINT,
  mono,
  PANEL_EDGE,
  PANEL_INSET,
  PANEL_SOLID,
} from "../palette";
import { currentProgram } from "../state";
import { tapeLayout, type Rect, type TapeWidget } from "../tape";
import { GantryView, type ViewFrame } from "../actor-view";
import { HudGroup, MARGIN } from "./kit";
import { HintBar, SITE_STRIP, SiteStrip, StartBlock } from "./pieces";
import type { GantryState } from "../game";

const STRIP_X = STAGE_W - MARGIN - SITE_STRIP.w;
const START_X = STAGE_W - MARGIN - 300;
const START_Y = MARGIN + SITE_STRIP.h + 10;

/** A filled, edged rectangle, drawn the way a `ShapeComponent` panel is. */
function box(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  fill: string,
  stroke: string | null,
): void {
  ctx.fillStyle = fill;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  if (stroke === null) return;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1;
  ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
}

function drawButton(ctx: CanvasRenderingContext2D, widget: TapeWidget): void {
  box(ctx, widget.rect, PANEL_INSET, PANEL_EDGE);
  ctx.font = mono(widget.rect.w > 40 ? 11 : 12, 700);
  ctx.fillStyle = INK_DIM;
  ctx.textAlign = "center";
  ctx.fillText(
    widget.label,
    widget.rect.x + widget.rect.w / 2,
    widget.rect.y + widget.rect.h / 2 + 4,
  );
}

class TapePanel extends DrawComponent {
  draw(api: DrawApi): void {
    const state = this.world.state as GantryState;
    if (state.screen !== "program") return;
    const { ctx } = api;
    const layout = tapeLayout(state);
    const program = currentProgram(state);

    ctx.save();
    ctx.textBaseline = "alphabetic";
    box(ctx, layout.panel, PANEL_SOLID, PANEL_EDGE);

    ctx.textAlign = "left";
    ctx.font = mono(13, 700);
    ctx.fillStyle = INK_DIM;
    ctx.fillText(layout.titleText, layout.title.x, layout.title.y + 15);

    if (layout.clipped > 0) {
      ctx.textAlign = "right";
      ctx.font = mono(12, 700);
      ctx.fillStyle = ACCENT;
      ctx.fillText(
        `${layout.clipped} MORE BELOW`,
        layout.title.x + layout.title.w,
        layout.title.y + 15,
      );
    }

    if (program.length === 0) {
      ctx.textAlign = "center";
      ctx.font = mono(13);
      ctx.fillStyle = INK_FAINT;
      ctx.fillText(
        "the tape is empty — add a step from the bar below",
        layout.list.x + layout.list.w / 2,
        layout.list.y + 40,
      );
    }

    ctx.textAlign = "left";
    for (const row of layout.rows) {
      if (row.kind === "step") {
        box(ctx, { ...row.rect, h: row.rect.h - 2 }, PANEL_INSET, PANEL_EDGE);
      }
      const action = program[row.step]?.kind === "action";
      ctx.font = mono(
        row.kind === "step" ? 12 : 11,
        row.kind === "step" ? 700 : 400,
      );
      ctx.fillStyle = row.kind === "command" ? INK_DIM : action ? COOL : INK;
      ctx.fillText(row.text, row.rect.x + 6, row.rect.y + row.rect.h - 7);
    }

    // The buttons last, so a long line runs under them rather than over them.
    for (const widget of layout.widgets) drawButton(ctx, widget);
    ctx.restore();
  }
}

export class ProgramActor extends GantryView {
  private readonly root = new HudGroup(this);
  private readonly strip: SiteStrip;
  private readonly start: StartBlock;
  private readonly hints: HintBar;

  constructor() {
    super();
    // The tape editor takes the left of the stage, so the site's own strip
    // moves to the right rather than sitting under it.
    this.strip = new SiteStrip(this.root, STRIP_X);
    this.start = new StartBlock(this.root, START_X);
    this.hints = new HintBar(this.root, 2);
    this.hints.set([
      "CLICK A WIDGET TO EDIT THE TAPE   DRAG ORBIT   = − ZOOM",
      "B BUILD   G RUN   ESC BACK   M MUTE",
    ]);
    this.attach(new TapePanel()).layer = LAYER.panel;
  }

  override refresh(frame: ViewFrame): void {
    const state = frame.state;
    this.root.visible = state.screen === "program";
    if (this.root.visible) {
      this.strip.refresh(state);
      this.start.refresh(state, START_Y);
    }
    this.root.apply();
  }
}
