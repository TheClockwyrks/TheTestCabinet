import type { ReactNode } from "react";
import { Link } from "react-router";
import { routes } from "../routes";
import styles from "./PageLayout.module.scss";

interface PageLayoutProps {
  children: ReactNode;
}

export function PageLayout({ children }: PageLayoutProps) {
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <h1 className={styles.title}>
          <Link to={routes.galleryIndex()}>The Test Cabinet</Link>
        </h1>
        <p className={styles.tagline}>
          A gallery of agent runs. Browse, compare metrics, and play the builds.
          Not a leaderboard.
        </p>
      </header>
      <main>{children}</main>
    </div>
  );
}
