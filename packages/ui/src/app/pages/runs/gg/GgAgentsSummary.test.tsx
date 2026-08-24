// The gg Agents tab's opened detail — the read-out behind one collapsible agent row.
//
// Three things here are worth pinning against regression, and none is visible from the
// component's props.
//
// The first is the *order* the six sections appear in. It is a reading order, not a list:
// the summed figures lead, the Tokens and Cost widgets that decompose two of those figures
// follow them immediately, and the three "what filled the windows" sections come after. A
// refactor that reorders JSX is free to break that silently, so it is asserted directly.
//
// The second is the offered surface: what the agent *could* call, as against what it did.
// The section is only meaningful in the contrasts it draws — a tool offered and not used
// must stay in the list and read differently from one that was called, an entry only some of
// the profile's instances were offered must say so rather than being folded in with the rest,
// and a profile no instance has reported a surface for must produce no section at all rather
// than an empty one claiming the agent was offered nothing. Each of those is asserted below,
// because each of them looks fine on screen when it is wrong.
//
// The third is that a module row is clickable *as a whole* while still containing buttons
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
  GgAgentApi,
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

// A configured profile as a *recorded* set carries one: launching resolved the internal ids
// away, so the `slug` is what every reference to it — a spawn's attribution, a module's
// holder, an open row — is keyed by; the `name` is the prose the panel prints.
function profile(
  slug: string,
  name: string,
  capabilities: string[],
): GgAgentConfig {
  return {
    slug,
    name,
    modelId: "vendor/small",
    capabilities: capabilities.map((id) => ({ id, enabled: true, params: {} })),
  };
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
      profileId: "root",
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
          profileId: "reviewer",
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
        profileId: "reviewer",
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

// The base run plus one reviewer instance's message log: a file view and an agent-composed
// text view, both resident for the one turn that reports usage against them. Only the
// context-spend section reads any of this.
const VIEW_EVENTS: HarnessEvent[] = [
  ...EVENTS,
  gg("r1", {
    type: "context_message",
    id: "m-file",
    role: "tool",
    content: "fn main() {}",
    toolCalls: [],
    images: [],
    tokens: 200,
    label: "src/main.rs",
  } as GgTelemetryKind),
  gg("r1", {
    type: "context_message",
    id: "m-notes",
    role: "user",
    content: "View: changed-files\n----\nsrc/main.rs",
    toolCalls: [],
    images: [],
    tokens: 600,
    label: "changed-files",
  } as GgTelemetryKind),
  gg("r1", {
    type: "prompt",
    request: [
      { id: "m-file", source: "file_view" },
      { id: "m-notes", source: "text_view" },
    ],
    totalTokens: 800,
    finishReason: "stop",
    tokens: { uncachedInput: 800 },
  } as GgTelemetryKind),
];

/**
 * What one instance was OFFERED — the event the offered-surface section is built out of.
 * Passing APIs makes it a responses-as-code instance, which is the only thing that decides
 * whether its profile reads as tools or as APIs. gg populates exactly one of the two — an
 * instance has one surface — so the fixtures below that name BOTH are deliberate: they are
 * the proof that the mode is conclusive on its own, and that no tool name can reach an API
 * profile even when one is sitting in the same event.
 */
function offered(
  agentId: string,
  tools: string[],
  apis?: GgAgentApi[],
  /** The documentation arm this instance ran under, where the fixture is about that. */
  docViewTypes?: string,
): HarnessEvent {
  return gg(agentId, {
    type: "agent_surface",
    executionMode: apis ? "responses_as_code" : "tool_calling",
    tools,
    ...(apis ? { apis } : {}),
    ...(docViewTypes ? { docViewTypes } : {}),
  } as GgTelemetryKind);
}

// The base run plus both reviewers' offered tools. Deliberately three kinds of entry in one
// profile: one the instances called (`read_file`, once each), one they were given and never
// touched, and one only `r1` was ever offered — the shape an FSM-gated call has, and the one
// a union across instances must not average away.
const TOOL_SURFACE_EVENTS: HarnessEvent[] = [
  ...EVENTS,
  offered("r1", ["read_file", "write_file", "transition_state"]),
  offered("r2", ["read_file", "write_file"]),
];

// One model-facing call, as a responses-as-code program's turn streams it. gg's operation
// id is the whole of what the wire carries, and it is what every count joins on.
function apiCall(agentId: string, operation: string): HarnessEvent {
  return gg(agentId, { type: "api_call", operation } as GgTelemetryKind);
}

// The same run with both reviewers running programs instead: one module, whose functions
// cover both cases — one each instance called, and one neither did.
const API_SURFACE_EVENTS: HarnessEvent[] = [
  ...EVENTS,
  ...["r1", "r2"].flatMap((id) => [
    offered(
      id,
      ["read_file"],
      [
        {
          module: "files",
          path: "gg.files",
          description: "the run's working tree",
          functions: [
            { name: "readFile", operation: "files.read_file" },
            { name: "watch", operation: "files.watch" },
          ],
        },
      ] as GgAgentApi[],
      "return+parameters+errors",
    ),
    apiCall(id, "files.read_file"),
  ]),
];

// The same again, over the two functions that share one core: `files.readFile` and
// `views.openFile` both run a `read_file`, and each is recorded as itself. Both reviewers
// wrote `views.openFile` and neither wrote the other, so a profile that read every file
// through one of them must not be reported as having called the rest.
const SHARED_CORE_EVENTS: HarnessEvent[] = [
  ...EVENTS,
  ...["r1", "r2"].flatMap((id) => [
    offered(id, ["read_file"], [
      {
        module: "files",
        path: "gg.files",
        description: "the run's working tree",
        functions: [{ name: "readFile", operation: "files.read_file" }],
      },
      {
        module: "views",
        path: "gg.views",
        description: "show yourself a file",
        functions: [{ name: "openFile", operation: "views.open_file" }],
      },
    ] as GgAgentApi[]),
    apiCall(id, "views.open_file"),
  ]),
];

const CAPABILITIES: GgCapabilitySet = {
  agents: [
    profile("root", "Root", ["board"]),
    profile("reviewer", "Reviewer", ["memories"]),
  ],
};

// A configuration that names two of its arms alike, with one instance each. Two profiles
// under one name is what a within-run A/B of a reviewer against itself looks like, and
// nothing forbids it: names are prose, and only the slugs below tell the two arms apart.
const SHARED_NAME_CAPABILITIES: GgCapabilitySet = {
  agents: [
    profile("root", "Root", ["board"]),
    profile("reviewer", "Reviewer", ["memories"]),
    profile("reviewer-2", "Reviewer", ["memories"]),
  ],
};

const SHARED_NAME_EVENTS: HarnessEvent[] = [
  gg("root", {
    type: "agent_spawned",
    profileId: "root",
    modelId: "vendor/big",
    depth: 0,
  } as GgTelemetryKind),
  ...(
    [
      ["r1", "reviewer"],
      ["r2", "reviewer-2"],
    ] as const
  ).flatMap(([id, profileId]) => [
    gg(
      id,
      {
        type: "agent_spawned",
        profileId,
        modelId: "vendor/small",
        depth: 1,
      } as GgTelemetryKind,
      "root",
    ),
    gg(id, { type: "turn_started" } as GgTelemetryKind),
  ]),
];

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
 * The panel over `events`, with every row still closed.
 *
 * The configuration goes to the reduction as well as to the panel: it is the only thing
 * that turns the profile ids the stream attributes work to into the names a reader sees.
 *
 * `nav: null` renders with no provider at all, the state a panel mounted outside the
 * explorers is in.
 */
function renderPanel(
  nav: GgExplorerNav | null,
  events: HarnessEvent[],
  capabilitySet: GgCapabilitySet,
) {
  const derived = reduceGgEvents(events, capabilitySet);
  const perAgent = reduceGgEventsPerAgent(events, capabilitySet);
  const panel = (
    <GgAgentsSummary
      capabilitySet={capabilitySet}
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
}

/**
 * Render the panel and open the reviewer's row, returning the nav stub and the opened
 * detail region — which is what every case below is about.
 */
function openReviewer(
  nav: GgExplorerNav | null = stubNav(),
  events: HarnessEvent[] = EVENTS,
  capabilitySet: GgCapabilitySet = CAPABILITIES,
) {
  renderPanel(nav, events, capabilitySet);
  fireEvent.click(screen.getByText("Reviewer").closest("button")!);
  return {
    nav,
    detail: screen.getByRole("region", { name: "Reviewer detail" }),
  };
}

// The label each section leads with, in the order the detail is meant to read. Matched
// against exact leaf text so the lowercase figure labels on the closed row ("tokens",
// "cost each") cannot stand in for a section's own heading.
const SECTION_LABELS: ReadonlyArray<readonly [string, RegExp]> = [
  ["surface", /^(Tools · \d+ offered|APIs · \d+ objects?)$/],
  ["figures", /^calls per response$/],
  ["tokens", /^Tokens$/],
  ["cost", /^Cost$/],
  ["modules", /^Modules · \d+$/],
  ["context", /^Context spend$/],
  // The observed-usage section, headed for the surface the profile called on — the same
  // alternation the offered-surface row above it already carries.
  ["calls", /^(Tool calls|API calls) · [\d,]+$/],
];

/**
 * The chip one offered thing renders as, found from the name it reads by. Its own hover text
 * is what identifies it: the name sits in a bare span inside the chip, and class names are a
 * stylesheet's business rather than a contract to assert against.
 */
function chip(section: HTMLElement, name: string): HTMLElement {
  return within(section).getByText(name).closest("span[title]")!;
}

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

describe("GgAgentsSummary agent list", () => {
  it("keeps two profiles that share a name in rows of their own", () => {
    // The panel groups a run's instances by the profile they ran under, and that grouping is
    // by slug — the one name a run stamps on every event it records. On the display name,
    // the two arms of this A/B would fold into one row carrying both instances and the sum
    // of their figures — the one reading that answers neither of the questions the A/B was
    // set up to ask.
    renderPanel(stubNav(), SHARED_NAME_EVENTS, SHARED_NAME_CAPABILITIES);
    expect(screen.getByText("Agents · 3")).toBeInTheDocument();
    const rows = screen
      .getAllByText("Reviewer")
      .map((node) => node.closest("li")!);
    expect(rows).toHaveLength(2);
    // Each says which arm it is, because its name no longer can.
    expect(within(rows[0]!).getByTitle(/profile id/)).toHaveTextContent(
      /^reviewer$/,
    );
    expect(within(rows[1]!).getByTitle(/profile id/)).toHaveTextContent(
      /^reviewer-2$/,
    );
    // The root's name collides with nothing, so its row is left as prose alone: the slug is
    // shown where it is needed to read the list, not as a second label on every row.
    expect(
      within(screen.getByText("Root").closest("li")!).queryByTitle(
        /profile id/,
      ),
    ).toBeNull();

    // And opening one opens THAT one. Rows tracked by name would open both at once, and
    // the panel would answer a question about one arm with two arms' detail.
    fireEvent.click(within(rows[0]!).getByRole("button"));
    const opened = screen.getAllByRole("region", { name: "Reviewer detail" });
    expect(opened).toHaveLength(1);
    expect(
      within(opened[0]!).getByRole("button", { name: /^Open r1 ·/ }),
    ).toBeInTheDocument();
  });
});

describe("GgAgentsSummary detail", () => {
  it("reads figures, tokens, cost, modules, context spend, then the calls made", () => {
    const { detail } = openReviewer();
    expect(sectionOrder(detail)).toEqual([
      "figures",
      "tokens",
      "cost",
      "modules",
      "context",
      "calls",
    ]);
  });

  it("leads with the instances that ran, ahead of what they were configured as", () => {
    // The instances are the concrete thing the row was opened to reach — every figure under
    // them is a sum over them, and each chip is the way into that one instance's explorer —
    // so they come before the capability chips that say what the arm asked for. Reading the
    // configuration first left a reader scrolling past it to find the instance they came
    // for.
    const { detail } = openReviewer();
    const instance = within(detail).getByRole("button", {
      name: /^Open r1 ·/,
    });
    const capability = within(detail).getByText("memories");
    expect(
      instance.compareDocumentPosition(capability) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("opens the context spend on Views and tells the two kinds of view apart", () => {
    // The reading covers both kinds of view an agent can open — a file it asked to see and a
    // value it composed and showed itself — because both are material it CHOSE to keep
    // resident. A label is not self-identifying (an agent may label a view `src/main.rs`), so
    // the agent-composed one says which it is.
    const { detail } = openReviewer(stubNav(), VIEW_EVENTS);
    const spend = within(detail).getByText("Context spend").closest("section")!;
    expect(within(spend).getByRole("radio", { name: "Views" })).toBeChecked();
    expect(within(spend).getByText("changed-files")).toBeInTheDocument();
    expect(within(spend).getByText(/^agent view ·/)).toBeInTheDocument();
    // The file view is in the same list, ranked against it, and is not marked.
    expect(within(spend).getByText("src/main.rs")).toBeInTheDocument();
    expect(within(spend).getAllByText(/^agent view ·/)).toHaveLength(1);
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

describe("GgAgentsSummary offered surface", () => {
  it("heads a tool-calling profile's surface Tools", () => {
    // Tools and APIs are the same reading of two differently-shaped turns, and nothing but
    // the instances' own reported mode can tell them apart — the capability set says what
    // was asked for, not what gg resolved.
    const { detail } = openReviewer(stubNav(), TOOL_SURFACE_EVENTS);
    expect(
      within(detail).getByRole("region", { name: "Reviewer tools" }),
    ).toBeInTheDocument();
    expect(within(detail).getByText("Tools · 3 offered")).toBeInTheDocument();
    expect(within(detail).queryByText(/^APIs ·/)).toBeNull();
    // And it leads the detail, beside the capability chips that asked for it, rather than
    // arriving after everything the instances did with it.
    expect(sectionOrder(detail)[0]).toBe("surface");
  });

  it("heads a responses-as-code profile's surface APIs, by module", () => {
    const { detail } = openReviewer(stubNav(), API_SURFACE_EVENTS);
    const section = within(detail).getByRole("region", {
      name: "Reviewer apis",
    });
    expect(within(detail).getByText("APIs · 1 module")).toBeInTheDocument();
    expect(within(detail).queryByText(/^Tools · /)).toBeNull();
    // The module is named by the arm's own spelling of it — what the programs wrote — with
    // the description those programs are shown it by, and the functions it binds under it.
    expect(within(section).getByText("gg.files")).toBeInTheDocument();
    expect(
      within(section).getByText("the run's working tree"),
    ).toBeInTheDocument();
    expect(within(section).getByText("readFile")).toBeInTheDocument();
  });

  it("names the documentation arm on the surface card the cost is read beside", () => {
    // The documentation mode is the CAUSE whose effect this detail's documentation figures
    // are, and the profile card is where a reader compares two arms of a within-run A/B. The
    // aggregate has always folded the mode; nothing rendered it, so the card showed the cost
    // with no arm on it.
    const { detail } = openReviewer(stubNav(), API_SURFACE_EVENTS);
    const mode = within(detail).getByText("docs: return+parameters+errors");
    expect(mode).toBeInTheDocument();
    expect(mode).toHaveAttribute(
      "title",
      expect.stringContaining("the types its arguments declare"),
    );
  });

  it("says nothing about a documentation mode on a tool-calling profile", () => {
    // A tool-calling agent makes no documentation lookups, so naming a mode would report an
    // arm it never ran under rather than the absence of one.
    const { detail } = openReviewer(stubNav(), TOOL_SURFACE_EVENTS);
    expect(within(detail).queryByText(/^docs: /)).toBeNull();
  });

  it("keeps an offered tool nobody called, and says so", () => {
    // The whole reason the section exists: `write_file` appears nowhere in what the agent
    // *did*, so without this a tool it was handed and ignored is indistinguishable from one
    // it was never given.
    const { detail } = openReviewer(stubNav(), TOOL_SURFACE_EVENTS);
    const section = within(detail).getByRole("region", {
      name: "Reviewer tools",
    });
    const uncalled = chip(section, "write_file");
    expect(uncalled).toHaveAttribute("data-uncalled");
    expect(uncalled).toHaveAttribute(
      "title",
      "write_file was offered, 0 calls — this agent was bound to it and did not use it, which is a different finding from one it was not offered.",
    );
    expect(within(uncalled).getByText("0×")).toBeInTheDocument();

    // …against the tool that was called, which is the same chip undimmed and carrying the
    // count both instances contributed to.
    const called = chip(section, "read_file");
    expect(called).not.toHaveAttribute("data-uncalled");
    expect(within(called).getByText("2×")).toBeInTheDocument();

    // The legend is only printed where the section actually dims something.
    expect(
      within(section).getByText(/Dimmed entries read a real 0×/),
    ).toBeInTheDocument();
  });

  it("marks an entry only some instances were offered rather than averaging it away", () => {
    // Two instances of one profile can honestly differ — an FSM state gates the transition
    // call — so the union states how much of the profile each entry covers.
    const { detail } = openReviewer(stubNav(), TOOL_SURFACE_EVENTS);
    const section = within(detail).getByRole("region", {
      name: "Reviewer tools",
    });
    const partial = chip(section, "transition_state");
    expect(within(partial).getByText("1/2")).toBeInTheDocument();
    expect(partial.getAttribute("title")).toMatch(
      /Offered to 1 of the 2 instances that reported a surface/,
    );
    expect(partial.getAttribute("title")).toMatch(/state machine/);
    // A tool both of them held carries no fraction at all — the normal case must stay quiet.
    expect(
      within(chip(section, "read_file")).queryByText(/^\d+\/\d+$/),
    ).toBeNull();
  });

  it("counts every offered function on its own operation, called or not", () => {
    // The accounting joins on gg's operation id and on nothing else, so every function the
    // profile was offered gets a figure. There is no second class of function here — the
    // tool vocabulary decides nothing on this surface, so a function it has no counterpart
    // for is not "unbacked", it is simply a call, counted like any other.
    const { detail } = openReviewer(stubNav(), API_SURFACE_EVENTS);
    const section = within(detail).getByRole("region", {
      name: "Reviewer apis",
    });
    const uncalled = chip(section, "watch");
    expect(within(uncalled).getByText("0×")).toBeInTheDocument();
    expect(uncalled).toHaveAttribute("data-uncalled");
    expect(uncalled).toHaveAttribute(
      "title",
      "gg.files.watch was offered, 0 calls — this agent was bound to it and did not use it, which is a different finding from one it was not offered.",
    );
    // …and the one both instances called reads as its own figure, on its own identity.
    expect(
      within(chip(section, "readFile")).getByText("2×"),
    ).toBeInTheDocument();
    // No gg tool name reaches a responses-as-code profile's API surface.
    expect(within(section).queryByText("read_file")).toBeNull();
  });

  it("counts two functions over one core as two functions", () => {
    // `files.readFile` and `views.openFile` both run a `read_file`. Both reviewers wrote
    // `views.openFile` and neither wrote the other, so claiming the tool's figure for each in
    // turn would report four calls where two happened — and would leave a function the model
    // genuinely never wrote reading as one it used.
    const { detail } = openReviewer(stubNav(), SHARED_CORE_EVENTS);
    const section = within(detail).getByRole("region", {
      name: "Reviewer apis",
    });

    const called = chip(section, "openFile");
    expect(within(called).getByText("2×")).toBeInTheDocument();
    expect(called).toHaveAttribute(
      "title",
      "gg.views.openFile was called 2 times.",
    );

    const untouched = chip(section, "readFile");
    expect(untouched).toHaveAttribute("data-uncalled");
    expect(within(untouched).getByText("0×")).toBeInTheDocument();
  });

  it("renders no section at all for a run that reported no surface", () => {
    // A profile whose instances have not reported what they were offered. An empty "Tools"
    // section would read as "this agent was offered nothing", which is the one thing it does
    // not mean.
    const { detail } = openReviewer();
    expect(
      within(detail).queryByRole("region", { name: "Reviewer tools" }),
    ).toBeNull();
    expect(within(detail).queryByText(/offered/)).toBeNull();
    // The section that *is* about what it called is still there, under its own heading.
    // With no surface reported there is no mode to read it on either, so it falls back to
    // the record that has entries — which for these instances is the tool one.
    expect(within(detail).getByText(/^Tool calls · /)).toBeInTheDocument();
  });

  it("heads a code profile's observed usage API calls, in its own spelling", () => {
    // Directly under the offered-surface section, which already reads this profile as
    // APIs. Heading its observed usage "Tool calls" and itemizing it by `read_file` put
    // two sections of one panel, three lines apart, in disagreement about what the
    // profile did.
    const { detail } = openReviewer(stubNav(), API_SURFACE_EVENTS);
    expect(within(detail).getByText("API calls · 2")).toBeInTheDocument();
    expect(within(detail).queryByText(/^Tool calls · /)).toBeNull();
    // The function its programs wrote, not the tool that served it.
    expect(within(detail).getByText("gg.files.readFile")).toBeInTheDocument();
    expect(within(detail).queryByText("read_file")).toBeNull();
  });

  it("still heads a tool-calling profile's observed usage Tool calls", () => {
    const { detail } = openReviewer(stubNav(), TOOL_SURFACE_EVENTS);
    expect(within(detail).getByText("Tool calls · 2")).toBeInTheDocument();
    expect(within(detail).queryByText(/^API calls · /)).toBeNull();
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
        name: `Reviewer ${kind}`,
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
      name: "Reviewer memories",
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
      name: "Reviewer memories",
    });
    const scoped = within(row).getByRole("region", {
      name: "Reviewer agent-scoped memories",
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
    const row = within(detail).getByRole("region", { name: "Reviewer board" });

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
    const row = within(detail).getByRole("region", { name: "Reviewer board" });
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
      name: "Reviewer memories",
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
      name: "Reviewer memories",
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
    const row = within(detail).getByRole("region", { name: "Reviewer board" });
    expect(
      within(row).queryByRole("button", { name: /Compare board/ }),
    ).toBeNull();
    expect(row).not.toHaveAttribute("data-clickable");
    // No handler either — with no nav channel there is nothing for a click to do, and the
    // row must not throw trying.
    expect(() => fireEvent.click(row)).not.toThrow();
  });
});
