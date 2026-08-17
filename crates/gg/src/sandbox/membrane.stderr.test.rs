//! **The bound on a guest's standard error** — what survives it, what it deletes, and whether what
//! it says about the deletion is true.
//!
//! [`GuestStderr`] is the one channel every arm's runtime writes its dying words to, and the eleven
//! runtimes disagree about which end of it carries the fault. Mono names a
//! `StackOverflowException` on the first line and then repeats one frame for fifty kilobytes;
//! `std`'s panic and Swift's `fatalError` are the last thing written, after however much the
//! program itself put on fd 2. So the bound keeps both ends, and these are the assertions that hold
//! it to that and to counting what it dropped.
//!
//! **No wasm here.** The channel is written the way WASI writes it, through
//! [`OutputStream::write`](wasmtime_wasi::p2::OutputStream::write), and read the way
//! [`classify`](super::engine::classify) reads it. The end-to-end proof that a real runtime's words
//! survive a real program is each arm's own [G8](super::language::g8) cell, and C#'s resource fault
//! is the one that fails if either end of this is dropped.

use wasmtime_wasi::p2::OutputStream;

use super::*;

/// Write `text` to the channel the way a guest does.
fn write(stderr: &mut GuestStderr, text: &str) {
    stderr
        .write(bytes::Bytes::copy_from_slice(text.as_bytes()))
        .expect("this stream never refuses a write");
}

/// A report that fits reads back byte for byte, with no line of gg's in it.
///
/// The whole budget, exactly: a guest is not told it was bounded when it was not, and the boundary
/// itself is where an off-by-one would put a count line in front of a model reading a complete
/// stack trace.
#[test]
fn a_report_within_the_budget_is_read_back_whole() {
    for size in [
        0,
        1,
        STDERR_HEAD,
        STDERR_HEAD + 1,
        STDERR_HEAD + STDERR_TAIL,
    ] {
        let written = "x".repeat(size);
        let mut stderr = GuestStderr::default();
        write(&mut stderr, &written);
        assert_eq!(
            stderr.kept(),
            written,
            "{size} bytes is inside the budget and did not read back whole"
        );
    }
}

/// Many small writes are one report: the head is the first bytes of the *stream*, not of a write.
///
/// A runtime writes its diagnostic a fragment at a time — a word, a newline, a frame — and a bound
/// that filled its head from each write would keep the first four kilobytes of nothing.
#[test]
fn the_head_is_the_start_of_the_stream_rather_than_of_a_write() {
    let mut stderr = GuestStderr::default();
    write(&mut stderr, "Unhandled Exception:\n");
    for frame in 0..4000 {
        write(
            &mut stderr,
            &format!("  at Program.Deeper (int) [{frame}]\n"),
        );
    }
    let kept = stderr.kept();
    assert!(
        kept.starts_with("Unhandled Exception:\n"),
        "the first thing the runtime wrote was evicted: {kept}"
    );
    assert!(
        kept.contains("  at Program.Deeper (int) [3999]"),
        "the last thing the runtime wrote was evicted: {kept}"
    );
}

/// **A trim closes by counting what it dropped**, and the count is every byte the model cannot
/// read.
///
/// Asserted as arithmetic rather than as a number: what comes back is the head, one counting line,
/// and the tail, so the bytes of the report that survived plus the bytes the line claims must be
/// the bytes the guest wrote. A cut moved to a line boundary is a deletion like any other and is in
/// that count, which is the half a bound is most likely to leave out.
#[test]
fn the_count_is_every_byte_the_model_cannot_read() {
    let mut written = String::from("Unhandled Exception: the first line\n");
    for line in 0..4000 {
        written.push_str(&format!("  at Program.Deeper (int) frame {line}\n"));
    }
    written.push_str("the last line before it died");

    let mut stderr = GuestStderr::default();
    write(&mut stderr, &written);
    let kept = stderr.kept();

    let (head, rest) = kept
        .split_once("… ")
        .expect("a bounded report carries the count line");
    let (count, tail) = rest
        .split_once('\n')
        .expect("the count line ends and the tail follows it");
    let dropped: usize = count
        .strip_suffix(" bytes dropped")
        .expect("the count line names its unit")
        .parse()
        .expect("the count is a number");

    assert_eq!(
        head.len() + dropped + tail.len(),
        written.len(),
        "the report claims to have dropped {dropped} bytes and dropped a different number"
    );
    assert!(
        head.starts_with("Unhandled Exception: the first line\n"),
        "the head of the report was evicted: {head}"
    );
    assert!(
        tail.ends_with("the last line before it died"),
        "the tail of the report was evicted: {tail}"
    );
}

/// Neither cut lands inside a line the runtime wrote.
///
/// A frame cut in half reads as a frame the runtime wrote that way, and a model asked to act on
/// `at Program.Deeper (in` is being told something about gg's bookkeeping. Both cuts move out to a
/// line boundary, and the bytes that move with them are in the count the test above checks.
#[test]
fn neither_cut_lands_inside_a_line() {
    let mut stderr = GuestStderr::default();
    // Thirteen bytes a line, which divides neither budget, so both cuts land mid-line before they
    // are moved.
    for line in 0..5000 {
        write(&mut stderr, &format!("{:012}\n", line));
    }
    let kept = stderr.kept();
    for line in kept.lines() {
        assert!(
            line.len() == 12 || line.ends_with(" bytes dropped"),
            "a line the runtime wrote was cut in half: {line:?}"
        );
    }
}

/// A half of the channel holding no newline at all is kept as it stands.
///
/// A runtime that wrote four kilobytes without ending a line has said one thing, and moving the cut
/// out to a boundary that is not there would delete the whole report to tidy it. What is asserted
/// is that the report survives and is still counted.
#[test]
fn a_report_with_no_line_boundary_is_bounded_rather_than_deleted() {
    let written = "!".repeat(STDERR_HEAD + STDERR_TAIL + 100);
    let mut stderr = GuestStderr::default();
    write(&mut stderr, &written);
    let kept = stderr.kept();

    assert!(
        kept.starts_with('!') && kept.ends_with('!'),
        "a report with no newline in it was deleted rather than bounded: {kept}"
    );
    assert!(
        kept.contains("… 100 bytes dropped"),
        "a report with no newline in it was not counted: {kept}"
    );
}

/// A guest that wrote nothing is read back as nothing.
///
/// [`with_guest_stderr`](super::outcome::with_guest_stderr) branches on emptiness to decide whether
/// gg's account of a failure is preceded by the guest's, so a channel that answered with whitespace
/// would put a blank line in front of every failure on every arm.
#[test]
fn a_guest_that_wrote_nothing_reads_back_as_nothing() {
    let stderr = GuestStderr::default();
    assert!(stderr.kept().is_empty());

    let mut whitespace = GuestStderr::default();
    write(&mut whitespace, "\n\n   \n");
    assert!(whitespace.kept().is_empty());
}
