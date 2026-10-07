import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { App } from "./app";

/**
 * What the console arrives at in a real browser.
 *
 * jsdom answers what the console renders and nothing about how it is laid out:
 * it computes no geometry and every box it reports is empty. Everything stated
 * here is something only an engine knows, and the suite runs in each engine
 * `vite.config.ts` names, at each width it names.
 *
 * The console is opened unconfigured, at the gallery's home route, which is
 * what a first visit shows: no backend is set, so nothing is fetched and the
 * page is laid out from the shared gallery's own styles alone. The claim worth
 * holding is that neither width makes the page wider than itself, which is
 * what turns a phone into a sideways scroll.
 */

/** The widths the console is designed for, which `vite.config.ts` states. */
const WIDTHS = [390, 1280];

/** The page this suite's iframe was opened at, restored after each test. */
const OPENED = location.href;

beforeEach(() => {
  localStorage.clear();
  // The router reads the address bar, which under the test runner names the
  // runner's own page: the gallery would show its not-found screen.
  history.replaceState(null, "", "/");
});

afterEach(() => {
  history.replaceState(null, "", OPENED);
});

/** Opens the console and waits for the gallery's links to arrive. */
async function openConsole(): Promise<HTMLElement[]> {
  render(<App />);
  return screen.findAllByRole("link", undefined, { timeout: 10_000 });
}

describe("the console in a browser", () => {
  it("renders at the width its instance declared", async () => {
    await openConsole();

    expect(WIDTHS).toContain(document.documentElement.clientWidth);
  });

  it("lays the gallery's links out where they can be reached", async () => {
    const links = await openConsole();

    // Every box is empty under jsdom, so this says nothing there and
    // everything here: a link the engine gave no box cannot be clicked.
    const boxes = links.map((link) => link.getBoundingClientRect());
    expect(boxes.some((box) => box.width > 0 && box.height > 0)).toBe(true);
  });

  it("keeps the document within its own width", async () => {
    await openConsole();

    const root = document.documentElement;
    expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
  });
});
