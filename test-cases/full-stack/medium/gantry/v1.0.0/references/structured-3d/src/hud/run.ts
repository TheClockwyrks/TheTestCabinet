// The run screen: the tape playing out, read against the live scene
// (`specs/ui.md`).
//
// Every figure the specification asks for is here — each axis's value and its
// live command's target, the step counter, the run clock, the crane's cost, the
// watch speed, and the failure copy — each on a panel so it stays legible
// whatever the yard behind it is doing. The one drawn piece is the legend for
// the utilization ramp, which is a gradient rather than a readout.

import { DrawComponent } from "@clockwyrks/structured-3d";
import type {
  DrawApi,
  ShapeComponent,
  TextComponent,
} from "@clockwyrks/structured-3d";
import {
  CREAK_THRESHOLD,
  RUN_SPEEDS,
  SITE_COUNT,
  STAGE_H,
  STAGE_W,
} from "../constants";
import { LAYER } from "../layers";
import {
  ACCENT,
  BAD,
  BROKEN_CSS,
  COOL,
  css,
  GOOD,
  INK,
  INK_DIM,
  INK_FAINT,
  mono,
  OVER_LIMIT,
  PANEL,
  PANEL_EDGE,
  PANEL_SOLID,
  utilizationColour,
} from "../palette";
import {
  axisReadouts,
  clock,
  cost as costText,
  failText,
  speedText,
  stepCounter,
} from "../format";
import { craneCost, currentProgram, currentSite } from "../state";
import { GantryView, type ViewFrame } from "../actor-view";
import { HudGroup, MARGIN, type Rect } from "./kit";
import { HintBar } from "./pieces";
import type { GantryState } from "../game";

const HEAD: Rect = { x: MARGIN, y: MARGIN, w: 300, h: 112 };
const AXES: Rect = { x: MARGIN, y: HEAD.y + HEAD.h + 12, w: 300, h: 116 };
const STRIP: Rect = { x: STAGE_W - MARGIN - 300, y: MARGIN, w: 300, h: 66 };
const WARN: Rect = {
  x: STRIP.x,
  y: STRIP.y + STRIP.h + 10,
  w: 300,
  h: 30,
};
const LEGEND: Rect = {
  x: MARGIN,
  y: STAGE_H - MARGIN - 84,
  w: 300,
  h: 84,
};
const BANNER: Rect = { x: STAGE_W / 2 - 300, y: 268, w: 600, h: 118 };

/**
 * The legend for the utilization ramp, so the member colouring reads
 * (`specs/ui.md`). The ramp is a continuous gradient and the two swatches under
 * it are the two colours that leave it, so this is one drawn picture rather
 * than a row of shapes.
 */
