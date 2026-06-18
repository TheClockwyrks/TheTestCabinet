import { Panel, SegmentedControl } from "@test-cabinet/ui";
import { EventFeed } from "../../components/EventFeed";
import { SAMPLE_FEED_EVENTS } from "../../data/sampleEvents";
import { SettingsLayout } from "../../layouts/settings/SettingsLayout";
import { EVENT_FEED_STYLES, useAppSettings } from "../../store/appSettings";
import styles from "./AppearancePage.module.scss";

// The Appearance tab (`/settings/appearance`): purely visual preferences, shared
// by every host (including the static site). Hosts the synthwave-sun toggle
// (formerly the topbar's standalone control) and the event-feed style picker.
// Both read and write the shared `appSettings` store, so the choices persist and
// the run monitor and the run-detail Events tab render the selected feed style.
export function AppearancePage() {
  const sunEnabled = useAppSettings((s) => s.sunEnabled);
  const setSunEnabled = useAppSettings((s) => s.setSunEnabled);
  const eventFeedStyle = useAppSettings((s) => s.eventFeedStyle);
  const setEventFeedStyle = useAppSettings((s) => s.setEventFeedStyle);

  return (
    <SettingsLayout tab="appearance">
      <Panel className={styles.panel}>
        <section className={styles.setting}>
          <div className={styles.label}>
            <h2 className={styles.title}>Synthwave sun</h2>
            <p className={styles.description}>
              Show or hide the banded sun behind the gallery. The choice persists
              across visits.
            </p>
          </div>
          <SegmentedControl
            ariaLabel="Synthwave sun"
            value={sunEnabled ? "on" : "off"}
            onChange={(value) => setSunEnabled(value === "on")}
            options={[
              { value: "on", label: "On" },
              { value: "off", label: "Off" },
            ]}
          />
        </section>

        <div className={styles.divider} />

        <section className={`${styles.setting} ${styles.split}`}>
          <div className={styles.label}>
            <h2 className={styles.title}>Event feed</h2>
            <p className={styles.description}>
              Choose how harness activity is laid out — both while a run streams
              live and on a finished run's Events tab. The preview shows the
              selected style.
            </p>
          </div>
          <div className={styles.splitBody}>
            <div
              className={styles.options}
              role="radiogroup"
              aria-label="Event feed style"
            >
              {EVENT_FEED_STYLES.map((option) => {
                const selected = option.value === eventFeedStyle;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={
                      selected
                        ? `${styles.option} ${styles.optionActive}`
                        : styles.option
                    }
                    onClick={() => setEventFeedStyle(option.value)}
                  >
                    <span className={styles.optionName}>{option.label}</span>
                    <span className={styles.optionHint}>{option.hint}</span>
                  </button>
                );
              })}
            </div>
            <div className={styles.preview}>
              <EventFeed
                events={SAMPLE_FEED_EVENTS}
                feedStyle={eventFeedStyle}
                preview
              />
            </div>
          </div>
        </section>
      </Panel>
    </SettingsLayout>
  );
}
