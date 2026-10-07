// The two pieces of screen furniture that belong to no one screen: the scrim a
// menu screen lays over the yard so its copy reads, and the flag that says the
// game is muted.

import { STAGE_H, STAGE_W } from "../constants";
import { LAYER } from "../layers";
import { ACCENT, SCRIM } from "../palette";
import { GantryView, type ViewFrame } from "../actor-view";
import { HudGroup, MARGIN } from "./kit";
import type { Screen } from "../game";

/** The screens whose copy is read against a scrim rather than against the yard. */
const SCRIMMED: readonly Screen[] = ["title", "howto", "select", "results"];

export class ScrimActor extends GantryView {
  private readonly group = new HudGroup(this);

  constructor() {
    super();
    this.group.panel(
      { x: 0, y: 0, w: STAGE_W, h: STAGE_H },
      SCRIM,
      null,
      LAYER.scrim,
    );
  }

  override refresh(frame: ViewFrame): void {
    this.group.visible = SCRIMMED.includes(frame.state.screen);
    this.group.apply();
  }
}

/**
 * `MUTED`, wherever the screen has room for it: high on the title screen, and
 * out of the way of the key hints everywhere else.
 */
export class MutedActor extends GantryView {
  private readonly root = new HudGroup(this);
  private readonly onTitle = this.root.child();
  private readonly elsewhere = this.root.child();

  constructor() {
    super();
    this.onTitle.write(STAGE_W - MARGIN, MARGIN + 16, "MUTED", {
      size: 12,
      weight: 700,
      fill: ACCENT,
      align: "right",
      layer: LAYER.flag,
    });
    this.elsewhere.write(STAGE_W - MARGIN, STAGE_H - MARGIN - 44, "MUTED", {
      size: 11,
      weight: 700,
      fill: ACCENT,
      align: "right",
      layer: LAYER.flag,
    });
  }

  override refresh(frame: ViewFrame): void {
    const muted = frame.state.muted;
    const title = frame.state.screen === "title";
    this.onTitle.visible = muted && title;
    this.elsewhere.visible = muted && !title;
    this.root.apply();
  }
}
