// The build screen's readouts: the site and its budget, the tool palette with
// each tool's binding, what the static check found, and what a click at the
// pointer would do (`specs/ui.md`).

import { STAGE_H, STAGE_W } from "../constants";
import { LAYER } from "../layers";
import {
  ACCENT,
  BAD,
  GOOD,
  INK,
  INK_DIM,
  INK_FAINT,
  PANEL,
  PANEL_EDGE,
  PANEL_INSET,
  PANEL_SOLID,
} from "../palette";
import {
  fixed,
  ISSUE_GLOSS,
  REFUSAL_TEXT,
  toolEntries,
  type ToolEntry,
} from "../format";
import { GantryView, type ViewFrame } from "../actor-view";
import {
  baseline,
  fontOf,
  HudGroup,
  MARGIN,
  placeRect,
  type Rect,
} from "./kit";
import { HintBar, SiteStrip, StartBlock } from "./pieces";
import type { GantryState, StartIssue } from "../game";
import type {
  ShapeComponent,
  TextComponent,
} from "@test-cabinet/structured-3d";

const PALETTE_RECT: Rect = { x: MARGIN, y: 132, w: 200, h: 24 + 6 * 32 };
const HELD_RECT: Rect = {
  x: MARGIN,
  y: PALETTE_RECT.y + PALETTE_RECT.h + 10,
  w: 200,
  h: 28,
};

/** Where the refused-start block sits, which the held-node flag pushes down. */
const startTop = (state: GantryState): number =>
  state.pendingNode === null ? 366 : 404;

const CHECK_RECT: Rect = {
  x: STAGE_W - MARGIN - 400,
  y: MARGIN,
  w: 400,
  h: 120,
};

const HINT_RECT: Rect = {
  x: STAGE_W / 2 - 300,
  y: STAGE_H - 96,
  w: 600,
  h: 34,
};

/** As many issues as the static check can report at once. */
const MAX_ISSUES = 5;

/** The build screen's tool palette, with each tool's binding. */
class ToolPalette {
  private readonly rows: {
    readonly chosen: HudGroup;
    readonly key: TextComponent;
    readonly label: TextComponent;
  }[];

  constructor(parent: HudGroup, entries: readonly ToolEntry[]) {
    parent.panel(PALETTE_RECT);
    parent.write(PALETTE_RECT.x + 14, PALETTE_RECT.y + 20, "TOOL", {
      size: 11,
      fill: INK_FAINT,
    });
    this.rows = entries.map((entry, i) => {
      const y = PALETTE_RECT.y + 30 + i * 32;
      const row: Rect = {
        x: PALETTE_RECT.x + 8,
        y,
        w: PALETTE_RECT.w - 16,
        h: 28,
      };
      const chosen = parent.child();
      chosen.panel(row, PANEL_INSET, ACCENT, LAYER.panel + 1);
      return {
        chosen,
        key: parent.write(row.x + 12, y + 19, entry.key, {
          size: 13,
          weight: 700,
        }),
        label: parent.write(row.x + 36, y + 19, entry.label, { size: 14 }),
      };
    });
  }

  refresh(state: GantryState): void {
    toolEntries(state.tool).forEach((entry, i) => {
      const row = this.rows[i];
      row.chosen.visible = entry.selected;
      row.key.fill = entry.selected ? ACCENT : INK_FAINT;
      row.label.font = fontOf({ size: 14, weight: entry.selected ? 700 : 400 });
      row.label.fill = entry.selected ? INK : INK_DIM;
    });
  }
}

/** The static check's result, which stands until the crane or the tape changes. */
class CheckPanel {
  private readonly group: HudGroup;
  private readonly panel: ShapeComponent;
  private readonly verdictGroup: HudGroup;
  private readonly verdict: TextComponent;
  private readonly noIssues: HudGroup;
  private readonly noIssuesLine: TextComponent;
  private readonly rows: {
    group: HudGroup;
    name: TextComponent;
    gloss: TextComponent;
  }[];
  private readonly summary: TextComponent;

  constructor(parent: HudGroup) {
    this.group = parent.child();
    this.panel = this.group.panel(CHECK_RECT);
    this.group.write(CHECK_RECT.x + 14, CHECK_RECT.y + 22, "STATIC CHECK", {
      size: 11,
      fill: INK_FAINT,
    });
    this.verdictGroup = this.group.child();
    this.verdict = this.verdictGroup.write(
      CHECK_RECT.x + 14,
      CHECK_RECT.y + 48,
      "",
      { size: 17, face: "display" },
    );
    this.noIssues = this.group.child();
    this.noIssuesLine = this.noIssues.write(CHECK_RECT.x + 14, 0, "no issues", {
      size: 12,
      fill: INK_DIM,
    });
    this.rows = Array.from({ length: MAX_ISSUES }, () => {
      const group = this.group.child();
      return {
        group,
        name: group.write(CHECK_RECT.x + 14, 0, "", {
          size: 13,
          weight: 700,
          fill: ACCENT,
        }),
        gloss: group.write(CHECK_RECT.x + CHECK_RECT.w - 14, 0, "", {
          size: 12,
          fill: INK_DIM,
          align: "right",
        }),
      };
    });
    this.summary = this.group.write(CHECK_RECT.x + 14, 0, "", {
      size: 12,
      fill: INK_FAINT,
    });
  }

