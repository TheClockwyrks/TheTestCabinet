import { Link } from "react-router";
import { routes } from "../../routes";
import styles from "./AccountTabs.module.scss";

// Which account surface the rendering page represents, so its tab reads as active.
export type AccountTab =
  | "profile"
  | "reviews"
  | "coverage"
  | "ladders"
  | "groups"
  | "ggAgents"
  | "ggConfigs";

// The shared tab navigation across the account section. Each tab is its own route
// (so a surface is linkable), mirroring the runs section's tab bar. The whole
// section is console-only reviewer tooling gated on a signed-in account, so the
// caller only ever renders this for a signed-in reviewer — there is no public
// variant to drop tabs for.
//
// `aria-current` follows the caller's `active` rather than the URL, so the
// announced tab is always the one drawn as selected. A route-matched flag would
// disagree on every nested page: `/account` is a prefix of every other tab's path,
// and an editor like `/account/gg/:configId/edit` is not the list route its tab
// points at.
export function AccountTabs({ active }: { active: AccountTab }) {
  const tabs: { key: AccountTab; label: string; to: string }[] = [
    { key: "profile", label: "Profile", to: routes.account() },
    { key: "reviews", label: "Reviews", to: routes.accountReviews() },
    { key: "coverage", label: "Coverage", to: routes.accountCoverage() },
    // Ladders sit beside Coverage because they are the same tool asked a different
    // question — one fills a matrix, the other walks an ordered climb — and both are
    // fed from the same groups on the tab after them.
    { key: "ladders", label: "Ladders", to: routes.accountLadders() },
    { key: "groups", label: "Groups", to: routes.accountGroups() },
    // gg's two libraries are two tabs rather than one tab holding two lists: they
    // are edited at different rates — a configuration is a whole run's shape, an
    // agent is one profile several configurations share — and an operator
    // authoring the second should reach it the same way they reach every other
    // surface in this section. Agents lead because they are the part authored
    // first and reused most: a configuration is assembled from them.
    { key: "ggAgents", label: "gg Agents", to: routes.accountGgAgents() },
    { key: "ggConfigs", label: "gg Configs", to: routes.accountGgConfigs() },
  ];
  return (
    <nav className={styles.tabs} aria-label="Account sections">
      {tabs.map((entry) => (
        <Link
          key={entry.key}
          to={entry.to}
          className={
            entry.key === active
              ? `${styles.tab} ${styles.tabActive}`
              : styles.tab
          }
          aria-current={entry.key === active ? "page" : undefined}
        >
          {entry.label}
        </Link>
      ))}
    </nav>
  );
}
