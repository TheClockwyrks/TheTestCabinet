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

interface AppSettings {
  // Whether the banded synthwave sun is shown in the backdrop. On by default;
  // the user can opt out from the topbar (site) or Appearance settings (console).
  sunEnabled: boolean;
  // How the live harness event feed renders. Defaults to the original layout.
  eventFeedStyle: EventFeedStyle;
  setSunEnabled: (enabled: boolean) => void;
  toggleSun: () => void;
  setEventFeedStyle: (style: EventFeedStyle) => void;
}

const STORAGE_KEY = "ttc:settings";
const LEGACY_SUN_KEY = "ttc:backdrop:sun";

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

// Seed the sun from the pre-store key so a returning user who had hidden it keeps
// it hidden. Only consulted for the initial state; once the store persists under
// its own key this legacy value is never read again.
function legacySunEnabled(): boolean {
  try {
    return window.localStorage.getItem(LEGACY_SUN_KEY) !== "false";
  } catch {
    return true;
  }
}

export const useAppSettings = create<AppSettings>()(
  persist(
    (set) => ({
      sunEnabled: legacySunEnabled(),
      eventFeedStyle: "gutter",
      setSunEnabled: (enabled) => set({ sunEnabled: enabled }),
      toggleSun: () => set((state) => ({ sunEnabled: !state.sunEnabled })),
      setEventFeedStyle: (style) => set({ eventFeedStyle: style }),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(backingStorage),
      // Only the choices are persisted; the actions are recreated each load.
      partialize: (state) => ({
        sunEnabled: state.sunEnabled,
        eventFeedStyle: state.eventFeedStyle,
      }),
    },
  ),
);
