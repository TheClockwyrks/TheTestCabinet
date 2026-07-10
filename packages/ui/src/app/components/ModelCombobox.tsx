import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Model } from "../../client/types";
import styles from "./ModelCombobox.module.scss";

// One selectable model in the combobox's list. `id` is the canonical model id the
// field commits when the option is picked; `label` is the human display name shown
// beside it; `curated` splits the list into the "Known" (curated catalog) and
// "Previously used" (derived-from-runs) groups; `search` is the lowercased haystack
// (name + slug + every alias) the typed query filters against.
interface ModelOption {
  id: string;
  label: string;
  curated: boolean;
  search: string;
}

interface ModelComboboxProps {
  /** The current model id (free text — not required to match a listed option). */
  value: string;
  /** Called with the new model id on every edit or selection. */
  onChange: (value: string) => void;
  /** The backend model catalog; each entry contributes one option. */
  models: Model[];
  /** Optional id for the input (so a `<label>` can point at it). */
  id?: string;
  placeholder?: string;
  /** Extra class for the text input (e.g. the shared field `input` styling). */
  inputClassName?: string;
}

function buildOptions(models: Model[]): ModelOption[] {
  const seen = new Set<string>();
  const opts: ModelOption[] = [];
  for (const m of models) {
    // The canonical id the run should carry — the model's first alias, falling
    // back to its slug. Skip duplicates so two catalog entries claiming the same
    // canonical id don't double up.
    const id = m.aliases[0] ?? m.slug;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    opts.push({
      id,
      label: m.name,
      curated: m.curated,
      search: [m.name, m.slug, ...m.aliases].join(" ").toLowerCase(),
    });
  }
  return opts;
}

/**
 * A model picker that accepts either a KNOWN model (any id/alias from the backend
 * catalog — which already includes every previously-run model) or an arbitrary new
 * model id typed verbatim. It is a text input with a filtered dropdown: the typed
 * text is always the committed value (free text is a first-class choice), while the
 * list offers curated ("Known") and derived ("Previously used") models with their
 * display names for discovery. Keyboard accessible — type to filter, ↑/↓ to move,
 * Enter to pick the highlighted option, Escape to close.
 *
 * Reusable by design: the batch run form renders one per combination row.
 */
export function ModelCombobox({
  value,
  onChange,
  models,
  id,
  placeholder,
  inputClassName,
}: ModelComboboxProps) {
  const reactId = useId();
  const listId = `${reactId}-list`;
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);

  const options = useMemo(() => buildOptions(models), [models]);

  // Filter against the typed query. An empty field lists everything; otherwise a
  // simple substring match over each option's name/slug/aliases. Known models lead
  // so the curated catalog surfaces first.
  const filtered = useMemo(() => {
    const query = value.trim().toLowerCase();
    const matches = query
      ? options.filter((o) => o.search.includes(query))
      : options;
    const known = matches.filter((o) => o.curated);
    const used = matches.filter((o) => !o.curated);
    return { known, used, flat: [...known, ...used] };
  }, [options, value]);

  // Close on an outside pointerdown; the input's own blur is not enough because a
  // click on an option must fire first (handled via mousedown-preventDefault).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (wrapRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function commit(option: ModelOption) {
    onChange(option.id);
    setOpen(false);
    setHighlight(-1);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setHighlight((h) => Math.min(h + 1, filtered.flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      const picked = filtered.flat[highlight];
      if (open && picked) {
        e.preventDefault();
        commit(picked);
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setOpen(false);
        setHighlight(-1);
      }
    }
  }

  const hasOptions = filtered.flat.length > 0;

  // Render one group (Known / Previously used) with a non-selectable heading. The
  // `offset` maps each option to its index in the flat highlight list so keyboard
  // and pointer highlighting agree.
  function renderGroup(
    heading: string,
    group: ModelOption[],
    offset: number,
  ) {
    if (group.length === 0) return null;
    return (
      <li role="presentation">
        <p className={styles.groupHeading} role="presentation">
          {heading}
        </p>
        <ul className={styles.groupList} role="presentation">
          {group.map((o, i) => {
            const index = offset + i;
            const active = index === highlight;
            return (
              <li
                key={o.id}
                id={`${reactId}-opt-${index}`}
                role="option"
                aria-selected={active}
                className={`${styles.option}${active ? ` ${styles.optionActive}` : ""}`}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => commit(o)}
              >
                <span className={styles.optionLabel}>{o.label}</span>
                <span className={styles.optionId}>{o.id}</span>
              </li>
            );
          })}
        </ul>
      </li>
    );
  }

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <input
        id={id}
        className={inputClassName}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          open && highlight >= 0 ? `${reactId}-opt-${highlight}` : undefined
        }
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setHighlight(-1);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {open && hasOptions && (
        <ul id={listId} className={styles.list} role="listbox">
          {renderGroup("Known", filtered.known, 0)}
          {renderGroup(
            "Previously used",
            filtered.used,
            filtered.known.length,
          )}
        </ul>
      )}
    </div>
  );
}
