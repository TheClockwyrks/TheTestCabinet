import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ModelCombobox } from "./ModelCombobox";
import type { HarnessFamily, Model, ModelAlias } from "../../client/types";

// A minimal catalog entry — only the fields the combobox reads (name, slug,
// curated, aliases) matter; the rest are filled with inert defaults.
function model(name: string, aliases: ModelAlias[], curated = true): Model {
  return {
    slug: aliases[0]?.slug ?? name.toLowerCase(),
    name,
    provider: "test",
    curated,
    openrouterUrl: null,
    description: null,
    logoSvg: null,
    coveredModelIds: [],
    aliases,
    price: null,
    priceHistory: [],
    contextLength: null,
    releasedAt: null,
  };
}

const family = (slug: string, harnessFamily: HarnessFamily = "claude") => ({
  slug,
  harnessFamily,
});

// A small catalog of three claude-family models.
const MODELS: Model[] = [
  model("Opus 4.8", [family("claude-opus-4-8")]),
  model("Sonnet 5", [family("claude-sonnet-5")]),
  model("Haiku 4.5", [family("claude-haiku-4-5")]),
];

// The model ids shown as options in the open dropdown, in order.
function shownOptionIds(): string[] {
  return screen
    .getAllByRole("option")
    .map((o) => within(o).getByText(/^claude-/).textContent ?? "");
}

describe("ModelCombobox", () => {
  it("shows the whole catalog when the field is empty", () => {
    // No model is auto-selected, so a fresh field is empty and lists every model.
    render(
      <ModelCombobox
        value=""
        onChange={() => {}}
        models={MODELS}
        harnessFamily="claude"
      />,
    );
    fireEvent.focus(screen.getByRole("combobox"));
    expect(shownOptionIds()).toEqual([
      "claude-opus-4-8",
      "claude-sonnet-5",
      "claude-haiku-4-5",
    ]);
  });

  it("filters the list by the field's text, including a committed id", () => {
    // The field's text always filters the list — a committed id narrows it to the
    // matching option rather than showing the whole catalog.
    render(
      <ModelCombobox
        value="claude-opus-4-8"
        onChange={() => {}}
        models={MODELS}
        harnessFamily="claude"
      />,
    );
    fireEvent.focus(screen.getByRole("combobox"));
    expect(shownOptionIds()).toEqual(["claude-opus-4-8"]);
  });

  it("narrows the list to matches once the user types a query", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ModelCombobox
        value="claude-opus-4-8"
        onChange={onChange}
        models={MODELS}
        harnessFamily="claude"
      />,
    );
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    // Simulate the user clearing the field and typing "sonnet"; the parent echoes
    // the new value back through `value` as a controlled input would.
    fireEvent.change(input, { target: { value: "sonnet" } });
    rerender(
      <ModelCombobox
        value="sonnet"
        onChange={onChange}
        models={MODELS}
        harnessFamily="claude"
      />,
    );
    expect(shownOptionIds()).toEqual(["claude-sonnet-5"]);
  });

  it("commits the picked model's id when an option is clicked", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ModelCombobox
        value=""
        onChange={onChange}
        models={MODELS}
        harnessFamily="claude"
      />,
    );
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    // Type to narrow, then click the surviving option to commit it.
    fireEvent.change(input, { target: { value: "haiku" } });
    rerender(
      <ModelCombobox
        value="haiku"
        onChange={onChange}
        models={MODELS}
        harnessFamily="claude"
      />,
    );
    fireEvent.click(screen.getByRole("option"));
    expect(onChange).toHaveBeenLastCalledWith("claude-haiku-4-5");
  });
});
