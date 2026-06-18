import type { ReactNode } from "react";
import { Link, NavLink, useParams } from "react-router";
import { PageLayout } from "../../components/PageLayout";
import { providerLogo } from "../../data/providerLogo";
import type { ModelSummary } from "../../data/models";
import { useModels } from "../../data/useModels";
import { routes } from "../../routes";
import styles from "./ModelDetailLayout.module.scss";

// The model detail page's tabs. Each is a distinct route; this drives which tab
// link reads as active.
export type ModelDetailTab = "about" | "stats" | "runs";

interface ModelDetailLayoutProps {
  /** Which tab the rendering page represents. */
  tab: ModelDetailTab;
  /** The tab body, given the resolved model. */
  children: (ctx: { model: ModelSummary }) => ReactNode;
}

// Shared chrome for every model detail tab: the provider mark and model name,
// the OpenRouter link, the provider line, and the tab navigation. It resolves
// the model from the URL — by catalog slug or by a covered model id, so both
// `/models/<slug>` and `/models/<modelId>` land here — then hands it to the
// active tab's body. Resolving (and the unknown-model state) lives here so the
// tab pages stay thin and never duplicate it.
export function ModelDetailLayout({ tab, children }: ModelDetailLayoutProps) {
  const { modelId } = useParams<{ modelId: string }>();
  const { models } = useModels();
  const model = models.find(
    (entry) => entry.slug === modelId || entry.modelIds.includes(modelId ?? ""),
  );

  if (!model) {
    return (
      <PageLayout>
        <p className={styles.empty}>Unknown model: {modelId}</p>
        <p className={styles.line}>
          <Link to={routes.models()}>&larr; All models</Link>
        </p>
      </PageLayout>
    );
  }

  const logo = providerLogo(model.provider);
  const tabs: { key: ModelDetailTab; label: string; to: string }[] = [
    { key: "about", label: "About", to: routes.modelDetail(model.slug) },
    { key: "stats", label: "Stats", to: routes.modelStats(model.slug) },
    { key: "runs", label: "Runs", to: routes.modelRuns(model.slug) },
  ];

  return (
    <PageLayout>
      <header className={styles.identity}>
        <p className={styles.crumb}>
          <Link to={routes.models()}>&larr; Models</Link>
        </p>
        <div className={styles.titleRow}>
          {/* Provider mark hugging the model name, then the OpenRouter link
              pushed to the right edge. */}
          <span className={styles.nameGroup}>
            {logo && (
              <span
                className={styles.logo}
                style={{
                  maskImage: `url(${logo})`,
                  WebkitMaskImage: `url(${logo})`,
                }}
                aria-hidden="true"
              />
            )}
            <h1 className={styles.title}>{model.name}</h1>
          </span>
          {model.openrouterUrl && (
            <a
              className={styles.openrouter}
              href={model.openrouterUrl}
              target="_blank"
              rel="noreferrer"
              aria-label="View on OpenRouter"
              title="View on OpenRouter"
            >
              <span className={styles.openrouterIcon} aria-hidden="true" />
            </a>
          )}
        </div>
        <p className={styles.provider}>{model.provider}</p>
      </header>

      <div className={styles.controls}>
        <nav className={styles.tabs} aria-label="Model sections">
          {tabs.map((entry) => (
            <NavLink
              key={entry.key}
              to={entry.to}
              className={
                entry.key === tab
                  ? `${styles.tab} ${styles.tabActive}`
                  : styles.tab
              }
            >
              {entry.label}
            </NavLink>
          ))}
        </nav>
      </div>

      {children({ model })}
    </PageLayout>
  );
}
