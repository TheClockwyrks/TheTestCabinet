// @vitest-environment jsdom
// The board-size contract, driven through the real component tree.
//
// The original defect was not in `resizeBoard` — it was in the WIRING: the W and H
// fields applied their value on their own, so a digit typed on the way past, and
// later merely leaving the field, resized the design and dropped what no longer
// fitted. A unit test of the resize function cannot see that, so these tests type
// into the actual fields, blur them, press the actual buttons, and answer the actual
// dialog.
//
// What is pinned here:
//   • typing changes nothing, however in-range the typing is;
//   • blurring changes nothing — leaving a field is not a decision;
//   • Apply is the only thing that resizes, and asks first when it would cost
//     components, leaving everything untouched when the answer is no;
//   • confirming sets them aside, and a later widening brings them back;
//   • a preset is the same action and goes through the same question;
//   • opening a scenario onto a smaller board sets the overhang aside instead of
//     deleting it.
//
// The wasm engine and the sprite sheet are stubbed out: none of this is about the
// simulation, and loading a 350 KB wasm module per test would be noise.

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../useSimulation", () => ({ useSimulation: () => true }));
vi.mock("../assets", () => ({ CELL: 32, atlas: { cellSize: 32 } }));
vi.mock("../scenarioFiles", () => ({
  listScenarios: vi.fn(),
  readScenario: vi.fn(),
  writeScenario: vi.fn(),
}));

import { App } from "./App";
import { listScenarios, readScenario, writeScenario } from "../scenarioFiles";

const CELL = 32;

/** A belt at `(x, y)`, in the scenario's own wire shape. */
function belt(x: number, y = 1) {
  return { type: "belt", x, y, dir: "E", tier: "fast" };
}

/** The fixtures the mocked dev server serves. */
const FILES: Record<string, unknown> = {
  // Three belts spread across a 12-wide board: a shrink to 6 strands two of them.
  narrow: {
    version: 1,
    grid: { width: 12, height: 8 },
    ticks: 100,
    snapshots: [25, 50, 75, 100],
    entities: [belt(2), belt(7), belt(9)],
  },
  // Wide enough that the Small preset (24×12) strands two of them.
  huge: {
    version: 1,
    grid: { width: 72, height: 40 },
    ticks: 100,
    snapshots: [25, 50, 75, 100],
    entities: [belt(2), belt(60), belt(70)],
  },
};

beforeEach(() => {
  // jsdom has no 2D context; the overlay's redraw is meant to bail out quietly.
  HTMLCanvasElement.prototype.getContext = () => null;
  vi.mocked(listScenarios).mockResolvedValue(
    Object.entries(FILES).map(([name, file]) => {
      const f = file as { grid: { width: number; height: number } };
      return {
        name,
        ticks: 100,
        snapshots: [100],
        grid: f.grid,
        entities: 3,
      };
    }),
  );
  vi.mocked(writeScenario).mockResolvedValue(undefined);
  vi.mocked(readScenario).mockImplementation(async (name: string) => {
    const file = FILES[name];
    if (!file) throw new Error(`no fixture ${name}`);
    return structuredClone(file);
  });
});

// Vitest runs without globals here, so Testing Library's automatic teardown never
// registers itself — without this every test would render a second App beside the
// last one's.
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// --- Reading the screen ----------------------------------------------------

/** The board's real size, read off the canvas the simulation draws into. */
function board(): string {
  const canvas = document.querySelector(".sim-canvas");
  if (!canvas) throw new Error("no board");
  const w = Number(canvas.getAttribute("width")) / CELL;
  const h = Number(canvas.getAttribute("height")) / CELL;
  return `${w}×${h}`;
}

/** How many components are on the board, per the toolbar's own count. */
function onBoard(): number {
  return Number(
    screen.getByText(/^\d+ components$/).textContent?.split(" ")[0],
  );
}

/** How many are set aside, which the toolbar only shows when there are any. */
function setAside(): number {
  const badge = screen.queryByText(/^\+\d+ set aside$/);
  return badge ? Number(badge.textContent?.replace(/\D/g, "")) : 0;
}

const widthField = () =>
  screen.getByLabelText("Board width") as HTMLInputElement;
const heightField = () =>
  screen.getByLabelText("Board height") as HTMLInputElement;
const applyButton = () =>
  screen.getByRole("button", { name: /^Apply/ }) as HTMLButtonElement;
const dialog = () => screen.queryByRole("dialog");

/**
 * Render the app and open one of the fixtures, so there is a design to damage.
 *
 * Opening lands in two commits, not one: the status line these tests waited on comes
 * from the open itself, and the W/H fields resync to the board they were just handed
 * in an effect that commits after it. Waiting only on the status line therefore
 * starts a test on a control still showing the default 24×16 over a 12×8 board —
 * which is a real state of the control for a moment, and not the one any test here
 * means to describe. So the helper's postcondition is the SETTLED control: the
 * fields agree with the board that was opened.
 */
