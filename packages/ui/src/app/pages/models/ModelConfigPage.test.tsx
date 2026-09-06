import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import {
  BackendProvider,
  type BackendContextValue,
} from "../../../client/context";
import {
  GalleryDataProvider,
  type GalleryDataInput,
} from "../../data/galleryContext";
import { ModelConfigPage } from "./ModelConfigPage";

// The form's "Fill from OpenRouter" control: an operator types the slug that
// already prices the model and the curated fields fill themselves in, instead of
// being retyped from OpenRouter's own catalog page.

// The page's app chrome reads contexts (backdrop settings, prompt header) that
// are irrelevant to the form logic under test.
vi.mock("../../components/PageLayout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../../client/auth", () => ({
  useAuth: () => ({ token: "t" }),
}));

const LISTING = {
  name: "Claude Sonnet 4.5",
  provider: "Anthropic",
  description: "A model for agents and coding workflows.",
};

function galleryValue(): GalleryDataInput {
  return {
    models: [],
    modelsStatus: "ready",
    canExecute: true,
  } as unknown as GalleryDataInput;
}

function backendValue(
  lookupOpenrouterModel: ReturnType<typeof vi.fn>,
  createModel: ReturnType<typeof vi.fn> = vi.fn(),
): BackendContextValue {
  return {
    client: {
      // The whole config surface must be present or `useModelConfig` hides the
      // form outright, so every method it gates on is stubbed here.
      createModel,
      updateModel: vi.fn(),
      deleteModel: vi.fn(),
      fetchModelLogo: vi.fn(),
      seedModelFromRun: vi.fn(),
      lookupOpenrouterModel,
    },
    identity: null,
    status: "ready",
    error: null,
    url: null,
    setUrl: () => {},
  } as unknown as BackendContextValue;
}

function renderPage(
  lookupOpenrouterModel = vi.fn().mockResolvedValue(LISTING),
  createModel = vi.fn(),
) {
  render(
    <MemoryRouter initialEntries={["/models/new"]}>
      <GalleryDataProvider value={galleryValue()}>
        <BackendProvider
          value={backendValue(lookupOpenrouterModel, createModel)}
        >
          <Routes>
            <Route path="/models/new" element={<ModelConfigPage />} />
          </Routes>
        </BackendProvider>
      </GalleryDataProvider>
    </MemoryRouter>,
  );
  return lookupOpenrouterModel;
}

/** Let the fill's async lookup settle, so no state update lands after the
 *  assertions (React logs an act() warning for one that does). */
async function settle() {
  await act(async () => {});
}

const slugInput = () => screen.getByLabelText("OpenRouter slug");
const nameInput = () => screen.getByPlaceholderText("e.g. Claude Opus 4.8");
const providerInput = () => screen.getByPlaceholderText("e.g. Anthropic");
const descriptionInput = () =>
  screen.getByPlaceholderText("What the model is, when to reach for it…");
const fillButton = () => screen.getByRole("button", { name: /fill/i });

function typeSlug(slug: string) {
  fireEvent.change(slugInput(), { target: { value: slug } });
}

describe("ModelConfigPage's OpenRouter fill-in", () => {
  it("fills the name, provider, and description from the slug", async () => {
    const lookup = renderPage();
    typeSlug("anthropic/claude-sonnet-4.5");
    fireEvent.click(fillButton());

    await waitFor(() => expect(nameInput()).toHaveValue("Claude Sonnet 4.5"));
    expect(lookup).toHaveBeenCalledWith("anthropic/claude-sonnet-4.5", "t");
    expect(providerInput()).toHaveValue("Anthropic");
    expect(descriptionInput()).toHaveValue(LISTING.description);
  });

  it("keeps the description when OpenRouter publishes none", async () => {
    renderPage(vi.fn().mockResolvedValue({ ...LISTING, description: null }));
    fireEvent.change(descriptionInput(), { target: { value: "Mine." } });
    typeSlug("anthropic/claude-sonnet-4.5");
    fireEvent.click(fillButton());

    await waitFor(() => expect(nameInput()).toHaveValue("Claude Sonnet 4.5"));
    // A model with no blurb on OpenRouter has nothing to replace the field with,
    // so blanking it would be a deletion the press never asked for.
    expect(descriptionInput()).toHaveValue("Mine.");
  });

  it("claims the untouched alias row for the slug it just filled from", async () => {
    renderPage();
    typeSlug("anthropic/claude-sonnet-4.5");
    fireEvent.click(fillButton());

    // The slug is itself a canonical OpenRouter-family id, so the operator does
    // not retype it into the id list they left blank.
    await waitFor(() =>
      expect(screen.getByLabelText("Model id 1")).toHaveValue(
        "anthropic/claude-sonnet-4.5",
      ),
    );
  });

  it("leaves ids the operator already entered alone", async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText("Model id 1"), {
      target: { value: "claude-sonnet-4-5" },
    });
    typeSlug("anthropic/claude-sonnet-4.5");
    fireEvent.click(fillButton());

    await waitFor(() => expect(nameInput()).toHaveValue("Claude Sonnet 4.5"));
    // That id may be a native slug the operator tagged deliberately; a fill that
    // replaced it would silently undo their choice.
    expect(screen.getByLabelText("Model id 1")).toHaveValue(
      "claude-sonnet-4-5",
    );
  });

  it("trims the slug before looking it up", async () => {
    const lookup = renderPage();
    typeSlug("  anthropic/claude-sonnet-4.5  ");
    fireEvent.click(fillButton());

    await settle();
    expect(lookup).toHaveBeenCalledWith("anthropic/claude-sonnet-4.5", "t");
  });

  it("reports a slug OpenRouter does not list and changes nothing", async () => {
    renderPage(vi.fn().mockRejectedValue(new Error("not found")));
    fireEvent.change(nameInput(), { target: { value: "Hand-written" } });
    typeSlug("nobody/no-such-model");
    fireEvent.click(fillButton());

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert").textContent).toContain("not found");
    expect(nameInput()).toHaveValue("Hand-written");
  });

  it("cannot be pressed without a slug to look up", async () => {
    renderPage();
    expect(fillButton()).toBeDisabled();
    // Whitespace is not a slug.
    typeSlug("   ");
    expect(fillButton()).toBeDisabled();

    typeSlug("anthropic/claude-sonnet-4.5");
    expect(fillButton()).not.toBeDisabled();
    await settle();
  });
});

describe("ModelConfigPage's save failure", () => {
  const saveButton = () => screen.getByRole("button", { name: "Create model" });

  it("reports the failure above the button that raised it", async () => {
    renderPage(
      vi.fn(),
      vi.fn().mockRejectedValue(new Error("slug already taken")),
    );
    fireEvent.change(nameInput(), { target: { value: "Hand-written" } });
    fireEvent.click(saveButton());

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("slug already taken");
    // Above, not below: an error rendered after the actions sits past the fold on
    // a form this tall, so the press reads as having done nothing at all.
    expect(
      alert.compareDocumentPosition(saveButton()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("re-enables the button so the operator can fix it and retry", async () => {
    renderPage(vi.fn(), vi.fn().mockRejectedValue(new Error("nope")));
    fireEvent.change(nameInput(), { target: { value: "Hand-written" } });
    fireEvent.click(saveButton());

    await screen.findByRole("alert");
    expect(saveButton()).not.toBeDisabled();
  });
});
