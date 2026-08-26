import { Panel } from "@test-cabinet/ui";
import {
  AESTHETIC_META,
  AESTHETIC_RATINGS,
  RATINGS,
  RATING_META,
} from "../../data/ratings";
import { AboutLayout } from "../../layouts/about/AboutLayout";
import styles from "./AboutRatingsPage.module.scss";

// The Ratings tab (`/about/ratings`): the two five-tier rating scales — the
// functional scale the validators (or, on a legacy version, a reviewer) decide,
// and the aesthetic scale a reviewer rates on a validator-rated run. The scales
// are case-independent, so they live here rather than repeating on every test
// case's Reviewing tab, which links back to this page. Reads no host data, so it
// renders identically on every host.
export function AboutRatingsPage() {
  return (
    <AboutLayout tab="ratings">
      <div className={styles.panels}>
        <Panel>
          <section>
            <h2 className={styles.scaleHeading}>Functional rating scale</h2>
            <p className={styles.scaleNote}>
              On a validator-rated version this is decided by the validators: a
              domain sits at the lowest failure cap among the failing points
              that name it.
            </p>
            <ul className={styles.defList}>
              {RATINGS.map((rating) => (
                <li key={rating} className={styles.defRow} data-rating={rating}>
                  <span className={styles.defTerm}>
                    {RATING_META[rating].label}
                  </span>
                  <span className={styles.defDesc}>
                    {RATING_META[rating].description}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </Panel>

        {/* The second channel, rated by reviewers on a validator-rated version
            only. Legendary is reserved: Amazing is the normal maximum. */}
        <Panel>
          <section>
            <h2 className={styles.scaleHeading}>Aesthetic rating scale</h2>
            <p className={styles.scaleNote}>
              Rated by a reviewer per domain; a run&rsquo;s aesthetic rating is
              the worst across its domains, then across its reviews.
            </p>
            <ul className={styles.defList}>
              {AESTHETIC_RATINGS.map((rating) => (
                <li
                  key={rating}
                  className={styles.defRow}
                  data-aesthetic={rating}
                >
                  <span className={styles.defTerm}>
                    {AESTHETIC_META[rating].label}
                  </span>
                  <span className={styles.defDesc}>
                    {AESTHETIC_META[rating].description}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </Panel>
      </div>
    </AboutLayout>
  );
}
