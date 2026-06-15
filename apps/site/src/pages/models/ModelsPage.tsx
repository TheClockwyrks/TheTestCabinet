import { Link } from "react-router";
import { PageLayout } from "../../components/PageLayout";
import { useModels } from "../../data/useModels";
import { routes } from "../../routes";
import styles from "./ModelsPage.module.scss";

// Models: the curated catalog as a grid of neon-outlined cards, one per model,
// each showing its name and provider and linking to the model's detail page.
// This is a browse view, not a leaderboard — models are listed in catalog
// order with no ranking or score.
export function ModelsPage() {
  const { models } = useModels();

  return (
    <PageLayout>
      <section className={styles.section}>
        <header className={styles.hero}>
          <p className={styles.prompt}>
            <span className={styles.caret}>&gt;</span> the-test-cabinet --models
          </p>
          <p className={styles.comment}>
            // the models we put through the cabinet
          </p>
        </header>

        {models.length === 0 ? (
          <p className={styles.empty}>No models are in the catalog yet.</p>
        ) : (
          <div className={styles.grid}>
            {models.map((model) => (
              <Link
                key={model.slug}
                to={routes.modelDetail(model.slug)}
                className={styles.card}
              >
                <span className={styles.name}>{model.name}</span>
                <span className={styles.provider}>{model.provider}</span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </PageLayout>
  );
}
