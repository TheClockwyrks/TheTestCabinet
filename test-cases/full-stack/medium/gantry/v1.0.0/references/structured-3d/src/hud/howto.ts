// How the game is played, in a player's words (`specs/ui.md`).
//
// Two columns of headed prose, which is a paragraph of text rather than a
// layout of readouts, so it is drawn straight onto the screen layer with a
// `DrawComponent` — the path the engine offers for a picture the built-in
// components cannot state (`engine/rendering.md`).

import { DrawComponent } from "@clockwyrks/structured-3d";
import type { DrawApi } from "@clockwyrks/structured-3d";
import { STAGE_H, STAGE_W } from "../constants";
import { LAYER } from "../layers";
import { ACCENT, display, INK, INK_DIM, INK_FAINT, mono } from "../palette";
import { HOW_TO } from "../format";
import { GantryView } from "../actor-view";
import { MARGIN } from "./kit";
import type { GantryState } from "../game";

const LEFT = MARGIN + 36;

class HowToPage extends DrawComponent {
  draw(api: DrawApi): void {
    const state = this.world.state as GantryState;
    if (state.screen !== "howto") return;
    const { ctx } = api;
    ctx.save();
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";

    ctx.font = display(38);
    ctx.fillStyle = INK;
    ctx.fillText("HOW TO PLAY", LEFT, 84);

    const columns = [
      { x: LEFT, sections: HOW_TO.slice(0, 3) },
      { x: STAGE_W / 2 + 12, sections: HOW_TO.slice(3) },
    ];
    for (const column of columns) {
      let y = 132;
      for (const section of column.sections) {
        ctx.font = mono(13, 700);
        ctx.fillStyle = ACCENT;
        ctx.fillText(section.heading, column.x, y);
        y += 22;
        ctx.font = mono(13);
        ctx.fillStyle = INK_DIM;
        for (const line of section.lines) {
          ctx.fillText(line, column.x, y);
          y += 18;
        }
        y += 16;
      }
    }

    ctx.font = mono(13);
    ctx.fillStyle = INK_FAINT;
    ctx.fillText("ESC — BACK", LEFT, STAGE_H - 40);
    ctx.restore();
  }
}

export class HowToActor extends GantryView {
  constructor() {
    super();
    this.attach(new HowToPage()).layer = LAYER.text;
  }
}
