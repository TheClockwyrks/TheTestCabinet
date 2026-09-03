// The front door: the title, the tagline, and the main menu (`specs/ui.md`).

import { STAGE_H, TAGLINE_TEXT, TITLE_TEXT } from "../constants";
import { LAYER } from "../layers";
import { ACCENT, INK_DIM, INK_FAINT } from "../palette";
import { menuEntries } from "../format";
import { highlightedIndex } from "../state";
import { GantryView, type ViewFrame } from "../actor-view";
import { HudGroup } from "./kit";
import { Menu } from "./pieces";

export class TitleActor extends GantryView {
  private readonly root = new HudGroup(this);
  private readonly menu: Menu;

  constructor() {
    super();
    this.root.write(120, 250, TITLE_TEXT, { size: 112, face: "display" });
    this.root.panel({ x: 124, y: 274, w: 320, h: 5 }, ACCENT, null, LAYER.text);
    this.root.write(124, 312, TAGLINE_TEXT, { size: 18, fill: INK_DIM });
    this.menu = new Menu(this.root, 120, 400, 380, 2);
    this.root.write(
      120,
      STAGE_H - 60,
      "↑ ↓ CHOOSE      ENTER SELECT      M MUTE",
      { size: 12, fill: INK_FAINT },
    );
  }

  override refresh(frame: ViewFrame): void {
    this.root.visible = frame.state.screen === "title";
    if (this.root.visible) {
      this.menu.refresh(
        menuEntries(frame.state) ?? [],
        highlightedIndex(frame.state),
      );
    }
    this.root.apply();
  }
}
