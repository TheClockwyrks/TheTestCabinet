// The readouts more than one screen shows.
//
// Each piece builds its own components into a group it is handed and brings
// them into line with the state on `refresh`, so a screen's actor composes
// pieces rather than repeating a layout. Nothing here reads anything but the
// state it is given.
//
// Whether a component draws is decided by the group it sits in and never by
// the component itself: `HudGroup.apply` writes `visible` down the tree once a
// frame, so anything that comes and goes on its own gets a group of its own.

import { SITE_COUNT, STAGE_H, STAGE_W } from "../constants";
import { LAYER } from "../layers";
import {
  ACCENT,
  BAD,
  COOL,
  GAUGE_TRACK,
  INK,
  INK_DIM,
  INK_FAINT,
  PANEL,
  PANEL_INSET,
} from "../palette";
import { cost as costText } from "../format";
import { pendingStartIssues } from "../screens";
import { craneCost, currentProgram, currentSite } from "../state";
import type { GantryState } from "../game";
import {
  baseline,
  fontOf,
  HudGroup,
  MARGIN,
  placeRect,
  type Rect,
  type TextSpec,
} from "./kit";
import type {
  ShapeComponent,
  TextComponent,
} from "@test-cabinet/structured-3d";

/**
 * Roughly how wide one character is in the mono face, as a fraction of the
 * font size. A panel drawn behind a line of hints is sized from this rather
 * than from a measured width: the screen layer's context belongs to the
 * pipeline, and a hint panel a few pixels wide of its text reads no worse.
 */
const MONO_ADVANCE = 0.6;

/** How wide a line of mono text sets at a size. */
export const monoWidth = (text: string, size: number): number =>
  text.length * size * MONO_ADVANCE;

// ---- The site strip --------------------------------------------------------

/** How tall and how wide the strip naming the open site is. */
export const SITE_STRIP: { readonly w: number; readonly h: number } = {
  w: 424,
  h: 96,
};

/** The strip naming the open site and reading its cost against the budget. */
export class SiteStrip {
  private readonly rect: Rect;
  private readonly caption: TextComponent;
  private readonly name: TextComponent;
  private readonly filled: HudGroup;
  private readonly gaugeFill: ShapeComponent;
  private readonly cost: TextComponent;
  private readonly tape: TextComponent;

  constructor(parent: HudGroup, x: number) {
    const group = parent.child();
    this.rect = { x, y: MARGIN, w: SITE_STRIP.w, h: SITE_STRIP.h };
    const rect = this.rect;
    group.panel(rect);
    this.caption = group.write(rect.x + 14, rect.y + 22, "", {
      size: 11,
      fill: INK_FAINT,
    });
    this.name = group.write(rect.x + 14, rect.y + 46, "", {
      size: 22,
      face: "display",
    });
    const gauge: Rect = {
      x: rect.x + 14,
      y: rect.y + 58,
      w: rect.w - 28,
      h: 8,
    };
    group.panel(gauge, GAUGE_TRACK, null, LAYER.panel + 1);
    this.filled = group.child();
    this.gaugeFill = this.filled.panel(gauge, COOL, null, LAYER.panel + 2);
    this.cost = group.write(rect.x + 14, rect.y + 84, "", {
      size: 13,
      fill: INK_DIM,
    });
    this.tape = group.write(rect.x + rect.w - 14, rect.y + 84, "", {
      size: 13,
      fill: INK_DIM,
      align: "right",
    });
  }

  refresh(state: GantryState): void {
    const site = currentSite(state);
    this.caption.text = `SITE ${state.siteIndex + 1} / ${SITE_COUNT}`;
    this.name.text = site.name.toUpperCase();

    const spent = craneCost(state);
    const share = site.budget === 0 ? 0 : Math.min(1, spent / site.budget);
    placeRect(this.gaugeFill, {
      x: this.rect.x + 14,
      y: this.rect.y + 58,
      w: Math.max(3, (this.rect.w - 28) * share),
      h: 8,
    });
    this.filled.visible = share > 0;
    this.gaugeFill.fill = share >= 1 ? BAD : share > 0.85 ? ACCENT : COOL;

    this.cost.text = `COST ${costText(spent)} / ${costText(site.budget)}`;
    this.cost.fill = share >= 1 ? BAD : INK_DIM;
    this.tape.text = `TAPE ${currentProgram(state).length} STEPS`;
  }
}

// ---- The refused start -----------------------------------------------------

/** As many issues as `startIssues` can report at once. */
const MAX_ISSUES = 5;

const ISSUE_SPEC: TextSpec = { size: 13, weight: 700, fill: BAD };

/**
 * What would refuse a run right now, by name (`specs/ui.md`: a refused start
 * "stays on the screen and shows the refusing issues by name").
 *
 * A refused start leaves the state byte-identical (`specs/instrumentation.md`),
 * so there is nothing recorded to draw after the fact; the refusal is read off
 * the structure and the tape instead, which puts the same issues on screen at
 * the moment `run` is refused — and before it, so a player knows what the crane
 * still needs.
 */
