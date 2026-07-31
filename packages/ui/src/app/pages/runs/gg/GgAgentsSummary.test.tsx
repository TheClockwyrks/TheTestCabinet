// The gg Agents tab's opened detail — the read-out behind one collapsible agent row.
//
// Two things here are worth pinning against regression, and neither is visible from the
// component's props.
//
// The first is the *order* the six sections appear in. It is a reading order, not a list:
// the summed figures lead, the Tokens and Cost widgets that decompose two of those figures
// follow them immediately, and the three "what filled the windows" sections come after. A
// refactor that reorders JSX is free to break that silently, so it is asserted directly.
//
// The second is that a module row is clickable *as a whole* while still containing buttons
// of its own. It cannot be a wrapping `<button>`, for the simple reason that a `<button>`
// may not contain a `<button>`, so the target is split by input device: the mouse gets the
// row's own `onClick` and the keyboard gets an overlaid, `pointer-events: none` button that
// is only ever fired by activation. Four things about that shape are asserted here, because
// each of them was once wrong in a way nothing else would have caught:
//
//   - "the whole row" means the *whole* row, including the deepest branch it renders — an
//     agent-scoped store's framed read-out, which is most of the row's height;
//   - a click on a control inside the row does that control's job and not the row's;
//   - the overlay is still a tab stop that navigates when activated, and nothing is nested
//     inside it (the invalid-HTML shape a wrapper would have had);
//   - a row with nowhere to go has no target of either kind and none of the affordances.

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  GgAgentConfig,
  GgAgentModule,
  GgCapabilitySet,
  GgModuleKind,
  GgTelemetryEvent,
  GgTelemetryKind,
} from "@test-cabinet/run-record/gg";
import type { HarnessEvent } from "../../../../client/types";
import { GgAgentsSummary } from "./GgAgentsSummary";
import { GgExplorerNavContext, type GgExplorerNav } from "./GgExplorerNav";
import { reduceGgEvents, reduceGgEventsPerAgent } from "./useGgRunState";

const TS = "2026-07-29T00:00:00Z";

function gg(
  agentId: string,
  kind: GgTelemetryKind,
  parentAgentId?: string,
): HarnessEvent {
  return {
    type: "gg",
    timestamp: TS,
    event: {
      timestamp: TS,
      sessionId: "s1",
      agentId,
      parentAgentId,
      ...kind,
    } as GgTelemetryEvent,
  };
}

/** One row of an instance's module roster — a private, owned, writable store by default. */
function held(
  kind: GgModuleKind,
  moduleId: string,
  overrides: Partial<GgAgentModule> = {},
): GgAgentModule {
  return {
    kind,
    moduleId,
    enabled: true,
    ownership: "owned",
    origin: "created",
    writable: true,
    ...overrides,
  };
}

function profile(name: string, capabilities: string[]): GgAgentConfig {
  return {
    name,
    modelId: "vendor/small",
    capabilities: capabilities.map((id) => ({ id, enabled: true, params: {} })),
  } as GgAgentConfig;
}