class RampLegend extends DrawComponent {
  draw(api: DrawApi): void {
    const state = this.world.state as GantryState;
    if (state.screen !== "run") return;
    const { ctx } = api;
    ctx.save();
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = PANEL;
    ctx.fillRect(LEGEND.x, LEGEND.y, LEGEND.w, LEGEND.h);
    ctx.strokeStyle = PANEL_EDGE;
    ctx.lineWidth = 1;
    ctx.strokeRect(LEGEND.x + 0.5, LEGEND.y + 0.5, LEGEND.w - 1, LEGEND.h - 1);

    ctx.textAlign = "left";
    ctx.font = mono(11);
    ctx.fillStyle = INK_FAINT;
    ctx.fillText("MEMBER LOAD", LEGEND.x + 14, LEGEND.y + 20);

    const bar: Rect = {
      x: LEGEND.x + 14,
      y: LEGEND.y + 34,
      w: LEGEND.w - 28,
      h: 12,
    };
    const steps = 48;
    for (let i = 0; i < steps; i++) {
      ctx.fillStyle = css(utilizationColour(i / (steps - 1)));
      ctx.fillRect(
        bar.x + (bar.w * i) / steps,
        bar.y,
        bar.w / steps + 1,
        bar.h,
      );
    }
    ctx.strokeStyle = PANEL_EDGE;
    ctx.strokeRect(bar.x, bar.y, bar.w, bar.h);

    // The creak threshold, ticked on the bar itself and named above it, so the
    // two labels under the bar never crowd one another.
    const creak = bar.x + bar.w * CREAK_THRESHOLD;
    ctx.strokeStyle = INK;
    ctx.beginPath();
    ctx.moveTo(creak, bar.y - 2);
    ctx.lineTo(creak, bar.y + bar.h + 2);
    ctx.stroke();
    ctx.font = mono(10);
    ctx.fillStyle = INK_FAINT;
    ctx.textAlign = "right";
    ctx.fillText("CREAK", creak - 3, bar.y - 4);

    ctx.font = mono(11);
    ctx.textAlign = "left";
    ctx.fillText("SLACK", bar.x, bar.y + 26);
    ctx.textAlign = "right";
    ctx.fillText("LIMIT", bar.x + bar.w, bar.y + 26);

    ctx.textAlign = "left";
    ctx.fillStyle = css(OVER_LIMIT);
    ctx.fillRect(bar.x, bar.y + 34, 12, 10);
    ctx.fillStyle = INK_FAINT;
    ctx.fillText("past limit", bar.x + 18, bar.y + 43);
    ctx.fillStyle = BROKEN_CSS;
    ctx.fillRect(bar.x + 120, bar.y + 34, 12, 10);
    ctx.fillStyle = INK_FAINT;
    ctx.fillText("broken", bar.x + 138, bar.y + 43);
    ctx.restore();
  }
}

interface AxisRow {
  readonly label: TextComponent;
  readonly value: TextComponent;
  readonly target: TextComponent;
}

export class RunActor extends GantryView {
  private readonly root = new HudGroup(this);
  private readonly clock: TextComponent;
  private readonly step: TextComponent;
  private readonly cost: TextComponent;
  private readonly speed: TextComponent;
  private readonly axes: AxisRow[];
  private readonly siteCaption: TextComponent;
  private readonly siteName: TextComponent;
  private readonly placed: TextComponent;
  private readonly warnGroup: HudGroup;
  private readonly warn: TextComponent;
  private readonly bannerGroup: HudGroup;
  private readonly failure: TextComponent;
  private readonly cause: TextComponent;
  private readonly hints: HintBar;
  private readonly bannerPanel: ShapeComponent;

