// The figure row every module surface states its numbers in.
//
// A module is read on four surfaces (an agent's `modules/` folder, the Modules tab's kind
// overview and instance detail, an agent profile's row), and each of them has numbers to
// state about the store: how many turns a window has seen, how many instances of a kind
// exist, how much an archive took out of the window. They were previously three different
// shapes — a label/value definition list, a run-on caption, a stat grid — which read as
// three different *kinds* of fact rather than as the same one about different stores.
//
// So they share one: a grid that spreads the figures across the pane's width, each a large
// value over a muted label. It is the Dashboard's own stat shape (`GgDashboard.module.scss`
// owns the type scale) so a module's numbers read the way a run's do.
//
// It lives here rather than in `GgModuleViews` because the per-kind content views
// (`SkillsList`, `MemoriesList`) use it and that module imports *them* — the shared leaf
// keeps the dependency one-way.

import type { ReactNode } from "react";
import panels from "./GgPanels.module.scss";
import dash from "./GgDashboard.module.scss";

/**
 * The row a module's figures read in: a grid that spreads them across whatever width the
 * pane has rather than stacking them down its left edge.
 *
 * `label` names the row — a bare grid of numbers is announced as loose text, and a panel
 * routinely carries figures that repeat elsewhere on it (a skills store says "2 offered"
 * over a list of rows each badged "read"), so the group is what makes them the *store's*
 * numbers rather than a stray count.
 */
export function ModuleStats({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className={panels.modStats} role="group" aria-label={label}>
      {children}
    </div>
  );
}

/**
 * One figure: the value large, its label under it, and an optional sub-line for the
 * qualifier the label has no room for.
 */
export function ModuleStat({
  label,
  value,
  sub,
  title,
}: {
  label: string;
  value: string;
  sub?: string;
  /** Hover text for a figure whose label cannot say what it measures on its own. */
  title?: string;
}) {
  return (
    <div className={dash.stat} title={title}>
      <span className={dash.statValue}>{value}</span>
      <span className={dash.statLabel}>{label}</span>
      {sub && <span className={dash.statSub}>{sub}</span>}
    </div>
  );
}
