import gg from "./GgConfigEditor.module.scss";

/** One tab in a gg editor's strip. */
export interface GgEditorTab<T extends string> {
  /** The tab's stable key — what [GgEditorTabs.active] is compared against. */
  key: T;
  label: string;
  /**
   * How many things on this tab are wrong, badged beside its label. `0` (or absent)
   * badges nothing.
   *
   * Carried on the tab rather than left to the section itself because a tabbed form
   * hides most of itself: a save gate that says "the `reviewer` agent defers to no
   * declared slot" is naming a field on a tab the operator may not be looking at, and a
   * gate you cannot find is indistinguishable from a form that will not save.
   */
  problems?: number;
}

interface GgEditorTabsProps<T extends string> {
  /** The tabs to show, in display order. */
  tabs: ReadonlyArray<GgEditorTab<T>>;
  /** Which one is open. */
  active: T;
  /** Open another one. */
  onChange: (tab: T) => void;
  /** What the strip is a strip *of*, for assistive technology. */
  ariaLabel: string;
}

/**
 * The tab strip both gg editors are organized by — the configuration's
 * (Configuration / Slots / Agents) and an agent's (Agent / Tools / APIs / …).
 *
 * Visually the strip the test-case detail pages use, so the console has one tab idiom.
 * Structurally it is **not** that one: those tabs are routes, and these cannot be. The
 * editor holds a draft that has not been saved anywhere, so a tab has to be a control
 * inside one mounted form rather than a link to a page — a route per tab would either
 * throw the draft away on every switch or mint URLs that reopen a form whose contents
 * are gone.
 *
 * Rendered as a `tablist` of buttons for the same reason: a tab here does not navigate,
 * and marking it up as a link would promise a destination that does not exist.
 */
export function GgEditorTabs<T extends string>({
  tabs,
  active,
  onChange,
  ariaLabel,
}: GgEditorTabsProps<T>) {
  return (
    <div className={gg.tabsBar}>
      <nav className={gg.tabs} role="tablist" aria-label={ariaLabel}>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={tab.key === active}
            className={
              tab.key === active ? `${gg.tab} ${gg.tabActive}` : gg.tab
            }
            onClick={() => onChange(tab.key)}
          >
            {/* The label in its own element so the badge beside it is never read as part
                of the tab's name — "States1" is not a section anybody is looking for. */}
            <span className={gg.tabLabel}>{tab.label}</span>
            {tab.problems ? (
              <span
                className={gg.tabProblem}
                aria-label={`${tab.problems} problem${tab.problems === 1 ? "" : "s"}`}
              >
                {tab.problems}
              </span>
            ) : null}
          </button>
        ))}
      </nav>
    </div>
  );
}