  refresh(state: GantryState): void {
    const result = state.checkResult;
    this.group.visible = result !== null;
    if (result === null) return;

    // A readiness issue leaves the structure unsolved, so the check has no
    // verdict to report and the panel shows none (`specs/ui.md`): only the
    // issues by name, and no member. `empty-program` is not a readiness issue —
    // a ready crane with an empty tape is still solved and still judged.
    const judged = result.issues.every((issue) => issue === "empty-program");
    // One line per issue, or the single "no issues" line when there are none,
    // so the summary under them always has a line's room inside the panel.
    const rows = Math.max(1, result.issues.length);
    placeRect(this.panel, {
      ...CHECK_RECT,
      h: (judged ? 96 : 72) + rows * 20,
    });

    this.verdictGroup.visible = judged;
    if (judged) {
      this.verdict.text = result.stable
        ? "THE STRUCTURE STANDS"
        : "IT DOES NOT STAND";
      this.verdict.fill = result.stable ? GOOD : BAD;
    }

    let y = CHECK_RECT.y + (judged ? 72 : 48);
    this.noIssues.visible = result.issues.length === 0;
    if (result.issues.length === 0) {
      this.noIssuesLine.offset.position = baseline(CHECK_RECT.x + 14, y, 12);
      y += 20;
    }
    this.rows.forEach((row, i) => {
      const issue = result.issues[i] as StartIssue | undefined;
      row.group.visible = issue !== undefined;
      if (issue === undefined) return;
      row.name.text = issue;
      row.gloss.text = ISSUE_GLOSS[issue];
      row.name.offset.position = baseline(CHECK_RECT.x + 14, y, 13);
      row.gloss.offset.position = baseline(
        CHECK_RECT.x + CHECK_RECT.w - 14,
        y,
        12,
      );
      y += 20;
    });

    const peak = result.members.reduce(
      (top, member) => Math.max(top, member.utilization),
      0,
    );
    this.summary.text =
      result.members.length === 0
        ? "no member solved"
        : `${result.members.length} members   peak ${fixed(peak, 2)}`;
    this.summary.offset.position = baseline(CHECK_RECT.x + 14, y + 4, 12);
  }
}

/** What a click would do, or the rule that would refuse it (`specs/ui.md`). */
class PointerLine {
  private readonly group: HudGroup;
  private readonly panel: ShapeComponent;
  private readonly line: TextComponent;

  constructor(parent: HudGroup) {
    this.group = parent.child();
    this.panel = this.group.panel(HINT_RECT, PANEL_SOLID, PANEL_EDGE);
    this.line = this.group.write(STAGE_W / 2, HINT_RECT.y + 23, "", {
      size: 14,
      fill: INK_DIM,
      align: "center",
    });
  }

  refresh(frame: ViewFrame): void {
    const hint = frame.hint;
    const refused = hint.refusal !== null;
    const content = refused
      ? `REFUSED — ${REFUSAL_TEXT[hint.refusal]}`
      : hint.action;
    this.group.visible = content !== null;
    if (content === null) return;
    this.line.text = content;
    this.line.font = fontOf({ size: 14, weight: refused ? 700 : 400 });
    this.line.fill = refused ? BAD : INK_DIM;
    this.panel.stroke = refused ? BAD : PANEL_EDGE;
  }
}

export class BuildActor extends GantryView {
  private readonly root = new HudGroup(this);
  private readonly strip: SiteStrip;
  private readonly palette: ToolPalette;
  private readonly held: HudGroup;
  private readonly start: StartBlock;
  private readonly check: CheckPanel;
  private readonly pointer: PointerLine;
  private readonly hints: HintBar;

  constructor() {
    super();
    this.strip = new SiteStrip(this.root, MARGIN);
    this.palette = new ToolPalette(this.root, toolEntries("strut"));

    this.held = this.root.child();
    this.held.panel(HELD_RECT, PANEL, ACCENT);
    this.held.write(
      HELD_RECT.x + 12,
      HELD_RECT.y + 19,
      "NODE HELD — ESC DROPS",
      { size: 11, fill: ACCENT },
    );

    this.start = new StartBlock(this.root, MARGIN);
    this.check = new CheckPanel(this.root);
    this.pointer = new PointerLine(this.root);
    this.hints = new HintBar(this.root, 2);
    this.hints.set([
      "DRAG ORBIT   = − ZOOM   1…6 TOOL   Z UNDO   C CHECK",
      "P TAPE   G RUN   ESC BACK   M MUTE",
    ]);
  }

  override refresh(frame: ViewFrame): void {
    const state = frame.state;
    this.root.visible = state.screen === "build";
    if (this.root.visible) {
      this.strip.refresh(state);
      this.palette.refresh(state);
      this.held.visible = state.pendingNode !== null;
      this.start.refresh(state, startTop(state));
      this.check.refresh(state);
      this.pointer.refresh(frame);
    }
    this.root.apply();
  }
}
