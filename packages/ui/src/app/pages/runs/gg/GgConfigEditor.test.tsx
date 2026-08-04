// The gg configuration editor's **per-agent form**, on the things it has to get right
// about a control that is not always meaningful.
//
// 1. An agent's **type** decides what the form offers at all: a capability only one type
//    reads is listed only under that type, and a machine — which has no capabilities of
//    its own — is offered none. Switching type has to be free (nothing is lost until the
//    agent is committed), which is a thing only rendering the form and driving it shows.
// 2. A param the selected strategy does not read is not offered. The catalog says which
//    implementations each param applies under (`ParamSpec.showWhenImplementation`), but the
//    only thing that proves an operator is not staring at a box that changes nothing is
//    rendering the form and looking. A stale, ignored ceiling sitting beside a live one is
//    exactly the kind of thing that gets set, saved, and then blamed for a run's behavior.
// 3. A `model` param binds like every other model in the configuration — from a model slot
//    the launch form fills in, or pinned here. That control is two fields that swap, and
//    which one is showing is decided by whether the param's slot key is *present* in the
//    draft, which is a distinction no unit test of the draft can see.

import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GgConfigEditor } from "./GgConfigEditor";
import { BUILT_IN_SKILL_OPTIONS, type GgAgentMode } from "./ggCatalog";
import {
  blankAgentDraft,
  blankModelSlot,
  emptyDraft,
  statesDraftValue,
  type GgConfigDraft,
} from "./ggConfigDraft";

// The editor is controlled, so a test drives it through a tiny stateful host rather than
// re-rendering by hand — which is also how the pages use it.
function Harness({ initial }: { initial: GgConfigDraft }) {
  const [draft, setDraft] = useState(initial);
  return (
    <GgConfigEditor
      value={draft}
      onChange={setDraft}
      editingAgentId={draft.agents[0]!.id}
      onEditingAgentChange={() => {}}
      models={[]}
    />
  );
}

// A draft with one agent, opened on that agent's form, of the given type (Tools unless
// said otherwise), with `capId` enabled and carrying `params`.
function draftWith(
  capId: string,
  implementation: string,
  params: Record<string, string> = {},
  mode: GgAgentMode = "tools",
): GgConfigDraft {
  const draft = emptyDraft();
  const agent = draft.agents[0]!;
  return {
    ...draft,
    agents: [
      {
        ...agent,
        mode,
        capabilities: {
          ...agent.capabilities,
          [capId]: { enabled: true, implementation, params, extraParams: {} },
        },
      },
    ],
  };
}

// The agent-type selector's segment for a type, by the label it wears.
function typeSegment(label: string): HTMLElement {
  return within(
    screen.getByRole("radiogroup", { name: "Agent type" }),
  ).getByRole("radio", { name: label });
}

// Pick an option on a <select> the way an operator would — the editor is controlled, so
// this is the only way its state advances.
function select(field: HTMLElement, value: string) {
  fireEvent.change(field, { target: { value } });
}

// One capability's row in the open agent's form, found by the capability id printed beside
// its name.
function capabilityRow(capId: string): HTMLElement {
  const id = screen.getByText(capId, { selector: "span" });
  const row = id.closest("div");
  if (!row) throw new Error(`no row around the ${capId} capability`);
  return row;
}

