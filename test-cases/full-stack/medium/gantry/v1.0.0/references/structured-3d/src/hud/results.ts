// A cleared site's score, beside the site's par, and where to go next
// (`specs/ui.md`).

import { CLEARED_TEXT, STAGE_W, TICK_HZ } from "../constants";
import { ACCENT, INK_DIM, INK_FAINT, PANEL_SOLID } from "../palette";
import { cost as costText, menuEntries, seconds } from "../format";
import { craneCost, currentSite, highlightedIndex } from "../state";
import { GantryView, type ViewFrame } from "../actor-view";
import { HudGroup, type Rect } from "./kit";
import { Menu } from "./pieces";
import type { TextComponent } from "@test-cabinet/structured-3d";

const CARD: Rect = { x: STAGE_W / 2 - 320, y: 120, w: 640, h: 460 };

export class ResultsActor extends GantryView {
  private readonly root = new HudGroup(this);
  private readonly site: TextComponent;
  private readonly figures: { value: TextComponent; par: TextComponent }[];
  private readonly bestLine = this.root.child();
  private readonly best: TextComponent;
  private readonly menu: Menu;

  constructor() {
    super();
    this.root.panel(CARD, PANEL_SOLID, ACCENT);
    this.root.write(STAGE_W / 2, CARD.y + 84, CLEARED_TEXT, {
      size: 46,
      face: "display",
      align: "center",
    });
    this.site = this.root.write(STAGE_W / 2, CARD.y + 118, "", {
      size: 15,
      fill: INK_DIM,
      align: "center",
    });

    this.figures = (["COST", "TIME"] as const).map((label, i) => {
      const x = STAGE_W / 2 - 150 + i * 300;
      this.root.write(x, CARD.y + 168, label, { size: 11, fill: INK_FAINT });
      return {
        value: this.root.write(x, CARD.y + 206, "", {
          size: 34,
          face: "display",
        }),
        par: this.root.write(x, CARD.y + 232, "", {
          size: 13,
          fill: INK_FAINT,
        }),
      };
    });

    this.best = this.bestLine.write(STAGE_W / 2, CARD.y + 262, "", {
      size: 13,
      fill: INK_DIM,
      align: "center",
    });

    this.menu = new Menu(this.root, CARD.x + 180, CARD.y + 292, 280, 3);
  }

  override refresh(frame: ViewFrame): void {
    const state = frame.state;
    this.root.visible = state.screen === "results";
    if (this.root.visible) this.write(frame);
    this.root.apply();
  }

  private write(frame: ViewFrame): void {
    const state = frame.state;
    const site = currentSite(state);
    this.site.text = site.name.toUpperCase();

    const runCost = craneCost(state);
    const runTime = state.run.tick / TICK_HZ;
    this.figures[0].value.text = costText(runCost);
    this.figures[0].par.text = `PAR ${costText(site.par.cost)}`;
    this.figures[1].value.text = seconds(runTime);
    this.figures[1].par.text = `PAR ${seconds(site.par.time)}`;

    const score = state.best[state.siteIndex] ?? null;
    this.bestLine.visible = score !== null;
    if (score !== null) {
      this.best.text = `BEST   COST ${costText(score.cost)}   TIME ${seconds(
        score.time,
      )}`;
    }

    this.menu.refresh(menuEntries(state) ?? [], highlightedIndex(state));
  }
}