// One root and two reviewers. The reviewers are the row every case here opens, and their
// two module kinds are deliberately *different* branches a row can render: the `board` all
// three instances hold at once reaches outside the profile and so renders as a store list —
// with a store id and a holder chip of its own inside the row — while the `memories` are
// whatever `memoriesId` makes them.
//
// Parameterized on exactly that, because the two answers are the two remaining branches: a
// store per instance (the per-instance branch, which is the one that used to carry the
// "Compare in Modules" button) or one store the whole profile binds at once (the agent-scoped
// branch, a framed read-out with a whole module header and its contents inside it — by far
// the tallest thing a row can hold, and the distribution readers most want to compare).
function runEvents(memoriesId: (instance: string) => string): HarnessEvent[] {
  return [
    gg("root", {
      type: "agent_spawned",
      slot: "Root",
      modelId: "vendor/big",
      depth: 0,
    } as GgTelemetryKind),
    gg("root", {
      type: "agent_modules",
      modules: [held("board", "board-1")],
    } as GgTelemetryKind),
    gg("root", { type: "turn_started" } as GgTelemetryKind),
    ...["r1", "r2"].flatMap((id) => [
      gg(
        id,
        {
          type: "agent_spawned",
          slot: "reviewer",
          modelId: "vendor/small",
          depth: 1,
        } as GgTelemetryKind,
        "root",
      ),
      gg(
        id,
        {
          type: "agent_modules",
          modules: [
            held("memories", memoriesId(id)),
            held("board", "board-1", { origin: "run" }),
          ],
        } as GgTelemetryKind,
        "root",
      ),
      gg(id, { type: "turn_started" } as GgTelemetryKind),
      gg(id, {
        type: "usage",
        slot: "reviewer",
        modelId: "vendor/small",
        tokens: {
          uncachedInput: 900,
          cachedInput: 100,
          output: 40,
          reasoning: 10,
        },
      } as GgTelemetryKind),
      gg(id, {
        type: "tool_call",
        name: "read_file",
        args: { path: "src/main.rs" },
      } as GgTelemetryKind),
    ]),
  ];
}

const EVENTS = runEvents((id) => `mem-${id}`);
const SHARED_EVENTS = runEvents(() => "mem-shared");

const CAPABILITIES: GgCapabilitySet = {
  agents: [profile("Root", ["board"]), profile("reviewer", ["memories"])],
} as GgCapabilitySet;

/** A nav channel that records where it was sent, with every destination the panels offer. */
function stubNav(overrides: Partial<GgExplorerNav> = {}): GgExplorerNav {
  return {
    openAgent: vi.fn(),
    openModule: vi.fn(),
    openModuleKind: vi.fn(),
    openProfile: vi.fn(),
    openProject: vi.fn(),
    ...overrides,
  };
}

/**
 * Render the panel over `events` and open the reviewer's row, returning the nav stub and the
 * opened detail region — which is what every case below is about.
 *
 * `nav: null` renders with no provider at all, the state a panel mounted outside the
 * explorers is in.
 */
function openReviewer(
  nav: GgExplorerNav | null = stubNav(),
  events: HarnessEvent[] = EVENTS,
) {
  const derived = reduceGgEvents(events);
  const perAgent = reduceGgEventsPerAgent(events);
  const panel = (
    <GgAgentsSummary
      capabilitySet={CAPABILITIES}
      agentForest={derived.agentForest}
      perAgent={perAgent}
      transitions={derived.transitions}
      moduleSnapshots={derived.moduleSnapshots}
    />
  );
  render(
    <GgExplorerNavContext.Provider value={nav}>
      {panel}
    </GgExplorerNavContext.Provider>,
  );
  fireEvent.click(screen.getByText("reviewer").closest("button")!);
  return {
    nav,
    detail: screen.getByRole("region", { name: "reviewer detail" }),
  };
}

// The label each section leads with, in the order the detail is meant to read. Matched
// against exact leaf text so the lowercase figure labels on the closed row ("tokens",
// "cost each") cannot stand in for a section's own heading.
const SECTION_LABELS: ReadonlyArray<readonly [string, RegExp]> = [
  ["figures", /^calls per response$/],
  ["tokens", /^Tokens$/],
  ["cost", /^Cost$/],
  ["modules", /^Modules · \d+$/],
  ["context", /^Context spend$/],
  ["tools", /^Tools · [\d,]+ calls$/],
];

/** The detail's sections, named, in the order they actually appear in the DOM. */
function sectionOrder(detail: HTMLElement): string[] {
  const seen: string[] = [];
  for (const node of Array.from(detail.querySelectorAll("span"))) {
    const text = node.textContent?.trim() ?? "";
    const hit = SECTION_LABELS.find(([, pattern]) => pattern.test(text));
    if (hit && !seen.includes(hit[0])) seen.push(hit[0]);
  }
  return seen;
}