describe("a param the selected strategy does not read", () => {
  it("is hidden under the shell capability's inline mode and shown under the others", () => {
    render(<Harness initial={draftWith("shell", "")} />);
    const row = capabilityRow("shell");

    // The default mode truncates, so both ceilings are live controls.
    expect(within(row).getByLabelText(/Max lines/)).toBeDefined();
    expect(within(row).getByLabelText(/Max characters/)).toBeDefined();

    select(within(row).getByLabelText(/Output mode/), "inline");
    expect(within(row).queryByLabelText(/Max lines/)).toBeNull();
    expect(within(row).queryByLabelText(/Max characters/)).toBeNull();

    select(within(row).getByLabelText(/Output mode/), "offload");
    expect(within(row).getByLabelText(/Max lines/)).toBeDefined();
  });

  it("is hidden while read-file is unlimited, which reads no line cap at all", () => {
    render(<Harness initial={draftWith("read-file", "")} />);
    const row = capabilityRow("read-file");

    expect(within(row).queryByLabelText(/Line cap/)).toBeNull();
    select(within(row).getByLabelText(/Read mode/), "default-cap");
    expect(within(row).getByLabelText(/Line cap/)).toBeDefined();
  });

  it("follows the memory strategy, which reads a different subset of the limits", () => {
    render(<Harness initial={draftWith("memories", "")} />);
    const row = capabilityRow("memories");

    // Scratchpad: the window carries the notes, so the total-length budget is the live one
    // and there is neither an index nor a search to bound.
    expect(within(row).getByLabelText(/Max length total/)).toBeDefined();
    expect(within(row).queryByLabelText(/Max index length/)).toBeNull();
    expect(within(row).queryByLabelText(/Max search results/)).toBeNull();

    select(within(row).getByLabelText(/Memory strategy/), "markdown");
    expect(within(row).getByLabelText(/Max index length/)).toBeDefined();
    expect(within(row).queryByLabelText(/Max length total/)).toBeNull();
    // A markdown run is bounded by its index, not by a count of notes.
    expect(within(row).queryByLabelText(/Max memories/)).toBeNull();

    select(within(row).getByLabelText(/Memory strategy/), "keyword-search");
    expect(within(row).getByLabelText(/Max search results/)).toBeDefined();
    expect(within(row).getByLabelText(/Max memories/)).toBeDefined();
    expect(within(row).queryByLabelText(/Max index length/)).toBeNull();
  });

  it("keeps what a hidden control held, so switching strategy loses nothing", () => {
    render(
      <Harness initial={draftWith("shell", "offload", { maxLines: "40" })} />,
    );
    const row = capabilityRow("shell");
    expect(
      (within(row).getByLabelText(/Max lines/) as HTMLInputElement).value,
    ).toBe("40");

    select(within(row).getByLabelText(/Output mode/), "inline");
    select(within(row).getByLabelText(/Output mode/), "offload");
    expect(
      (within(row).getByLabelText(/Max lines/) as HTMLInputElement).value,
    ).toBe("40");
  });
});

