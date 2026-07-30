// The gg configuration editor's **per-agent capability form**, on the two things it has to
// get right about a control that is not always meaningful.
//
// 1. A param the selected strategy does not read is not offered. The catalog says which
//    implementations each param applies under (`ParamSpec.showWhenImplementation`), but the
//    only thing that proves an operator is not staring at a box that changes nothing is
//    rendering the form and looking. A stale, ignored ceiling sitting beside a live one is
//    exactly the kind of thing that gets set, saved, and then blamed for a run's behavior.
// 2. A `model` param binds like every other model in the configuration — from a model slot
//    the launch form fills in, or pinned here. That control is two fields that swap, and
//    which one is showing is decided by whether the param's slot key is *present* in the
//    draft, which is a distinction no unit test of the draft can see.

import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GgConfigEditor } from "./GgConfigEditor";
import {
  blankModelSlot,
  emptyDraft,
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

// A draft with one agent, opened on that agent's capability form, with `capId` enabled and
// carrying `params`.
function draftWith(
  capId: string,
  implementation: string,
  params: Record<string, string> = {},
): GgConfigDraft {
  const draft = emptyDraft();
  const agent = draft.agents[0]!;
  return {
    ...draft,
    agents: [
      {
        ...agent,
        capabilities: {
          ...agent.capabilities,
          [capId]: { enabled: true, implementation, params, extraParams: {} },
        },
      },
    ],
  };
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
    select(within(row).getByLabelText(/Read mode/), "hard-cap");
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
    expect(within(slot).getByRole("option", { name: "summarizer" })).toBeDefined();
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

    select(within(row).getByLabelText(/Summarization strategy/), "self-compaction");
    expect(within(row).queryByLabelText(/Model from/)).toBeNull();
  });
});