  constructor() {
    super();

    this.root.panel(HEAD);
    this.root.write(HEAD.x + 14, HEAD.y + 20, "RUN CLOCK", {
      size: 11,
      fill: INK_FAINT,
    });
    this.clock = this.root.write(HEAD.x + 14, HEAD.y + 54, "", {
      size: 30,
      face: "display",
    });
    this.step = this.root.write(HEAD.x + 14, HEAD.y + 78, "", {
      size: 13,
      fill: INK_DIM,
    });
    this.cost = this.root.write(HEAD.x + 14, HEAD.y + 98, "", {
      size: 13,
      fill: INK_DIM,
    });
    this.speed = this.root.write(HEAD.x + HEAD.w - 14, HEAD.y + 98, "", {
      size: 13,
      weight: 700,
      fill: ACCENT,
      align: "right",
    });

    this.root.panel(AXES);
    this.root.write(AXES.x + 14, AXES.y + 20, "AXES", {
      size: 11,
      fill: INK_FAINT,
    });
    this.axes = [0, 1, 2, 3].map((i) => {
      const y = AXES.y + 44 + i * 22;
      return {
        label: this.root.write(AXES.x + 14, y, "", { size: 12 }),
        value: this.root.write(AXES.x + 168, y, "", {
          size: 13,
          weight: 700,
          align: "right",
        }),
        target: this.root.write(AXES.x + AXES.w - 14, y, "", {
          size: 12,
          align: "right",
        }),
      };
    });

    this.root.panel(STRIP);
    this.siteCaption = this.root.write(STRIP.x + 14, STRIP.y + 22, "", {
      size: 11,
      fill: INK_FAINT,
    });
    this.siteName = this.root.write(STRIP.x + 14, STRIP.y + 48, "", {
      size: 18,
      face: "display",
    });
    this.placed = this.root.write(STRIP.x + STRIP.w - 14, STRIP.y + 48, "", {
      size: 12,
      fill: INK_DIM,
      align: "right",
    });

    this.warnGroup = this.root.child();
    this.warnGroup.panel(WARN, PANEL, BAD);
    this.warn = this.warnGroup.write(WARN.x + 14, WARN.y + 20, "", {
      size: 13,
      weight: 700,
      fill: BAD,
    });

    this.attach(new RampLegend()).layer = LAYER.panel;

    this.bannerGroup = this.root.child();
    this.bannerPanel = this.bannerGroup.panel(
      BANNER,
      PANEL_SOLID,
      BAD,
      LAYER.banner,
    );
    this.bannerGroup.write(STAGE_W / 2, BANNER.y + 36, "RUN FAILED", {
      size: 13,
      weight: 700,
      fill: BAD,
      align: "center",
      layer: LAYER.banner + 1,
    });
    this.failure = this.bannerGroup.write(STAGE_W / 2, BANNER.y + 74, "", {
      size: 28,
      face: "display",
      align: "center",
      layer: LAYER.banner + 1,
    });
    this.cause = this.bannerGroup.write(STAGE_W / 2, BANNER.y + 98, "", {
      size: 12,
      fill: INK_FAINT,
      align: "center",
      layer: LAYER.banner + 1,
    });

    this.hints = new HintBar(this.root, 1);
  }

  override refresh(frame: ViewFrame): void {
    const state = frame.state;
    this.root.visible = state.screen === "run";
    if (this.root.visible) this.write(state);
    this.root.apply();
  }

  private write(state: GantryState): void {
    const run = state.run;
    const tape = currentProgram(state);

    this.clock.text = clock(run.tick);
    this.step.text = `STEP ${stepCounter(run.stepIndex, tape.length)}`;
    this.cost.text = `COST ${costText(craneCost(state))}`;
    this.speed.text = `SPEED ${speedText(run.speedIndex)}`;

    axisReadouts(run.axes).forEach((axis, i) => {
      const row = this.axes[i];
      row.label.text = axis.label;
      row.label.fill = axis.moving ? ACCENT : INK_FAINT;
      row.value.text = axis.value;
      row.value.fill = INK;
      row.target.text = axis.target === null ? "—" : `→ ${axis.target}`;
      row.target.fill = axis.target === null ? INK_FAINT : COOL;
    });

    const site = currentSite(state);
    this.siteCaption.text = `SITE ${state.siteIndex + 1} / ${SITE_COUNT}`;
    this.siteName.text = site.name.toUpperCase();
    const placed = run.loads.filter((load) => load.phase === "placed").length;
    this.placed.text = `${placed} / ${run.loads.length} PLACED`;
    this.placed.fill = placed === run.loads.length ? GOOD : INK_DIM;

    this.warnGroup.visible = run.broken.length > 0;
    this.warn.text = `${run.broken.length} MEMBERS BROKEN`;

    const failed = run.phase === "failed" && run.cause !== null;
    this.bannerGroup.visible = failed;
    this.bannerPanel.stroke = BAD;
    if (run.cause !== null) {
      this.failure.text = failText(run.cause);
      this.cause.text = run.cause;
    }

    this.hints.set([
      run.phase === "running"
        ? `S SPEED (${RUN_SPEEDS.join(" ")})   DRAG ORBIT   ESC ABORT   M MUTE`
        : "ESC BACK TO BUILD   DRAG ORBIT   M MUTE",
    ]);
  }
}