// An agent's **type** is not a capability, and the whole point of the selector is that
// the form below it changes: responses-as-code and the state machine are the type's own
// settings rather than rows in the capability list, and a capability only one type reads
// is listed only there. None of that is visible without rendering the form and driving
// the selector.
describe("an agent's type", () => {
  it("is chosen above the capabilities, and says what the choice means", () => {
    render(<Harness initial={emptyDraft()} />);
    expect(typeSegment("Tools")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(/Tool calling: gg offers/)).toBeInTheDocument();
    // Its own row *above* Capabilities, because the capabilities below are a
    // consequence of the choice rather than one of them.
    expect(
      screen
        .getByText("Agent type")
        .compareDocumentPosition(screen.getByText("Capabilities")),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    fireEvent.click(typeSegment("RaC"));
    expect(typeSegment("RaC")).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByText(/One turn can make dozens of calls/),
    ).toBeInTheDocument();
  });

  it("offers responses-as-code as the type's settings, not as a capability", () => {
    render(<Harness initial={emptyDraft()} />);
    // Under Tools it is not on the page at all — it is the other type.
    expect(
      screen.queryByRole("group", { name: "Responses as code" }),
    ).toBeNull();

    fireEvent.click(typeSegment("RaC"));
    const panel = screen.getByRole("group", { name: "Responses as code" });
    // Its params are the same controls a capability's are…
    expect(within(panel).getByLabelText(/Max open image views/)).toBeDefined();
    // …but it has no switch of its own: the type selector is the switch.
    expect(
      screen.queryByText("responses-as-code", { selector: "span" }),
    ).toBeNull();
  });

  it("lists a capability only the code type reads only under it", () => {
    render(<Harness initial={emptyDraft()} />);
    // There are no programs in a tool-calling session to keep.
    expect(
      screen.queryByText("program-library", { selector: "span" }),
    ).toBeNull();

    fireEvent.click(typeSegment("RaC"));
    expect(
      screen.getByText("program-library", { selector: "span" }),
    ).toBeInTheDocument();
  });

  it("offers a machine no capabilities at all — its configuration is the machine", () => {
    render(<Harness initial={emptyDraft()} />);
    expect(screen.getByText("Capabilities")).toBeInTheDocument();

    fireEvent.click(typeSegment("FSM"));
    expect(screen.queryByText("Capabilities")).toBeNull();
    expect(screen.queryByText("shell", { selector: "span" })).toBeNull();
    expect(screen.getByRole("group", { name: "Process" })).toBeInTheDocument();
  });

  // A machine takes no turns, so it runs no model, keeps no cache, renders no prompt and
  // spawns from no roster. None of those controls is shown under one — a field an
  // operator can set and gg would never read is worse than no field, because it invites
  // them to configure a run that does not exist.
  it("asks a machine for no model, prompt or roster", () => {
    render(<Harness initial={emptyDraft()} />);
    expect(screen.getByLabelText("Model from")).toBeInTheDocument();

    fireEvent.click(typeSegment("FSM"));
    for (const label of ["Model from", "Model slot", "Prompt cache"]) {
      expect(screen.queryByLabelText(label)).toBeNull();
    }
    expect(screen.queryByText("Roster")).toBeNull();
    expect(screen.queryByText("Custom instructions")).toBeNull();
    expect(screen.queryByText("System Prompt")).toBeNull();

    // …and they are all back the moment it is a worker again.
    fireEvent.click(typeSegment("Tools"));
    expect(screen.getByLabelText("Model from")).toBeInTheDocument();
    expect(screen.getByText("Roster")).toBeInTheDocument();
  });

  // Switching type is a look, not an edit: an operator comparing the two arms of a study
  // must be able to flip between them without the form quietly forgetting what the one
  // they flipped away from was set to. (The wind-back to a type's defaults happens when
  // the agent is *committed*, which is the page's job and is covered in the draft tests.)
  it("keeps what another type was configured with while the agent is open", () => {
    render(<Harness initial={draftWith("shell", "")} />);
    const shell = capabilityRow("shell");
    select(within(shell).getByLabelText(/Output mode/), "inline");

    fireEvent.click(typeSegment("RaC"));
    const panel = screen.getByRole("group", { name: "Responses as code" });
    fireEvent.change(within(panel).getByLabelText(/Max open image views/), {
      target: { value: "3" },
    });

    fireEvent.click(typeSegment("Tools"));
    expect(
      (
        within(capabilityRow("shell")).getByLabelText(
          /Output mode/,
        ) as HTMLSelectElement
      ).value,
    ).toBe("inline");

    fireEvent.click(typeSegment("RaC"));
    expect(
      (
        within(
          screen.getByRole("group", { name: "Responses as code" }),
        ).getByLabelText(/Max open image views/) as HTMLInputElement
      ).value,
    ).toBe("3");
  });
});

// The responses-as-code image-view cap is an ungated number — the type has no
// implementations, so the control is offered whenever the agent is a code agent. The
// catalog entry is the whole of this feature's UI, so rendering the form is the only
// thing that says the generic param grid picked it up: a label that never appears is a
// cap an operator can only reach by hand-editing the configuration's JSON.
describe("the responses-as-code image-view cap", () => {
  it("is offered whenever the agent is a code agent, and holds what is typed into it", () => {
    render(
      <Harness
        initial={draftWith(
          "responses-as-code",
          "",
          { imageViewCap: "4" },
          "rac",
        )}
      />,
    );
    const panel = screen.getByRole("group", { name: "Responses as code" });

    const field = within(panel).getByLabelText(
      /Max open image views/,
    ) as HTMLInputElement;
    expect(field.type).toBe("number");
    expect(field.value).toBe("4");

    fireEvent.change(field, { target: { value: "1" } });
    expect(
      (within(panel).getByLabelText(/Max open image views/) as HTMLInputElement)
        .value,
    ).toBe("1");
  });
});

