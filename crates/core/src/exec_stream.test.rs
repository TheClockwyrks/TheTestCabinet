use std::time::Duration;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

use super::*;

/// Records everything forwarded to it, tagged with the stream it came from, so a
/// test can assert on both the capture and the live forwarding.
#[derive(Default)]
struct RecordingSink {
    lines: Vec<(OutputStream, String)>,
}

impl OutputSink for RecordingSink {
    fn on_line(&mut self, stream: OutputStream, line: &str) {
        self.lines.push((stream, line.to_string()));
    }
}

/// Wrap an in-memory byte slice as a line reader that closes once exhausted.
fn reader(text: &'static str) -> Lines<BufReader<&'static [u8]>> {
    BufReader::new(text.as_bytes()).lines()
}

#[tokio::test]
async fn drains_both_streams_until_they_close() {
    let mut sink = RecordingSink::default();
    let drained = drain_with_idle_timeout(
        &mut reader("out one\nout two\n"),
        &mut reader("err one\n"),
        None,
        &mut sink,
    )
    .await
    .expect("draining closed streams succeeds");

    assert_eq!(drained.stdout, "out one\nout two\n");
    assert_eq!(drained.stderr, "err one\n");
    assert!(!drained.idle_timed_out);
    assert_eq!(sink.lines.len(), 3);
    assert!(
        sink.lines
            .iter()
            .any(|(stream, line)| *stream == OutputStream::Stderr && line == "err one")
    );
}

#[tokio::test(start_paused = true)]
async fn fires_once_no_line_arrives_within_the_timeout() {
    // Holding the write half open without writing leaves the read half pending
    // forever — a harness that hangs without exiting.
    let (silent, _writer) = tokio::io::duplex(64);
    let mut sink = RecordingSink::default();

    let drained = drain_with_idle_timeout(
        &mut BufReader::new(silent).lines(),
        &mut reader(""),
        Some(Duration::from_secs(60)),
        &mut sink,
    )
    .await
    .expect("an idle timeout is reported, not raised");

    assert!(drained.idle_timed_out);
    assert!(drained.stdout.is_empty());
}

#[tokio::test(start_paused = true)]
async fn keeps_the_output_produced_before_the_hang() {
    let (stream, mut writer) = tokio::io::duplex(64);
    tokio::spawn(async move {
        writer
            .write_all(b"progress\n")
            .await
            .expect("writing to the duplex succeeds");
        // Then go quiet, still holding the stream open.
        std::future::pending::<()>().await;
    });

    let mut sink = RecordingSink::default();
    let drained = drain_with_idle_timeout(
        &mut BufReader::new(stream).lines(),
        &mut reader(""),
        Some(Duration::from_secs(60)),
        &mut sink,
    )
    .await
    .expect("an idle timeout is reported, not raised");

    assert!(drained.idle_timed_out);
    assert_eq!(drained.stdout, "progress\n");
    assert_eq!(sink.lines, vec![(OutputStream::Stdout, "progress".into())]);
}

#[tokio::test(start_paused = true)]
async fn every_line_pushes_the_deadline_out() {
    // Lines arrive steadily at half the idle timeout, so a watchdog that measures
    // the gap between lines never fires even though the command as a whole runs
    // for several times the timeout.
    let (stream, mut writer) = tokio::io::duplex(256);
    tokio::spawn(async move {
        for _ in 0..6 {
            tokio::time::sleep(Duration::from_secs(30)).await;
            writer
                .write_all(b"still working\n")
                .await
                .expect("writing to the duplex succeeds");
        }
        // Dropping the writer closes the stream, ending the drain.
    });

    let mut sink = RecordingSink::default();
    let drained = drain_with_idle_timeout(
        &mut BufReader::new(stream).lines(),
        &mut reader(""),
        Some(Duration::from_secs(60)),
        &mut sink,
    )
    .await
    .expect("draining a steadily-producing command succeeds");

    assert!(!drained.idle_timed_out);
    assert_eq!(sink.lines.len(), 6);
}

#[tokio::test(start_paused = true)]
async fn a_quiet_stream_does_not_trip_the_watchdog_while_the_other_produces() {
    // stderr stays open and silent for the whole run: only *total* silence counts
    // as hung, so stdout's traffic keeps the watchdog at bay.
    let (quiet, _quiet_writer) = tokio::io::duplex(64);
    let (busy, mut writer) = tokio::io::duplex(256);
    tokio::spawn(async move {
        for _ in 0..4 {
            tokio::time::sleep(Duration::from_secs(30)).await;
            writer
                .write_all(b"tick\n")
                .await
                .expect("writing to the duplex succeeds");
        }
    });

    let mut sink = RecordingSink::default();
    let drained = drain_with_idle_timeout(
        &mut BufReader::new(busy).lines(),
        &mut BufReader::new(quiet).lines(),
        Some(Duration::from_secs(60)),
        &mut sink,
    )
    .await
    .expect("draining succeeds");

    // The busy stream closes; the quiet one never does, so the watchdog is what
    // ends the drain — but only after the work stopped, not during it.
    assert!(drained.idle_timed_out);
    assert_eq!(drained.stdout, "tick\ntick\ntick\ntick\n");
}
