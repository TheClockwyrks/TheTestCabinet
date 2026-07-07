import { useCallback, useEffect, useMemo, useState } from "react";

/** The minimal shape {@link useColumnVisibility} needs from a column. */
export interface ToggleableColumn {
  id: string;
  /**
   * Whether the user may hide this column. A column that isn't optional is
   * always shown and never appears in the picker (e.g. the caret gutter); every
   * data column is optional so it can be toggled from the picker.
   */
  optional?: boolean;
  /** Whether an optional column starts visible. Defaults to true. */
  defaultVisible?: boolean;
}

interface ColumnVisibility {
  /** Whether a column is currently shown. Non-optional columns are always true. */
  isVisible: (id: string) => boolean;
  /** Flip an optional column's visibility and persist the choice. */
  toggle: (id: string) => void;
}

// Persisted per-column overrides. Only columns the user has explicitly toggled
// away from their default are stored, so a newly-added column adopts its own
// default rather than being forced visible/hidden by a stale saved set.
type Overrides = Record<string, boolean>;

function load(storageKey: string): Overrides {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const overrides: Overrides = {};
      for (const [id, value] of Object.entries(parsed)) {
        if (typeof value === "boolean") overrides[id] = value;
      }
      return overrides;
    }
  } catch {
    // Corrupt or unavailable storage: fall back to every column's default.
  }
  return {};
}

function save(storageKey: string, overrides: Overrides): void {
  if (typeof localStorage === "undefined") return;
  try {
    if (Object.keys(overrides).length === 0) localStorage.removeItem(storageKey);
    else localStorage.setItem(storageKey, JSON.stringify(overrides));
  } catch {
    // Non-fatal: the choice just won't survive a reload.
  }
}

/**
 * Tracks which optional columns of a table are shown, persisted under
 * `storageKey`. A column is visible when it isn't optional, or when its stored
 * override (else its `defaultVisible`, else true) is true. Storing only explicit
 * overrides keeps a later-added column on its own default instead of inheriting a
 * stale saved visibility.
 */
export function useColumnVisibility(
  storageKey: string,
  columns: readonly ToggleableColumn[],
): ColumnVisibility {
  const [overrides, setOverrides] = useState<Overrides>(() => load(storageKey));

  useEffect(() => {
    save(storageKey, overrides);
  }, [storageKey, overrides]);

  const defaults = useMemo(() => {
    const map = new Map<string, { optional: boolean; visible: boolean }>();
    for (const col of columns) {
      map.set(col.id, {
        optional: col.optional === true,
        visible: col.defaultVisible !== false,
      });
    }
    return map;
  }, [columns]);

  const isVisible = useCallback(
    (id: string) => {
      const def = defaults.get(id);
      if (!def || !def.optional) return true;
      return overrides[id] ?? def.visible;
    },
    [defaults, overrides],
  );

  const toggle = useCallback(
    (id: string) => {
      const def = defaults.get(id);
      if (!def || !def.optional) return;
      setOverrides((current) => {
        const shown = current[id] ?? def.visible;
        const next = { ...current };
        // If flipping lands back on the column's default, drop the override so
        // storage stays minimal (and future default changes apply).
        if (!shown === def.visible) delete next[id];
        else next[id] = !shown;
        return next;
      });
    },
    [defaults],
  );

  return { isVisible, toggle };
}