export class StartBlock {
  private readonly group: HudGroup;
  private readonly panel: ShapeComponent;
  private readonly caption: TextComponent;
  private readonly rows: { group: HudGroup; line: TextComponent }[];

  constructor(
    parent: HudGroup,
    private readonly x: number,
  ) {
    this.group = parent.child();
    this.panel = this.group.panel({ x, y: 0, w: 300, h: 60 }, PANEL, BAD);
    this.caption = this.group.write(x + 14, 0, "G RUN IS REFUSED", {
      size: 11,
      fill: INK_FAINT,
    });
    this.rows = Array.from({ length: MAX_ISSUES }, () => {
      const group = this.group.child();
      return { group, line: group.write(x + 14, 0, "", ISSUE_SPEC) };
    });
  }

  /**
   * The block sits under whatever the screen has already put in that column, so
   * where its top edge goes is the screen's to say each frame.
   */
  refresh(state: GantryState, top: number): void {
    const issues = pendingStartIssues(state);
    this.group.visible = issues.length > 0;
    if (issues.length === 0) return;
    placeRect(this.panel, {
      x: this.x,
      y: top,
      w: 300,
      h: 40 + issues.length * 20,
    });
    this.caption.offset.position = baseline(this.x + 14, top + 22, 11);
    this.rows.forEach((row, i) => {
      const issue = issues[i];
      row.group.visible = issue !== undefined;
      row.line.text = issue ?? "";
      row.line.offset.position = baseline(
        this.x + 14,
        top + 44 + i * 20,
        ISSUE_SPEC.size,
      );
    });
  }
}

// ---- The menus -------------------------------------------------------------

/** A menu of entries, driven by the key actions alone (`specs/ui.md`). */
export class Menu {
  private readonly rows: {
    readonly row: HudGroup;
    readonly chosen: HudGroup;
    readonly label: TextComponent;
  }[];

  constructor(
    parent: HudGroup,
    x: number,
    y: number,
    width: number,
    capacity: number,
  ) {
    this.rows = Array.from({ length: capacity }, (_row, i) => {
      const row = parent.child();
      const rect: Rect = { x, y: y + i * 48, w: width, h: 40 };
      const chosen = row.child();
      chosen.panel(rect, PANEL_INSET, ACCENT, LAYER.panel + 1);
      chosen.write(rect.x + 14, rect.y + 27, "»", {
        size: 18,
        weight: 700,
        fill: ACCENT,
      });
      const label = row.write(rect.x + 44, rect.y + 27, "", {
        size: 19,
        weight: 500,
        face: "display",
      });
      return { row, chosen, label };
    });
  }

  refresh(items: readonly string[], highlight: number): void {
    this.rows.forEach((entry, i) => {
      const item = items[i];
      entry.row.visible = item !== undefined;
      if (item === undefined) return;
      const on = i === highlight;
      entry.chosen.visible = on;
      entry.label.text = item;
      entry.label.font = fontOf({
        size: 19,
        weight: on ? 700 : 500,
        face: "display",
      });
      entry.label.fill = on ? INK : INK_DIM;
    });
  }
}

// ---- The key hints ---------------------------------------------------------

/** A row of key hints along the bottom of a yard screen. */
export class HintBar {
  private readonly panel: ShapeComponent;
  private readonly lines: { group: HudGroup; line: TextComponent }[];

  constructor(parent: HudGroup, capacity: number) {
    const group = parent.child();
    this.panel = group.panel({ x: 0, y: 0, w: 10, h: 10 }, PANEL, null);
    this.lines = Array.from({ length: capacity }, () => {
      const own = group.child();
      return {
        group: own,
        line: own.write(STAGE_W - MARGIN, 0, "", {
          size: 12,
          fill: INK_DIM,
          align: "right",
        }),
      };
    });
  }

  /**
   * The yard behind these is any colour at all — packed earth, pale sky, a lit
   * member — so like every other readout they sit on a panel, which is what
   * keeps them legible against the scene (`specs/overview.md`).
   */
  set(lines: readonly string[]): void {
    const shown = lines.slice(0, this.lines.length);
    const width = shown.reduce(
      (widest, line) => Math.max(widest, monoWidth(line, 12)),
      0,
    );
    const top = STAGE_H - MARGIN - (shown.length - 1) * 16;
    placeRect(this.panel, {
      x: STAGE_W - MARGIN - width - 10,
      y: top - 15,
      w: width + 20,
      h: shown.length * 16 + 8,
    });
    this.lines.forEach((entry, i) => {
      const text = shown[i];
      entry.group.visible = text !== undefined;
      entry.line.text = text ?? "";
      entry.line.offset.position = baseline(STAGE_W - MARGIN, top + i * 16, 12);
    });
  }
}