async function open(name: string) {
  render(<App />);
  const picker = await screen.findByRole("combobox");
  await screen.findByRole("option", { name: new RegExp(`^${name} `) });
  fireEvent.change(picker, { target: { value: name } });
  fireEvent.click(screen.getByRole("button", { name: "Open" }));
  await screen.findByText(`opened ${name}.json`);
  const { grid } = FILES[name] as { grid: { width: number; height: number } };
  await waitFor(() => {
    expect(widthField().value).toBe(String(grid.width));
    expect(heightField().value).toBe(String(grid.height));
  });
}

// --- The tests -------------------------------------------------------------

describe("the board-size fields are a draft", () => {
  it("resizes nothing while a replacement width is typed a digit at a time", async () => {
    await open("narrow");
    expect(board()).toBe("12×8");

    // Replacing 12 with 64: "6" lands first, and 6 is a perfectly legal width that
    // would strand two of the three belts.
    fireEvent.change(widthField(), { target: { value: "6" } });
    expect(board()).toBe("12×8");
    expect(onBoard()).toBe(3);
    expect(setAside()).toBe(0);
    expect(dialog()).toBeNull();

    fireEvent.change(widthField(), { target: { value: "64" } });
    expect(board()).toBe("12×8");
    expect(onBoard()).toBe(3);
  });

  it("resizes nothing when the field is left", async () => {
    await open("narrow");
    fireEvent.change(widthField(), { target: { value: "6" } });
    fireEvent.blur(widthField());
    // Blur is not a decision. The field goes on saying 6; the board goes on being 12.
    expect(board()).toBe("12×8");
    expect(onBoard()).toBe(3);
    expect(setAside()).toBe(0);
    expect(dialog()).toBeNull();
    expect(widthField().value).toBe("6");
  });

  it("says so, while the field and the board disagree", async () => {
    await open("narrow");
    fireEvent.change(widthField(), { target: { value: "64" } });
    expect(screen.getByText(/board is 12×8, Apply makes it 64×8/)).toBeTruthy();
  });

  it("refuses to apply a draft that says nothing usable, and says why", async () => {
    await open("narrow");
    fireEvent.change(widthField(), { target: { value: "" } });
    expect(applyButton().disabled).toBe(true);
    expect(screen.getByText(/Board width is required/)).toBeTruthy();
    expect(board()).toBe("12×8");
  });

  it("refuses to apply a draft that is the size the board already is", async () => {
    await open("narrow");
    expect(applyButton().disabled).toBe(true);
    expect(applyButton().title).toBe("The board is already 12×8.");
  });

  it("applies a harmless resize without asking anything", async () => {
    await open("narrow");
    fireEvent.change(widthField(), { target: { value: "64" } });
    fireEvent.click(applyButton());
    await waitFor(() => expect(board()).toBe("64×8"));
    expect(dialog()).toBeNull();
    expect(onBoard()).toBe(3);
    // Applying resyncs the fields, so they never go on claiming a pending size.
    expect(widthField().value).toBe("64");
  });

  it("applies from Enter inside the field, which is the field's submit", async () => {
    await open("narrow");
    fireEvent.change(widthField(), { target: { value: "64" } });
    fireEvent.keyDown(widthField(), { key: "Enter" });
    await waitFor(() => expect(board()).toBe("64×8"));
  });

  it("puts the draft back on Escape without touching the board", async () => {
    await open("narrow");
    fireEvent.change(widthField(), { target: { value: "6" } });
    fireEvent.keyDown(widthField(), { key: "Escape" });
    expect(widthField().value).toBe("12");
    expect(board()).toBe("12×8");
  });
});

describe("a resize that would cost components", () => {
  it("asks first, and leaves everything alone when the answer is no", async () => {
    await open("narrow");
    fireEvent.change(widthField(), { target: { value: "6" } });
    fireEvent.click(applyButton());

    const box = await screen.findByRole("dialog");
    expect(within(box).getByText("Resize to 6×8?")).toBeTruthy();
    expect(
      within(box).getByText(/2 components would be set aside/),
    ).toBeTruthy();
    expect(
      within(box).getByText(/Save and Export do not write them/),
    ).toBeTruthy();
    // The safe answer is what holds focus, so a reflexive Enter cancels.
    expect(document.activeElement).toBe(
      within(box).getByRole("button", { name: "Keep the board as it is" }),
    );

    fireEvent.click(
      within(box).getByRole("button", { name: "Keep the board as it is" }),
    );
    await waitFor(() => expect(dialog()).toBeNull());
    expect(board()).toBe("12×8");
    expect(onBoard()).toBe(3);
    expect(setAside()).toBe(0);
  });

  it("cancels on Escape, which is the same answer", async () => {
    await open("narrow");
    fireEvent.change(widthField(), { target: { value: "6" } });
    fireEvent.click(applyButton());
    await screen.findByRole("dialog");
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(dialog()).toBeNull());
    expect(board()).toBe("12×8");
    expect(onBoard()).toBe(3);
  });

  it("sets them aside on confirm, and gives them back when the board grows", async () => {
    await open("narrow");
    fireEvent.change(widthField(), { target: { value: "6" } });
    fireEvent.click(applyButton());
    const box = await screen.findByRole("dialog");
    fireEvent.click(
      within(box).getByRole("button", { name: /Resize and set them aside/ }),
    );

    await waitFor(() => expect(board()).toBe("6×8"));
    expect(onBoard()).toBe(1);
    expect(setAside()).toBe(2);

    // Growing back over them restores them, and asks nothing to do it.
    fireEvent.change(widthField(), { target: { value: "12" } });
    fireEvent.click(applyButton());
    await waitFor(() => expect(board()).toBe("12×8"));
    expect(dialog()).toBeNull();
    expect(onBoard()).toBe(3);
    expect(setAside()).toBe(0);
  });
});