describe("a capability param that names a model", () => {
  // The compaction model is the one model in a configuration that is not an agent's own
  // binding, and it has to be pickable at launch like every other one — otherwise a
  // configuration meant to sweep the summarizer across models has to be edited per run.
  const handoff = (params: Record<string, string> = {}) =>
    draftWith("compaction", "handoff-summarization", params);

  function withSlot(draft: GgConfigDraft): GgConfigDraft {
    return { ...draft, modelSlots: [blankModelSlot("summarizer")] };
  }

  it("offers a model slot beside a pinned model, and swaps the field with it", () => {
    render(<Harness initial={withSlot(handoff())} />);
    const row = capabilityRow("compaction");

    // A param carrying no slot key is a pinned model, so the model field is showing.
    expect(within(row).getByLabelText(/^Model$/)).toBeDefined();
    expect(within(row).queryByLabelText(/Model slot/)).toBeNull();

    select(within(row).getByLabelText(/Model from/), "model-slot");
    const slot = within(row).getByLabelText(/Model slot/) as HTMLSelectElement;
    // Deferring picks the configuration's first slot rather than landing on "(none)":
    // an operator who chose to defer meant to defer to something.
    expect(
      within(slot).getByRole("option", { name: "summarizer" }),
    ).toBeDefined();
    expect(within(row).queryByLabelText(/^Model$/)).toBeNull();
  });

  it("says so when it defers to no slot, which a run could never fill in", () => {
    // A configuration with no slots declared at all: deferring cannot pick one.
    render(<Harness initial={{ ...handoff(), modelSlots: [] }} />);
    const row = capabilityRow("compaction");

    select(within(row).getByLabelText(/Model from/), "model-slot");
    expect(within(row).getByText(/would never fill it in/)).toBeDefined();
  });

  it("is not offered at all under a strategy that condenses on the agent's own model", () => {
    render(<Harness initial={withSlot(handoff())} />);
    const row = capabilityRow("compaction");
    expect(within(row).getByLabelText(/Model from/)).toBeDefined();

    select(
      within(row).getByLabelText(/Summarization strategy/),
      "self-compaction",
    );
    expect(within(row).queryByLabelText(/Model from/)).toBeNull();
  });
});