describe("GgAgentsSummary detail", () => {
  it("reads figures, tokens, cost, modules, context spend, then tools", () => {
    const { detail } = openReviewer();
    expect(sectionOrder(detail)).toEqual([
      "figures",
      "tokens",
      "cost",
      "modules",
      "context",
      "tools",
    ]);
  });

  it("states the sharing distribution per row rather than in a preamble", () => {
    const { detail } = openReviewer();
    // The paragraph that used to sit above the module list explained agent-scoped versus
    // per-instance stores a third time; each row's badge and sentence already say it.
    expect(
      within(detail).queryByText(/no one rendering of those would be true/),
    ).toBeNull();
    // What replaced it is nothing: the sentence a row states for itself is still there.
    expect(
      within(detail).getByText(/every instance's memories is its own/),
    ).toBeInTheDocument();
  });
});

describe("GgAgentsSummary module rows", () => {
  it("makes every module row the way through to that kind in Modules", () => {
    const { nav, detail } = openReviewer();
    // Both branches, not just the per-instance one that used to carry a button.
    for (const [kind, label] of [
      ["memories", "Compare memories across instances in Modules"],
      ["board", "Compare board across instances in Modules"],
    ] as const) {
      const row = within(detail).getByRole("region", {
        name: `reviewer ${kind}`,
      });
      fireEvent.click(within(row).getByRole("button", { name: label }));
      expect(nav!.openModuleKind).toHaveBeenCalledWith(kind);
    }
    // And the button that used to do this for one branch is gone.
    expect(
      within(detail).queryByRole("button", { name: "Compare in Modules" }),
    ).toBeNull();
  });

  it("navigates from a click anywhere in the row, not only off its own text", () => {
    // The row itself carries the mouse handler, so the prose in it is target too — the
    // sharing sentence, the facts line, the counts. A hit area that was only the strip the
    // overlay could reach would light the whole row on hover and then do nothing over most
    // of it.
    const { nav, detail } = openReviewer();
    const row = within(detail).getByRole("region", {
      name: "reviewer memories",
    });
    for (const text of [
      /every instance's memories is its own/,
      /2 stores · 2 of 2 instances/,
      /never written to|all 2 stores in use/,
    ]) {
      (nav!.openModuleKind as ReturnType<typeof vi.fn>).mockClear();
      fireEvent.click(within(row).getByText(text));
      expect(nav!.openModuleKind).toHaveBeenCalledTimes(1);
      expect(nav!.openModuleKind).toHaveBeenCalledWith("memories");
    }
  });

  it("covers the agent-scoped branch, which is most of a row's height", () => {
    // The branch that renders a whole module header and its contents — the tallest thing a
    // row can hold, and the distribution whose comparison this exit exists for. It used to
    // be raised clear of the overlay wholesale, which meant the one row a reader most wanted
    // to click through was the one row that mostly could not be clicked.
    const { nav, detail } = openReviewer(stubNav(), SHARED_EVENTS);
    const row = within(detail).getByRole("region", {
      name: "reviewer memories",
    });
    const scoped = within(row).getByRole("region", {
      name: "reviewer agent-scoped memories",
    });
    for (const target of [scoped, within(scoped).getByText(/^Agent-scoped/)]) {
      (nav!.openModuleKind as ReturnType<typeof vi.fn>).mockClear();
      fireEvent.click(target);
      expect(nav!.openModuleKind).toHaveBeenCalledWith("memories");
    }
  });

  it("leaves the row's own controls to do their own job", () => {
    // A store id opens *that store*, a holder chip opens *that instance* — the two exits the
    // row exists to keep working, and the reason it is not a wrapping `<button>`.
    const { nav, detail } = openReviewer();
    const row = within(detail).getByRole("region", { name: "reviewer board" });

    fireEvent.click(within(row).getByRole("button", { name: "board-1" }));
    expect(nav!.openModule).toHaveBeenCalledWith("board-1");
    fireEvent.click(within(row).getByRole("button", { name: "r1" }));
    expect(nav!.openAgent).toHaveBeenCalledWith("r1", {
      kind: "module",
      module: "board",
    });
    // Neither of them was also read as a click on the row: two navigations from one click
    // is the defect a naive row handler has.
    expect(nav!.openModuleKind).not.toHaveBeenCalled();
  });

  it("keeps the overlay a tab stop that activates, with nothing nested inside it", () => {
    const { nav, detail } = openReviewer();
    const row = within(detail).getByRole("region", { name: "reviewer board" });
    const overlay = within(row).getByRole("button", {
      name: "Compare board across instances in Modules",
    });
    const buttons = within(row).getAllByRole("button");
    const nested = buttons.filter((button) => button !== overlay);
    // The store id and its three holder chips: a real store list, so the nesting this
    // pattern exists to avoid would actually bite.
    expect(nested.length).toBeGreaterThan(1);

    // Nothing is *inside* the overlay — that is the invalid-HTML shape a wrapping button
    // would have produced, and the one the browser is free to resolve by dropping the
    // inner controls.
    for (const button of nested) {
      expect(overlay.contains(button)).toBe(false);
    }

    // Tab order: the overlay leads the row (it is its first child), and every control in
    // it is still in the sequential order rather than being pulled out of it.
    expect(buttons[0]).toBe(overlay);
    for (const button of buttons) {
      expect(button.tabIndex).toBe(0);
      button.focus();
      expect(document.activeElement).toBe(button);
    }

    // The overlay is `pointer-events: none`, so it is only ever fired the way a keyboard
    // fires it — activation, which dispatches a click on the element itself. It must reach
    // the Modules tab exactly once: the same click bubbles to the row's own handler, and a
    // handler that did not exempt it would navigate twice.
    overlay.focus();
    overlay.click();
    expect(nav!.openModuleKind).toHaveBeenCalledTimes(1);
    expect(nav!.openModuleKind).toHaveBeenCalledWith("board");
  });

  it("lets go of a text selection without navigating", () => {
    // Releasing a drag across the prose fires a click on the row. The divergence notes and
    // the sharing sentence are the longest, most quotable text on the panel, and a row that
    // jumped tabs the instant a selection was let go would be a row nobody could copy.
    const { nav, detail } = openReviewer();
    const row = within(detail).getByRole("region", {
      name: "reviewer memories",
    });
    const sentence = within(row).getByText(
      /every instance's memories is its own/,
    );
    const selection = vi.spyOn(window, "getSelection").mockReturnValue({
      toString: () => sentence.textContent ?? "",
    } as unknown as Selection);
    try {
      fireEvent.click(sentence);
      expect(nav!.openModuleKind).not.toHaveBeenCalled();
    } finally {
      selection.mockRestore();
    }
    // …and the very next click, with nothing selected, still goes.
    fireEvent.click(sentence);
    expect(nav!.openModuleKind).toHaveBeenCalledWith("memories");
  });

  it("leaves the row inert when there is no Modules tab to reach", () => {
    // `openModuleKind` is absent for a run whose profiles enable no module-backed
    // capability — there is nowhere to go, and a row promising otherwise would be a dead
    // click over the row's own text.
    const { nav, detail } = openReviewer(
      stubNav({ openModuleKind: undefined }),
    );
    const row = within(detail).getByRole("region", {
      name: "reviewer memories",
    });
    expect(within(row).queryByRole("button")).toBeNull();
    expect(row).not.toHaveAttribute("data-clickable");
    // Not merely unlabelled: clicking it does nothing at all, on the row and in it.
    fireEvent.click(row);
    fireEvent.click(
      within(row).getByText(/every instance's memories is its own/),
    );
    expect(nav!.openAgent).not.toHaveBeenCalled();
    expect(nav!.openModule).not.toHaveBeenCalled();
  });

  it("renders no overlay at all outside the explorers", () => {
    const { detail } = openReviewer(null);
    const row = within(detail).getByRole("region", { name: "reviewer board" });
    expect(
      within(row).queryByRole("button", { name: /Compare board/ }),
    ).toBeNull();
    expect(row).not.toHaveAttribute("data-clickable");
    // No handler either — with no nav channel there is nothing for a click to do, and the
    // row must not throw trying.
    expect(() => fireEvent.click(row)).not.toThrow();
  });
});
