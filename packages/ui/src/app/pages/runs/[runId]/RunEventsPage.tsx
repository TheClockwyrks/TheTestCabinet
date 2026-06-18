import { useState } from "react";
import { SegmentedControl } from "@test-cabinet/ui";
import { EventFeed } from "../../../components/EventFeed";
import { RawOutputLog } from "../../../components/RawOutputLog";
import { RunDetailLayout } from "../../../layouts/runs/RunDetailLayout";
import { useRunEvents } from "../../../data/useRunEvents";
import { useAppSettings } from "../../../store/appSettings";
import styles from "./RunEventsPage.module.scss";

// The Events tab (`/runs/:runId/events`): the run's recorded activity after it
// finished. The normalized (TTC) stream renders in the shared `EventFeed`, in the
// layout the user picked in Appearance — the same treatment as the live monitor.
// Where the host can supply it (the runner consoles), a toggle switches to the
// raw harness output the TTC events were mapped from; the public site publishes
// the TTC stream only, so the toggle is absent there.
export function RunEventsPage() {
  return (
    <RunDetailLayout tab="events">
      {({ run }) => <RunEventsBody runId={run.id} />}
    </RunDetailLayout>
  );
}

type EventsView = "ttc" | "raw";

function RunEventsBody({ runId }: { runId: string }) {
  const state = useRunEvents(runId);
  const feedStyle = useAppSettings((s) => s.eventFeedStyle);
  const [view, setView] = useState<EventsView>("ttc");

  if (state.status === "loading") {
    return <p className={styles.notice}>Loading events…</p>;
  }
  if (state.status === "unsupported") {
    return (
      <p className={styles.notice}>
        Recorded events aren&rsquo;t available for this run here.
      </p>
    );
  }
  if (state.status === "error") {
    return (
      <p className={`${styles.notice} ${styles.error}`}>
        Couldn&rsquo;t load events: {state.message}
      </p>
    );
  }

  const { events, raw } = state.data;
  const hasRaw = raw != null;
  const showRaw = hasRaw && view === "raw";

  return (
    <section className={styles.section}>
      {hasRaw && (
        <div className={styles.controls}>
          <SegmentedControl
            ariaLabel="Event stream"
            value={view}
            onChange={(value) => setView(value as EventsView)}
            options={[
              { value: "ttc", label: "Events" },
              { value: "raw", label: "Raw" },
            ]}
          />
        </div>
      )}
      {showRaw ? (
        <RawOutputLog
          lines={raw ?? []}
          emptyLabel="No raw harness output was recorded for this run."
        />
      ) : (
        <EventFeed
          events={events}
          feedStyle={feedStyle}
          emptyLabel="No events were recorded for this run."
        />
      )}
    </section>
  );
}