// A gg **process** — a machine over the configuration's other agent profiles — is the
// one capability whose param is a document rather than a value, and the whole reason
// the module model exists is authored on its edges. It is also the surface where "too
// tedious to use" and "does not exist" are the same thing: an author who has to hand-
// write JSON to say `explore → build, carrying the conversation` will write a single
// agent instead. So the tests here are the operator's actual moves — add a state, point
// it at an agent, add an edge, pick what it carries, rename a state — plus the two
// launch failures gg would otherwise report only after the run had started.
describe("authoring a state machine", () => {
  // A configuration whose Root is a machine over two worker profiles, seeded with
  // `states` (the state rows name the workers by their local ids, as the draft holds
  // every cross-reference).
  function machineDraft(
    states: (workers: [string, string]) => ReadonlyArray<{
      name: string;
      agentId: string;
      transitions: Array<{
        to: string;
        transfer: Array<"history" | "tasks">;
        description: string;
      }>;
    }>,
  ): GgConfigDraft {
    const base = emptyDraft();
    const explorer = blankAgentDraft("Explorer");
    const builder = blankAgentDraft("Builder");
    const shell = {
      ...base.agents[0]!,
      name: "Feature",
      mode: "fsm" as const,
      capabilities: {
        ...base.agents[0]!.capabilities,
        fsm: {
          enabled: true,
          params: {
            states: statesDraftValue([...states([explorer.id, builder.id])]),
          },
          extraParams: {},
        },
      },
    };
    return { ...base, agents: [shell, explorer, builder] };
  }

  // A machine is the FSM type's whole configuration, so it is on the page the moment the
  // agent opens — there is no capability group to expand first.
  function openMachine(draft: GgConfigDraft) {
    render(<Harness initial={draft} />);
    return screen.getByRole("group", { name: "Process" });
  }

  const LINEAR = (workers: [string, string]) => [
    {
      name: "explore",
      agentId: workers[0],
      transitions: [
        {
          to: "build",
          transfer: ["history" as const],
          description: "when you understand the change",
        },
      ],
    },
    { name: "build", agentId: workers[1], transitions: [] },
  ];

  it("adds a state and points it at one of the configuration's agents", () => {
    const row = openMachine(machineDraft(LINEAR));
    fireEvent.click(within(row).getByRole("button", { name: "+ Add state" }));

    const name = within(row).getByLabelText("State 3 name") as HTMLInputElement;
    fireEvent.change(name, { target: { value: "verify" } });
    expect(
      (within(row).getByLabelText("State 3 name") as HTMLInputElement).value,
    ).toBe("verify");

    // Until it names an agent the machine will not launch, and the form says so where
    // the fix is rather than at save time.
    expect(within(row).getByText(/runs no agent/)).toBeInTheDocument();
    const agent = within(row).getByLabelText("State 3 agent");
    fireEvent.change(agent, {
      target: {
        value: (
          within(row).getByLabelText("State 1 agent") as HTMLSelectElement
        ).value,
      },
    });
    expect(within(row).queryByText(/runs no agent/)).toBeNull();
    // A state with no edges ends the machine, and is marked as such rather than
    // reading as an unfinished row.
    expect(within(row).getAllByText("terminal").length).toBe(2);
  });

  it("opens a new edge carrying the conversation, and records what it carries", () => {
    const row = openMachine(machineDraft(LINEAR));
    fireEvent.click(
      within(row).getByRole("button", { name: /Add transition from build/ }),
    );

    const transfer = within(row).getByRole("group", {
      name: "State 2 transition 1 transfer",
    });
    // Pre-filled with History — the common case, still written down in the record.
    expect(within(transfer).getByLabelText("History")).toBeChecked();
    expect(within(transfer).getByLabelText("Tasks")).not.toBeChecked();

    fireEvent.click(within(transfer).getByLabelText("Tasks"));
    expect(within(transfer).getByLabelText("Tasks")).toBeChecked();

    // Clearing every module is a legitimate hard reset, and says so — an empty row of
    // checkboxes otherwise reads as an unfinished edge.
    fireEvent.click(within(transfer).getByLabelText("History"));
    fireEvent.click(within(transfer).getByLabelText("Tasks"));
    expect(within(row).getByText(/carries nothing/)).toBeInTheDocument();
  });

  it("carries a renamed state's inbound edges with it", () => {
    const row = openMachine(machineDraft(LINEAR));
    const target = within(row).getByLabelText(
      "State 1 transition 1 target",
    ) as HTMLSelectElement;
    expect(target.value).toBe("build");

    fireEvent.change(within(row).getByLabelText("State 2 name"), {
      target: { value: "assemble" },
    });
    // The edge followed the rename; the machine is still one gg would launch.
    expect(
      (
        within(row).getByLabelText(
          "State 1 transition 1 target",
        ) as HTMLSelectElement
      ).value,
    ).toBe("assemble");
    expect(within(row).queryByText(/not a state it declares/)).toBeNull();
  });

  it("moves the entry state, which is a position rather than a flag", () => {
    const row = openMachine(machineDraft(LINEAR));
    expect(
      (within(row).getByLabelText("State 1 name") as HTMLInputElement).value,
    ).toBe("explore");

    fireEvent.click(
      within(row).getByRole("button", {
        name: "Make state 2 the entry state",
      }),
    );
    expect(
      (within(row).getByLabelText("State 1 name") as HTMLInputElement).value,
    ).toBe("build");
    // …and the state that is now second is unreachable from the new entry, which is
    // worth saying without refusing to save it.
    expect(
      within(row).getByText(/unreachable from `build`/),
    ).toBeInTheDocument();
  });

  it("refuses a state that runs another machine", () => {
    // A shell cannot be a state — it would recurse — so the picker offers it, labelled,
    // and the form refuses it rather than silently repointing the state somewhere else.
    const row = openMachine(machineDraft(LINEAR));
    const agent = within(row).getByLabelText("State 1 agent");
    expect(
      within(agent).getByRole("option", { name: "Feature (a machine)" }),
    ).toBeDefined();
    fireEvent.change(agent, {
      target: {
        value: (
          within(agent).getByRole("option", {
            name: "Feature (a machine)",
          }) as HTMLOptionElement
        ).value,
      },
    });
    expect(within(row).getByText(/itself a state machine/)).toBeInTheDocument();
  });
});

