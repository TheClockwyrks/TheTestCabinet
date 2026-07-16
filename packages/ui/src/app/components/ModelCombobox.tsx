import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { HarnessFamily, Model } from "../../client/types";
import styles from "./ModelCombobox.module.scss";

// One selectable model in the combobox's list. `id` is the canonical model id the
// field commits when the option is picked; `label` is the human display name shown
// beside it; `curated` splits the list into the "Known" (curated catalog) and
// "Previously used" (derived-from-runs) groups; `search` is the lowercased haystack
// (name + slug + the family's aliases) the typed query filters against.
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
  /** When set, offer only the slugs usable with this harness family, and commit
   * the family-appropriate slug (e.g. `claude-opus-4-8` for `claude`,
   * `anthropic/claude-opus-4.8` for `openrouter`). A model with no slug in the
   * family is omitted — that harness can't launch it. When omitted, every slug is
   * offered (an unfiltered picker). Free text is always accepted regardless. */
  harnessFamily?: HarnessFamily;
  /** Optional id for the input (so a `<label>` can point at it). */
  id?: string;
  placeholder?: string;
  /** Extra class for the text input (e.g. the shared field `input` styling). */
  inputClassName?: string;
}

function buildOptions(models: Model[], family?: HarnessFamily): ModelOption[] {
  const seen = new Set<string>();
  const opts: ModelOption[] = [];
  for (const m of models) {
    // The slugs usable with the selected harness family. With no family the picker
    // is unscoped and offers every slug.
    const familyAliases =
      family === undefined
        ? m.aliases
        : m.aliases.filter((a) => a.harnessFamily === family);
    // A model with no slug for this family can't be launched by the harness, so it
    // isn't offered (the operator can still type an id verbatim).
    if (family !== undefined && familyAliases.length === 0) continue;
    // The canonical id the run should carry — the family's first slug, falling back
    // to the model's slug. Skip duplicates so two entries claiming the same id
    // don't double up.
    const id = familyAliases[0]?.slug ?? m.slug;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    opts.push({
      id,
      label: m.name,
      curated: m.curated,
      search: [m.name, m.slug, ...familyAliases.map((a) => a.slug)]
        .join(" ")
        .toLowerCase(),
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
  harnessFamily,
  id,
  placeholder,
  inputClassName,
}: ModelComboboxProps) {
  const reactId = useId();
  const listId = `${reactId}-list`;
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  // Whether the field's current text is a query the user is actively typing (as
  // opposed to a committed/seeded model id). The list only narrows to the value
  // while typing — otherwise opening a field that already holds a selected id
  // (the batch form seeds each row's model) would substring-match that full id
  // and collapse the whole catalog down to the one selected model.
  const [typing, setTyping] = useState(false);

  const options = useMemo(
    () => buildOptions(models, harnessFamily),
    [models, harnessFamily],
  );

  // Filter against the typed query. When not actively typing (a committed or
  // seeded value, or an empty field) the full list shows; while typing, a simple
  // substring match over each option's name/slug/aliases narrows it. Known models
  // lead so the curated catalog surfaces first.
  const filtered = useMemo(() => {
    const query = typing ? value.trim().toLowerCase() : "";
    const matches = query
      ? options.filter((o) => o.search.includes(query))
      : options;
    const known = matches.filter((o) => o.curated);
    const used = matches.filter((o) => !o.curated);
    return { known, used, flat: [...known, ...used] };
  }, [options, value, typing]);

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
    // The value is now a committed selection, not a query — reopening should show
    // the full list again rather than narrowing to the just-picked id.
    setTyping(false);
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
  function renderGroup(heading: string, group: ModelOption[], offset: number) {
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
          // A keystroke turns the field into a live query, narrowing the list.
          setTyping(true);
        }}
        onFocus={() => {
          setOpen(true);
          // Focusing a field that holds a committed/seeded id shows the whole
          // catalog; typing then narrows it.
          setTyping(false);
        }}
        onKeyDown={onKeyDown}
      />
      {open && hasOptions && (
        <ul id={listId} className={styles.list} role="listbox">
          {renderGroup("Known", filtered.known, 0)}
          {renderGroup("Previously used", filtered.used, filtered.known.length)}
        </ul>
      )}
    </div>
  );
}
