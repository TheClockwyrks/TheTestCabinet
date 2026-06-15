import type { ReactNode } from "react";
import { Link } from "react-router";
import { routes } from "../routes";
import { CabinetIcon } from "./CabinetIcon";
import styles from "./PageLayout.module.scss";

interface PageLayoutProps {
  children: ReactNode;
}

// Shared app chrome: a persistent topbar with the cabinet mark and wordmark,
// plus the routed page body. The topbar is intentionally lightweight — each
// page (and each gallery variant) supplies its own hero beneath it. All colors
// flow from the active design variant's palette.
export function PageLayout({ children }: PageLayoutProps) {
  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <Link to={routes.galleryIndex()} className={styles.brand}>
          <CabinetIcon className={styles.mark} />
          <span className={styles.wordmark}>The Test Cabinet</span>
        </Link>
        <span className={styles.note}>Old games. New AI.</span>
      </header>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
