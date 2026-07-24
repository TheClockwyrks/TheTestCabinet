import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

// Shared, persisted console preferences for the gallery app.
//
// This is the single source of truth for the user's visual choices that more
// than one component reads (the decorative sun, shared by the WebGL backdrop and
// the topbar/settings toggle; and the live event-feed style, shared by the run
// monitor and its settings preview). It lives in a zustand store rather than a
// React context so any component — inside or outside the router — can read or
// write it without threading a provider through the tree.

// The visual treatments the live harness event feed can render in. Each is a
// distinct layout of the same data (see `EventFeed`); the user picks one in the
// Appearance settings and the run monitor honors it.
export type EventFeedStyle = "gutter" | "divider" | "stacked";

// The selectable feed styles, with the copy the Appearance picker shows. Kept
// here beside the type so the option list and the union never drift.
export const EVENT_FEED_STYLES: ReadonlyArray<{
  value: EventFeedStyle;
  label: string;
  hint: string;
}> = [
  {
    value: "gutter",
    label: "Gutter",
    hint: "Colored bar on the left, label beside the detail.",
  },
  {
    value: "divider",
    label: "Divider",
    hint: "Colored rule between the label and the detail.",
  },
  {
    value: "stacked",
    label: "Stacked",
    hint: "Label above the detail, one event per block.",
  },
];

// One capability's draft state within a saved gg capability-set preset. `enabled`
// toggles the capability on/off; `implementation` is the selected swappable
// implementation (the A/B lever — empty/undefined = the capability's default);
// `params` holds the values of the capability's *dedicated* param controls keyed
// by param name (string form, empty = unset); and `paramsText` is the raw JSON the
// user typed for any *additional* params (empty string = none, i.e. `{}`). Both are
// kept as typed text rather than parsed JSON so an in-progress (not-yet-valid) edit
// round-trips through a save without being silently dropped.
export interface GgCapabilityDraft {
  enabled: boolean;
  implementation?: string;
  // Dedicated param-control values, keyed by param name (e.g. "triggerFullness",
  // "maxParallel"). Optional so presets saved before dedicated controls existed
  // still load (they carry only `paramsText`).
  params?: Record<string, string>;
  paramsText: string;
}

// One model-slot binding as the new-run form holds it: a slot name (e.g. "primary",
// "reviewer") bound either to the offline mock model or to a real model id (with an
// optional pinned provider). The multi-model capability lets a run bind several,
// each possibly cross-provider.
export interface GgSlotDraft {
  slot: string;
  // Whether this slot binds the offline mock model (no API key needed).
  mockModel: boolean;
  // The model id bound to the slot when not using the mock.
  modelId: string;
  // The provider the model is reached through, when pinned (optional).
  provider: string;
}

// A gg capability set as the new-run form holds it, minus the test case/variant
// (which are run-specific, not part of a reusable preset): the per-capability
// drafts, the model-slot bindings, and the per-tool ablation overrides. This is
// exactly what a named preset stores and re-populates.
export interface GgPresetConfig {
  // Keyed by capability id (e.g. "shell", "filesystem", "compaction").
  capabilities: Record<string, GgCapabilityDraft>;
  // The model-slot bindings (the multi-model surface). Optional so presets saved
  // before multi-slot support still load — a legacy preset carries the single
  // primary binding in the `mockModel`/`modelId`/`provider` fields below instead.
  slots?: GgSlotDraft[];
  // Individual tool names withheld from the agent even when their capability is on
  // (the finest-grained ablation lever). Optional for the same back-compat reason.
  disabledTools?: string[];
  // --- Legacy single-primary-slot fields (read when `slots` is absent) ----------
  // Whether the primary slot binds the offline mock model (no API key needed).
  mockModel?: boolean;
  // The model id bound to the primary slot when not using the mock.
  modelId?: string;
  // The provider the primary model is reached through, when pinned (optional).
  provider?: string;
}

// A user-named, client-persisted gg capability-set preset. The design calls for
// capability sets to be "named / preset-able" so a study is a sweep over presets
// rather than hand-assembled flag soup; Phase 0 persists these locally (there is
// no server-side preset store yet).
export interface GgSavedPreset {
  name: string;
  config: GgPresetConfig;
}

interface AppSettings {
  // Whether the banded synthwave sun is shown in the backdrop. On by default;
  // the user can opt out from the topbar (site) or Appearance settings (console).
  sunEnabled: boolean;
  // How the live harness event feed renders. Defaults to the original layout.
  eventFeedStyle: EventFeedStyle;
  // The user's saved gg capability-set presets (see `GgSavedPreset`). Empty until
  // the operator saves one from the gg new-run form.
  ggPresets: GgSavedPreset[];
  setSunEnabled: (enabled: boolean) => void;
  toggleSun: () => void;
  setEventFeedStyle: (style: EventFeedStyle) => void;
  // Save (or overwrite, by name) a gg capability-set preset.
  saveGgPreset: (name: string, config: GgPresetConfig) => void;
  // Delete a saved gg preset by name.
  deleteGgPreset: (name: string) => void;
}

const STORAGE_KEY = "ttc:settings";

// An in-memory stand-in used when `localStorage` is unavailable (private mode,
// the static site's prerender step). Persistence is best-effort: the store still
// works, the choice just doesn't survive a reload in those environments.
function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
}

function backingStorage() {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // Access itself can throw under strict privacy settings.
  }
  return memoryStorage();
}

export const useAppSettings = create<AppSettings>()(
  persist(
    (set) => ({
      sunEnabled: true,
      eventFeedStyle: "gutter",
      ggPresets: [],
      setSunEnabled: (enabled) => set({ sunEnabled: enabled }),
      toggleSun: () => set((state) => ({ sunEnabled: !state.sunEnabled })),
      setEventFeedStyle: (style) => set({ eventFeedStyle: style }),
      saveGgPreset: (name, config) =>
        set((state) => ({
          // Upsert by name so re-saving under an existing name overwrites it
          // rather than accumulating duplicates.
          ggPresets: [
            ...state.ggPresets.filter((p) => p.name !== name),
            { name, config },
          ],
        })),
      deleteGgPreset: (name) =>
        set((state) => ({
          ggPresets: state.ggPresets.filter((p) => p.name !== name),
        })),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(backingStorage),
      // Only the choices are persisted; the actions are recreated each load.
      partialize: (state) => ({
        sunEnabled: state.sunEnabled,
        eventFeedStyle: state.eventFeedStyle,
        ggPresets: state.ggPresets,
      }),
    },
  ),
);