// Whether a module's state is carried in its holder's prompt is a per-agent, per-module
// decision, and the default arm has to be the absent param, or every saved configuration
// would become an explicit opt-in to what modules have always done.
//
// Asked of project management rather than memories: the board and the thread archive are
// the two capabilities that still offer the picker at all. Memories and skills dropped it
// with gg, so a test that kept looking for it there would be asserting a control that
// writes a key nothing reads.
describe("module ownership", () => {
  it("is offered on a module-backed capability and defaults to owned", () => {
    render(<Harness initial={draftWith("project-management", "")} />);
    const row = capabilityRow("project-management");
    const ownership = within(row).getByLabelText(
      /Ownership/,
    ) as HTMLSelectElement;
    expect(ownership.value).toBe("");
    expect(
      within(ownership).getByRole("option", { name: /Unowned/ }),
    ).toBeDefined();
  });

  it("is not offered on the two capabilities that no longer have one", () => {
    for (const capId of ["memories", "skills"]) {
      const { unmount } = render(<Harness initial={draftWith(capId, "")} />);
      expect(
        within(capabilityRow(capId)).queryByLabelText(/Ownership/),
      ).toBeNull();
      unmount();
    }
  });
});

// The `builtIns` toggles, rendered: eleven checkboxes that start on, because an absent
// param means gg offers every built-in skill it has one for. Only what an operator
// switches OFF is recorded, so the arm a study varies is a box being cleared — which is
// only visible by rendering the control and clicking it.
describe("the skills capability's built-in skills", () => {
  it("starts every built-in on and clears exactly the one switched off", () => {
    render(<Harness initial={draftWith("skills", "")} />);
    const group = within(capabilityRow("skills")).getByRole("group", {
      name: "Built-in skills",
    });
    const boxes = within(group).getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes).toHaveLength(BUILT_IN_SKILL_OPTIONS.length);
    expect(boxes.every((box) => box.checked)).toBe(true);

    // Withhold the shell family's manual, and nothing else.
    const shell =
      boxes[
        BUILT_IN_SKILL_OPTIONS.findIndex(
          (option) => option.value === "gg-shell",
        )
      ]!;
    fireEvent.click(shell);
    expect(shell.checked).toBe(false);
    expect(boxes.filter((box) => !box.checked)).toEqual([shell]);
  });
});