describe("the presets are the same action", () => {
  it("asks before a preset that would strand components", async () => {
    await open("huge");
    expect(board()).toBe("72×40");

    fireEvent.click(screen.getByRole("button", { name: /^Small 24×12$/ }));
    const box = await screen.findByRole("dialog");
    expect(within(box).getByText("Resize to 24×12?")).toBeTruthy();

    fireEvent.click(
      within(box).getByRole("button", { name: "Keep the board as it is" }),
    );
    await waitFor(() => expect(dialog()).toBeNull());
    expect(board()).toBe("72×40");
    expect(onBoard()).toBe(3);

    fireEvent.click(screen.getByRole("button", { name: /^Small 24×12$/ }));
    const again = await screen.findByRole("dialog");
    fireEvent.click(
      within(again).getByRole("button", { name: /Resize and set them aside/ }),
    );
    await waitFor(() => expect(board()).toBe("24×12"));
    expect(onBoard()).toBe(1);
    expect(setAside()).toBe(2);
  });

  it("applies a preset that costs nothing without asking", async () => {
    await open("narrow");
    fireEvent.click(screen.getByRole("button", { name: /^Small 24×12$/ }));
    await waitFor(() => expect(board()).toBe("24×12"));
    expect(dialog()).toBeNull();
    expect(onBoard()).toBe(3);
    // The fields follow the board rather than going on showing the old size.
    expect(widthField().value).toBe("24");
  });
});

describe("loading a scenario onto a smaller board", () => {
  it("sets the overhang aside instead of deleting it", async () => {
    await open("narrow");
    // Import lays another file's components onto the CURRENT 12×8 board; two of
    // the wide file's three belts fall outside it.
    fireEvent.change(await screen.findByRole("combobox"), {
      target: { value: "huge" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import here" }));

    await screen.findByText(/imported huge\.json/);
    expect(onBoard()).toBe(1);
    expect(setAside()).toBe(2);
    expect(screen.getByText(/are set aside/)).toBeTruthy();

    // And they are recoverable, which is the whole difference from a delete.
    fireEvent.change(widthField(), { target: { value: "72" } });
    fireEvent.click(applyButton());
    await waitFor(() => expect(onBoard()).toBe(3));
    expect(setAside()).toBe(0);
  });
});

describe("saving while components are set aside", () => {
  /** Shrink the open board to 6 wide, stranding two of its three belts. */
  async function strand() {
    fireEvent.change(widthField(), { target: { value: "6" } });
    fireEvent.click(applyButton());
    const box = await screen.findByRole("dialog");
    fireEvent.click(
      within(box).getByRole("button", { name: /Resize and set them aside/ }),
    );
    await waitFor(() => expect(setAside()).toBe(2));
  }

  it("asks before writing a file the set-aside components are missing from", async () => {
    await open("narrow");
    await strand();

    fireEvent.click(screen.getByRole("button", { name: /^Save/ }));
    const box = await screen.findByRole("dialog");
    expect(
      within(box).getByText(/Save narrow\.json without the set-aside/),
    ).toBeTruthy();
    fireEvent.click(within(box).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(dialog()).toBeNull());
    // The file is the only copy that outlives the tab, so a cancel must not have
    // touched it.
    expect(vi.mocked(writeScenario)).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /^Save/ }));
    const again = await screen.findByRole("dialog");
    fireEvent.click(
      within(again).getByRole("button", { name: "Save without them" }),
    );
    await screen.findByText("saved narrow.json");
    expect(vi.mocked(writeScenario)).toHaveBeenCalledTimes(1);
  });

  it("saves without asking when nothing is set aside", async () => {
    await open("narrow");
    fireEvent.change(widthField(), { target: { value: "20" } });
    fireEvent.click(applyButton());
    await waitFor(() => expect(board()).toBe("20×8"));

    fireEvent.click(screen.getByRole("button", { name: /^Save/ }));
    await screen.findByText("saved narrow.json");
    expect(dialog()).toBeNull();
    expect(vi.mocked(writeScenario)).toHaveBeenCalledTimes(1);
  });
});
