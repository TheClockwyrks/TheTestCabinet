// Orrery — the heading and the readout (specs/editor.md "Layout").
//
// Both regions are display only: they answer no press, and everything on them
// is derived from the state at the moment it is drawn. The heading carries the
// challenge's name, the machine's cost, and the editor's messages — including
// the one specs/editor.md asks for, which rises and sets are still missing,
// since that is what the `play` action refuses on. The readout carries the
// run's live figures: its status, its cycle, the period every tape loops on,
// the speed step, and each set's tally against the challenge's target.

import { HEADING_H, READOUT_X0, SPEEDS, STAGE_W, TAPE_Y0 } from "./constants";
import { fillRect, strokeRect, text } from "./draw";
import { missingApertures } from "./flow";
import { machinePeriod } from "./machine";
import { machineCost } from "./parts";
import { COLORS } from "./theme";
import type { OrreryState } from "./state";

/** The heading band: the challenge, what the machine costs, and the message. */
export function drawHeading(
  ctx: CanvasRenderingContext2D,
  state: OrreryState,
): void {
  fillRect(ctx, 0, 0, STAGE_W, HEADING_H, COLORS.panel);
  fillRect(ctx, 0, HEADING_H - 1, STAGE_W, 1, COLORS.panelEdge);
  text(ctx, state.challenge?.name ?? "", 16, 31, {
    size: 20,
    color: COLORS.text,
  });
  text(ctx, `COST ${machineCost(state.editor.parts)}`, 520, 30, {
    size: 14,
    color: COLORS.brass,
    bold: true,
    spacing: 2,
  });
  text(ctx, headingMessage(state), STAGE_W - 16, 30, {
    size: 13,
    color: state.sim === null ? COLORS.textDim : COLORS.text,
    align: "right",
  });
}

/** What the heading says right now (specs/editor.md "Running the machine"). */
export function headingMessage(state: OrreryState): string {
  const sim = state.sim;
  if (sim === null) {
    const missing = missingApertures(state);
    if (missing.length > 0) return `place ${missing.join(", ")} to run`;
    return "SPACE runs the machine, N steps it";
  }
  switch (sim.status) {
    case "running":
      return "running — SPACE pauses, ESC stops";
    case "paused":
      return "paused — N steps one cycle, SPACE resumes";
    case "faulted":
      return "halted — ESC returns to editing";
    case "complete":
      return "complete";
  }
}

/** The readout: the run's live figures, and the machine's while editing. */
export function drawReadout(
  ctx: CanvasRenderingContext2D,
  state: OrreryState,
): void {
  const width = STAGE_W - READOUT_X0;
  fillRect(
    ctx,
    READOUT_X0,
    HEADING_H,
    width,
    TAPE_Y0 - HEADING_H,
    COLORS.panel,
  );
  strokeRect(
    ctx,
    READOUT_X0,
    HEADING_H,
    width,
    TAPE_Y0 - HEADING_H,
    COLORS.panelEdge,
  );
  const x = READOUT_X0 + 16;
  let y = HEADING_H + 28;
  text(ctx, "READOUT", x, y, {
    size: 11,
    color: COLORS.textFaint,
    bold: true,
    spacing: 3,
  });
  y += 26;

  const sim = state.sim;
  const period = machinePeriod(state.editor.parts);
  const line = (
    label: string,
    value: string,
    color: string = COLORS.text,
  ): void => {
    text(ctx, label, x, y, { size: 12, color: COLORS.textFaint });
    text(ctx, value, STAGE_W - 16, y, { size: 12, color, align: "right" });
    y += 20;
  };

  line("parts", String(state.editor.parts.length));
  line("cost", String(machineCost(state.editor.parts)), COLORS.brass);
  line("period", String(period));
  if (sim === null) {
    y += 8;
    text(ctx, "not running", x, y, { size: 12, color: COLORS.textFaint });
    return;
  }
  line(
    "status",
    sim.status,
    sim.status === "faulted" ? COLORS.fault : COLORS.text,
  );
  line("cycle", String(sim.cycle));
  line("speed", `${SPEEDS[sim.speed]}/s`);
  line("area", String(sim.areaHexes.length));
  if (sim.fault !== null) line("fault", sim.fault.kind, COLORS.fault);
  y += 8;
  const target = state.challenge?.target ?? 0;
  text(ctx, "TALLIES", x, y, {
    size: 11,
    color: COLORS.textFaint,
    bold: true,
    spacing: 3,
  });
  y += 22;
  sim.tallies.forEach((tally, index) => {
    line(
      `set ${index + 1}`,
      `${tally} / ${target}`,
      tally >= target ? COLORS.legal : COLORS.text,
    );
  });
}