// Response healing's strategies are a `toggles` control whose members each sit at their
// own default arm — five on, `drop-doubled-response` off. A subtractive control could not
// express arming the last one at all, so what the checkbox does is only visible by
// rendering it and clicking.
describe("the responses-as-code agent's healing strategies", () => {
  function healingBoxes(): HTMLInputElement[] {
    const group = screen.getByRole("group", { name: "Response healing" });
    return within(group).getAllByRole("checkbox") as HTMLInputElement[];
  }

  it("opens with the one default-off repair off and every other one on", () => {
    render(<Harness initial={draftWith("responses-as-code", "", {}, "rac")} />);
    const boxes = healingBoxes();
    const doubled = boxes.find((box) =>
      box.parentElement?.textContent?.includes("drop-doubled-response"),
    )!;
    expect(doubled.checked).toBe(false);
    expect(boxes.filter((box) => !box.checked)).toEqual([doubled]);
  });

  it("arms the default-off repair, and says on the control that it is one", () => {
    render(<Harness initial={draftWith("responses-as-code", "", {}, "rac")} />);
    const doubled = healingBoxes().find((box) =>
      box.parentElement?.textContent?.includes("drop-doubled-response"),
    )!;
    // The label carries the asymmetry, since every other member's default is the opposite.
    expect(doubled.parentElement?.textContent).toContain("off by default");
    fireEvent.click(doubled);
    expect(doubled.checked).toBe(true);
    // And nothing else moved with it.
    expect(healingBoxes().every((box) => box.checked)).toBe(true);
  });
});

// Loop detection is a per-agent, non-capability lever: it changes nothing about what the
// agent can do, only how gg talks to its model. It is authored like a capability all the
// same — a switch, a purpose, and a body of knobs revealed once it is on — and only
// rendering it shows that the knobs appear when armed and survive being disarmed.
describe("an agent's loop detection", () => {
  function loopSwitch(): HTMLInputElement {
    return within(
      screen.getByText("Loop detection").closest("label")!,
    ).getByRole("checkbox") as HTMLInputElement;
  }

  it("opens disarmed, with no knobs to tune on a detector that is not running", () => {
    render(<Harness initial={emptyDraft()} />);
    expect(loopSwitch().checked).toBe(false);
    expect(screen.queryByLabelText(/Window \(words\)/)).toBeNull();
  });

  it("reveals its knobs when armed, each naming gg's own default", () => {
    render(<Harness initial={emptyDraft()} />);
    fireEvent.click(loopSwitch());
    const window = screen.getByLabelText(
      /Window \(words\)/,
    ) as HTMLInputElement;
    // Empty, not seeded: an empty field IS "take gg's default", and writing 256 into every
    // stored configuration would freeze today's number into all of them.
    expect(window.value).toBe("");
    expect(window.placeholder).toContain("256");
    expect(
      (screen.getByLabelText(/Reply ceiling/) as HTMLInputElement).placeholder,
    ).toContain("250,000");
  });

  it("keeps a tuned knob when the detector is switched back off", () => {
    render(<Harness initial={emptyDraft()} />);
    fireEvent.click(loopSwitch());
    fireEvent.change(screen.getByLabelText(/Window \(words\)/), {
      target: { value: "512" },
    });
    fireEvent.click(loopSwitch());
    expect(loopSwitch().checked).toBe(false);
    fireEvent.click(loopSwitch());
    expect(
      (screen.getByLabelText(/Window \(words\)/) as HTMLInputElement).value,
    ).toBe("512");
  });

  it("says so on the form when the knobs describe a detector that could never trip", () => {
    render(<Harness initial={emptyDraft()} />);
    fireEvent.click(loopSwitch());
    fireEvent.change(screen.getByLabelText(/Window \(words\)/), {
      target: { value: "8" },
    });
    fireEvent.change(screen.getByLabelText(/Offenders to saturate/), {
      target: { value: "20" },
    });
    expect(screen.getByText(/could never trip/)).toBeInTheDocument();
  });

  it("is absent under a machine, which takes no turns and so has no reply to watch", () => {
    const draft = emptyDraft();
    render(
      <Harness
        initial={{
          ...draft,
          agents: [{ ...draft.agents[0]!, mode: "fsm" }],
        }}
      />,
    );
    expect(screen.queryByText("Loop detection")).toBeNull();
  });
});
