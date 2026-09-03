import { describe, expect, it } from "vitest";
import { HOIST_START, TROLLEY_ACCEL, TROLLEY_MAX_RATE } from "../constants";
import { AXES, DT, isAxisName, startingAxes, stepAxis } from "./axes";
import type { AxisState } from "./types";

const trolley = (
  value: number,
  rate: number,
  target: number | null,
  commandRate = TROLLEY_MAX_RATE,
): AxisState => ({
  value,
  rate,
  command: target === null ? null : { target, rate: commandRate },
});

describe("the run-start posture", () => {
  it("puts every axis where specs/program.md fixes it", () => {
    const axes = startingAxes();
    expect(axes.slew).toEqual({ value: 0, rate: 0, command: null });
    expect(axes.trolley.value).toBe(0);
    expect(axes.hoist.value).toBe(HOIST_START);
    expect(axes.grip.value).toBe(0);
    expect(isAxisName("hoist")).toBe(true);
    expect(isAxisName("boom")).toBe(false);
  });
});

describe("the axis controller", () => {
  it("holds an axis with no live command at zero rate, reporting no acceleration", () => {
    const step = stepAxis(trolley(3, 2, null), "trolley");
    expect(step.state).toEqual({ value: 3, rate: 0, command: null });
    expect(step.accel).toBe(0);
  });

  it("reports +s * a on a driving tick that changed the rate", () => {
    const step = stepAxis(trolley(0, 0, 10), "trolley");
    expect(step.accel).toBe(TROLLEY_ACCEL);
    expect(step.state.rate).toBeCloseTo(TROLLEY_ACCEL * DT, 12);
    expect(step.state.value).toBeCloseTo(TROLLEY_ACCEL * DT * DT, 12);
    expect(step.arrived).toBe(false);
  });

  it("reports the same term negated when the target lies the other way", () => {
    const step = stepAxis(trolley(10, 0, 0), "trolley");
    expect(step.accel).toBe(-TROLLEY_ACCEL);
    expect(step.state.rate).toBeCloseTo(-TROLLEY_ACCEL * DT, 12);
  });

  it("reports 0 on a cruising tick, one whose clamp left the rate as it was", () => {
    const step = stepAxis(trolley(0, TROLLEY_MAX_RATE, 10), "trolley");
    expect(step.accel).toBe(0);
    expect(step.state.rate).toBe(TROLLEY_MAX_RATE);
  });

  it("reports -s * a on a braking tick", () => {
    // Braking begins exactly at the distance v^2 / (2a), which is 2 here.
    const step = stepAxis(trolley(0, TROLLEY_MAX_RATE, 2), "trolley");
    expect(step.accel).toBe(-TROLLEY_ACCEL);
    expect(step.state.rate).toBeCloseTo(
      TROLLEY_MAX_RATE - TROLLEY_ACCEL * DT,
      12,
    );
    expect(step.arrived).toBe(false);
  });

  it("reports 0 on the tick that arrives, and clears the command", () => {
    const step = stepAxis(trolley(0, 0, 1e-6), "trolley");
    expect(step.arrived).toBe(true);
    expect(step.accel).toBe(0);
    expect(step.state).toEqual({ value: 1e-6, rate: 0, command: null });
  });

  it("finishes a command whose target is the axis's current value on the tick it is issued", () => {
    const step = stepAxis(trolley(4, 0, 4), "trolley");
    expect(step.arrived).toBe(true);
    expect(step.accel).toBe(0);
    expect(step.state).toEqual({ value: 4, rate: 0, command: null });
  });

  it("clamps the rate to the commanded one, not the axis's maximum", () => {
    let axis = trolley(0, 0, 100, 0.5);
    for (let i = 0; i < 200; i++) axis = stepAxis(axis, "trolley").state;
    expect(axis.rate).toBe(0.5);
  });

  it("brakes to a stop exactly on the target", () => {
    let axis = trolley(0, 0, 3);
    for (let i = 0; i < 600 && axis.command !== null; i++) {
      axis = stepAxis(axis, "trolley").state;
    }
    expect(axis.command).toBeNull();
    expect(axis.value).toBe(3);
    expect(axis.rate).toBe(0);
  });

  it("gives each axis its own acceleration", () => {
    expect(AXES.slew.accel).toBe(30);
    expect(AXES.grip.maxRate).toBe(45);
  });
});
