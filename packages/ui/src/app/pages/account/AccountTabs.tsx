import { NavLink } from "react-router";
import { routes } from "../../routes";
import styles from "./AccountTabs.module.scss";

// Which account surface the rendering page represents, so its tab reads as active.
export type AccountTab = "profile" | "coverage" | "groups";

// The shared tab navigation across the account section. Each tab is its own route
// (so a surface is linkable), mirroring the runs section's tab bar. The whole
// section is console-only reviewer tooling gated on a signed-in account, so the
// caller only ever renders this for a signed-in reviewer — there is no public
// variant to drop tabs for.
export function AccountTabs({ active }: { active: AccountTab }) {
  const tabs: { key: AccountTab; label: string; to: string }[] = [
    { key: "profile", label: "Profile", to: routes.account() },
    { key: "coverage", label: "Coverage", to: routes.accountCoverage() },
    { key: "groups", label: "Groups", to: routes.accountGroups() },
  ];
  return (
    <nav className={styles.tabs} aria-label="Account sections">
      {tabs.map((entry) => (
        <NavLink
          key={entry.key}
          to={entry.to}
          className={
            entry.key === active
              ? `${styles.tab} ${styles.tabActive}`
              : styles.tab
          }
        >
          {entry.label}
        </NavLink>
      ))}
    </nav>
  );
}
