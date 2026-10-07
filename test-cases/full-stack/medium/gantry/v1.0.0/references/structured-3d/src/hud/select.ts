// The six sites: progress, scores, and entry (`specs/ui.md`).
//
// A site's state reads without relying on hue alone, so each row carries a
// drawn mark beside its word — a tick, an arrow, or a cross. The marks are
// strokes rather than glyphs so no font can fail to carry them, which is what
// the one `DrawComponent` here is for.

import { DrawComponent } from "@clockwyrks/structured-3d";
import type {
  DrawApi,
  ShapeComponent,
  TextComponent,
} from "@clockwyrks/structured-3d";
import { STAGE_H } from "../constants";
import { LAYER } from "../layers";
import {
  ACCENT,
  COOL,
  GOOD,
  INK,
  INK_DIM,
  INK_FAINT,
  PANEL,
  PANEL_EDGE,
  PANEL_SOLID,
} from "../palette";
import { cost as costText, seconds, siteRows, type SiteMark } from "../format";
import { GantryView, type ViewFrame } from "../actor-view";
import { siteRowRect } from "../menus";
import { HudGroup, MARGIN } from "./kit";
import type { GantryState } from "../game";

// A row is drawn at the hit region `src/menus.ts` lays out, so it sits exactly
// where a pointer selects it (`specs/ui.md`).
export { siteRowRect } from "../menus";

/** The left edge every row and caption on this screen is aligned to. */
const LEFT = MARGIN + 36;

/** The colour a site's state is spoken in. */
export const stateTone = (state: "locked" | "open" | "cleared"): string =>
  state === "cleared" ? GOOD : state === "open" ? COOL : INK_FAINT;

/**
 * The shape a site's state is marked with, drawn with lines so no font can fail
 * to carry it (`specs/ui.md`: the state reads without relying on hue).
 */
export function drawSiteMark(
  ctx: CanvasRenderingContext2D,
  mark: SiteMark,
  x: number,
  y: number,
  colour: string,
): void {
  const r = 7;
  ctx.strokeStyle = colour;
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  if (mark === "tick") {
    ctx.moveTo(x - r, y);
    ctx.lineTo(x - r / 3, y + r * 0.7);
    ctx.lineTo(x + r, y - r * 0.8);
  } else if (mark === "cross") {
    ctx.moveTo(x - r * 0.7, y - r * 0.7);
    ctx.lineTo(x + r * 0.7, y + r * 0.7);
    ctx.moveTo(x + r * 0.7, y - r * 0.7);
    ctx.lineTo(x - r * 0.7, y + r * 0.7);
  } else {
    ctx.moveTo(x - r * 0.5, y - r * 0.85);
    ctx.lineTo(x + r * 0.75, y);
    ctx.lineTo(x - r * 0.5, y + r * 0.85);
    ctx.closePath();
    ctx.fillStyle = colour;
    ctx.fill();
  }
  ctx.stroke();
}

/** The six state marks, drawn straight onto the screen layer. */
class SiteMarks extends DrawComponent {
  draw(api: DrawApi): void {
    const state = this.world.state as GantryState;
    if (state.screen !== "select") return;
    const { ctx } = api;
    ctx.save();
    for (const row of siteRows(state)) {
      const rect = siteRowRect(row.index);
      drawSiteMark(
        ctx,
        row.mark,
        rect.x + 90,
        rect.y + 49,
        stateTone(row.state),
      );
    }
    ctx.restore();
  }
}

interface RowParts {
  readonly panel: ShapeComponent;
  readonly number: TextComponent;
  readonly name: TextComponent;
  readonly stateText: TextComponent;
  readonly note: HudGroup;
  readonly noteText: TextComponent;
}

export class SelectActor extends GantryView {
  private readonly root = new HudGroup(this);
  private readonly rows: RowParts[];

  constructor() {
    super();
    this.root.write(LEFT, 92, "SITES", { size: 44, face: "display" });
    this.root.write(LEFT, 120, "CLEAR A SITE TO OPEN THE NEXT", {
      size: 13,
      fill: INK_FAINT,
    });

    this.rows = Array.from({ length: 6 }, (_row, i) => {
      const rect = siteRowRect(i);
      const note = this.root.child();
      return {
        panel: this.root.panel(rect),
        number: this.root.write(rect.x + 20, rect.y + 41, "", {
          size: 28,
          face: "display",
        }),
        name: this.root.write(rect.x + 82, rect.y + 33, "", {
          size: 21,
          face: "display",
        }),
        stateText: this.root.write(rect.x + 108, rect.y + 53, "", {
          size: 12,
          weight: 700,
        }),
        note,
        noteText: note.write(rect.x + rect.w - 20, rect.y + 41, "", {
          size: 13,
          fill: INK_DIM,
          align: "right",
        }),
      };
    });

    // The marks are the one component here the group does not switch, because
    // a `DrawComponent` decides for itself: it reads the screen at the draw.
    this.attach(new SiteMarks()).layer = LAYER.text;

    this.root.write(
      LEFT,
      STAGE_H - 34,
      "↑ ↓ CHOOSE      ENTER OPEN SITE      ESC BACK",
      { size: 12, fill: INK_FAINT },
    );
  }

  override refresh(frame: ViewFrame): void {
    this.root.visible = frame.state.screen === "select";
    if (this.root.visible) this.write(frame);
    this.root.apply();
  }

  private write(frame: ViewFrame): void {
    siteRows(frame.state).forEach((row, i) => {
      const parts = this.rows[i];
      const locked = row.state === "locked";
      parts.panel.fill = row.highlighted ? PANEL_SOLID : PANEL;
      parts.panel.stroke = row.highlighted ? ACCENT : PANEL_EDGE;
      parts.number.text = row.number;
      parts.number.fill = locked ? INK_FAINT : ACCENT;
      parts.name.text = row.name.toUpperCase();
      parts.name.fill = locked ? INK_FAINT : INK;
      parts.stateText.text = row.stateText;
      parts.stateText.fill = stateTone(row.state);
      if (row.best !== null) {
        parts.note.visible = true;
        parts.noteText.text = `BEST   COST ${costText(row.best.cost)}   TIME ${seconds(
          row.best.time,
        )}`;
        parts.noteText.fill = INK_DIM;
      } else if (locked) {
        parts.note.visible = true;
        parts.noteText.text = "LOCKED";
        parts.noteText.fill = INK_FAINT;
      } else {
        parts.note.visible = false;
      }
    });
  }
}
