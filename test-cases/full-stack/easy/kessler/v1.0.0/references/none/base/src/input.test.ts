// The keyboard beneath the actions (specs/controls.md): held values, press
// edges, the repeat rule, Space carrying two actions, and the overlay key.

import { describe, expect, it } from "vitest";
import { Keyboard } from "./input";

describe("Keyboard", () => {
  it("reports a held action while any of its keys is down", () => {
    const keyboard = new Keyboard();
    expect(keyboard.held("left")).toBe(false);
    keyboard.keyDown("KeyA", false);
    expect(keyboard.held("left")).toBe(true);
    keyboard.keyDown("ArrowLeft", false);
    keyboard.keyUp("KeyA");
    expect(keyboard.held("left")).toBe(true);
    keyboard.keyUp("ArrowLeft");
    expect(keyboard.held("left")).toBe(false);
  });

  it("KeyA does exactly what ArrowLeft does", () => {
    const keyboard = new Keyboard();
    keyboard.keyDown("KeyA", false);
    expect(keyboard.drainEdges()).toContain("left");
  });

  it("arms one edge per press, drained once", () => {
    const keyboard = new Keyboard();
    keyboard.keyDown("Escape", false);
    expect(keyboard.drainEdges()).toEqual(["back"]);
    expect(keyboard.drainEdges()).toEqual([]);
  });

  it("arms no edge for a repeat, but keeps the key held", () => {
    const keyboard = new Keyboard();
    keyboard.keyDown("ArrowRight", false);
    keyboard.drainEdges();
    keyboard.keyDown("ArrowRight", true);
    expect(keyboard.drainEdges()).toEqual([]);
    expect(keyboard.held("right")).toBe(true);
  });

  it("Space carries both confirm and launch", () => {
    const keyboard = new Keyboard();
    keyboard.keyDown("Space", false);
    const edges = keyboard.drainEdges();
    expect(edges).toContain("confirm");
    expect(edges).toContain("launch");
  });

  it("Enter carries confirm alone", () => {
    const keyboard = new Keyboard();
    keyboard.keyDown("Enter", false);
    expect(keyboard.drainEdges()).toEqual(["confirm"]);
  });

  it("claims bound keys and leaves unbound ones to the page", () => {
    const keyboard = new Keyboard();
    expect(keyboard.keyDown("Space", false)).toBe(true);
    expect(keyboard.keyDown("Backquote", false)).toBe(true);
    expect(keyboard.keyDown("KeyZ", false)).toBe(false);
  });

  it("counts overlay toggles apart from the actions", () => {
    const keyboard = new Keyboard();
    keyboard.keyDown("Backquote", false);
    keyboard.keyDown("Backquote", true); // auto-repeat does not flutter it
    keyboard.keyDown("Backquote", false);
    expect(keyboard.drainOverlayToggles()).toBe(2);
    expect(keyboard.drainOverlayToggles()).toBe(0);
    expect(keyboard.drainEdges()).toEqual([]);
  });

  it("runs the first-press handler exactly once", () => {
    const keyboard = new Keyboard();
    let presses = 0;
    keyboard.onFirstPress(() => {
      presses += 1;
    });
    keyboard.keyDown("Space", false);
    keyboard.keyDown("KeyA", false);
    expect(presses).toBe(1);
  });

  it("forgets every held key on releaseAll", () => {
    const keyboard = new Keyboard();
    keyboard.keyDown("KeyA", false);
    keyboard.keyDown("KeyD", false);
    keyboard.releaseAll();
    expect(keyboard.held("left")).toBe(false);
    expect(keyboard.held("right")).toBe(false);
  });

  it("routes real keyboard events through attach", () => {
    const keyboard = new Keyboard();
    const target = new EventTarget();
    keyboard.attach(target);
    const down = new Event("keydown") as KeyboardEvent;
    Object.assign(down, { code: "KeyD", repeat: false });
    target.dispatchEvent(down);
    expect(keyboard.held("right")).toBe(true);
    expect(keyboard.drainEdges()).toEqual(["right"]);
    const up = new Event("keyup") as KeyboardEvent;
    Object.assign(up, { code: "KeyD" });
    target.dispatchEvent(up);
    expect(keyboard.held("right")).toBe(false);
    keyboard.release();
    target.dispatchEvent(down);
    expect(keyboard.held("right")).toBe(false);
  });
});
