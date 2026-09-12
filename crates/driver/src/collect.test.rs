//! Tests for the run-tree collection channel: the listener against the real
//! uploader script run by the local `node`, and against hand-built clients that
//! inject every way a transfer can go wrong.

use super::*;

use std::process::Stdio;

use tokio::net::TcpStream;

fn frame(kind: u8, payload: &[u8]) -> Vec<u8> {
    let mut frame = vec![kind];
    frame.extend_from_slice(&(payload.len() as u32).to_be_bytes());
    frame.extend_from_slice(payload);
    frame
}

fn terminator(bytes: &[u8]) -> Vec<u8> {
    let mut payload = (bytes.len() as u64).to_be_bytes().to_vec();
    payload.extend_from_slice(&Sha256::digest(bytes));
    frame(KIND_END, &payload)
}

async fn connect(listener: &CollectListener) -> TcpStream {
    TcpStream::connect(("127.0.0.1", listener.port()))
        .await
        .expect("connect")
}

async fn send_header(stream: &mut TcpStream, token: &str) {
    stream
        .write_all(format!("{PROTOCOL} {token}\n").as_bytes())
        .await
        .expect("header");
}

/// A working tree with a multi-megabyte binary asset, a small text file, and a
/// dependency directory the collection excludes.
fn working_tree() -> tempfile::TempDir {
    let dir = tempfile::tempdir().expect("tempdir");
    std::fs::create_dir_all(dir.path().join("dist/assets")).expect("dist");
    let wav: Vec<u8> = (0..3_000_000u32).map(|i| (i % 251) as u8).collect();
    std::fs::write(dir.path().join("dist/assets/music-play-BxkOrE-5.wav"), wav).expect("wav");
    std::fs::write(dir.path().join("README.md"), "# kessler\n").expect("readme");
    std::fs::create_dir_all(dir.path().join("node_modules/x")).expect("node_modules");
    std::fs::write(dir.path().join("node_modules/x/index.js"), "x").expect("dep");
    dir
}

/// Run the real uploader against `listener` with the local `node`, returning its
/// exit code and stderr.
async fn run_uploader(
    listener: &CollectListener,
    token: &str,
    workdir: &Path,
) -> (Option<i32>, String) {
    let command = uploader_command(
        "127.0.0.1",
        listener.port(),
        token,
        workdir.to_str().expect("utf-8 path"),
        &["node_modules"],
    );
    let output = tokio::process::Command::new(&command[0])
        .args(&command[1..])
        .stdin(Stdio::null())
        .output()
        .await
        .expect("node runs the uploader");
    (
        output.status.code(),
        String::from_utf8_lossy(&output.stderr).into_owned(),
    )
}

#[tokio::test]
async fn the_real_uploader_delivers_a_tree_the_listener_verifies_and_unpacks() {
    let tree = working_tree();
    let scratch = tempfile::tempdir().expect("scratch");
    let archive = scratch.path().join("collected.tar");
    let listener = CollectListener::bind().await.expect("bind");

    let (received, (code, stderr)) = tokio::join!(
        listener.receive(&archive),
        run_uploader(&listener, listener.token(), tree.path()),
    );
    let received = received.expect("verified upload");
    assert_eq!(code, Some(0), "uploader exit; stderr: {stderr}");
    assert!(stderr.contains("uploaded"), "{stderr}");
    assert_eq!(
        received.bytes,
        std::fs::metadata(&archive).expect("archive").len()
    );

    let dest = scratch.path().join("dest");
    std::fs::create_dir(&dest).expect("dest");
    tar::Archive::new(std::fs::File::open(&archive).expect("open"))
        .unpack(&dest)
        .expect("unpack");
    assert_eq!(
        std::fs::read(dest.join("dist/assets/music-play-BxkOrE-5.wav")).expect("wav"),
        std::fs::read(tree.path().join("dist/assets/music-play-BxkOrE-5.wav")).expect("wav"),
    );
    assert_eq!(
        std::fs::read_to_string(dest.join("README.md")).expect("readme"),
        "# kessler\n"
    );
    assert!(
        !dest.join("node_modules").exists(),
        "excluded directories never enter the archive"
    );
}

#[tokio::test]
async fn the_real_uploader_reports_a_tar_failure_as_a_failure_frame() {
    let scratch = tempfile::tempdir().expect("scratch");
    let archive = scratch.path().join("collected.tar");
    let listener = CollectListener::bind().await.expect("bind");
    let missing = scratch.path().join("no-such-tree");

    let (received, (code, stderr)) = tokio::join!(
        listener.receive(&archive),
        run_uploader(&listener, listener.token(), &missing),
    );
    let err = received.expect_err("tar failed");
    assert!(
        err.to_string().contains("tar failed in the sandbox"),
        "{err}"
    );
    assert!(err.to_string().contains("no-such-tree"), "{err}");
    assert_eq!(code, Some(3), "stderr: {stderr}");
}

#[tokio::test]
async fn the_real_uploader_exits_nonzero_when_the_listener_refuses_the_token() {
    let tree = working_tree();
    let scratch = tempfile::tempdir().expect("scratch");
    let archive = scratch.path().join("collected.tar");
    let listener = CollectListener::bind().await.expect("bind");

    // The listener keeps accepting past a connection with the wrong token, so
    // race it against a bounded wait; the uploader is what must give up.
    let receive = listener.receive(&archive);
    let uploader = run_uploader(&listener, "not-this-run", tree.path());
    let (code, stderr) = tokio::select! {
        _ = receive => panic!("a wrong token must never complete a collection"),
        result = uploader => result,
    };
    assert_eq!(code, Some(2), "stderr: {stderr}");
    assert!(
        !archive.exists(),
        "nothing is written for an unauthenticated connection"
    );
}

#[tokio::test]
async fn a_stream_that_ends_without_its_terminator_is_reported_truncated() {
    let scratch = tempfile::tempdir().expect("scratch");
    let archive = scratch.path().join("collected.tar");
    let listener = CollectListener::bind().await.expect("bind");

    let client = async {
        let mut stream = connect(&listener).await;
        send_header(&mut stream, listener.token()).await;
        stream
            .write_all(&frame(KIND_DATA, &[7u8; 4096]))
            .await
            .expect("data");
        // Half a second frame, then the connection is gone: what a dropped
        // stream looks like from the receiving end.
        let partial = frame(KIND_DATA, &[9u8; 4096]);
        stream.write_all(&partial[..2000]).await.expect("partial");
        drop(stream);
    };
    let (received, ()) = tokio::join!(listener.receive(&archive), client);
    let err = received.expect_err("truncated");
    let message = err.to_string();
    assert!(message.contains("collecting run artifacts"), "{message}");
    assert!(message.contains("without its terminator"), "{message}");
    // The count is of whole chunks landed: the first frame, not the fragment of
    // the second that the drop cut through.
    assert!(message.contains("after 4096 bytes"), "{message}");
}

#[tokio::test]
async fn a_terminator_whose_count_disagrees_is_refused() {
    let scratch = tempfile::tempdir().expect("scratch");
    let archive = scratch.path().join("collected.tar");
    let listener = CollectListener::bind().await.expect("bind");

    let client = async {
        let mut stream = connect(&listener).await;
        send_header(&mut stream, listener.token()).await;
        let data = [3u8; 1000];
        stream
            .write_all(&frame(KIND_DATA, &data))
            .await
            .expect("data");
        // The uploader believed it sent 1500 bytes.
        let mut payload = 1500u64.to_be_bytes().to_vec();
        payload.extend_from_slice(&Sha256::digest(data));
        stream
            .write_all(&frame(KIND_END, &payload))
            .await
            .expect("end");
        let mut reply = String::new();
        let _ = stream.read_to_string(&mut reply).await;
        reply
    };
    let (received, reply) = tokio::join!(listener.receive(&archive), client);
    let err = received.expect_err("count mismatch");
    assert!(
        err.to_string()
            .contains("received 1000, uploader claimed 1500"),
        "{err}"
    );
    assert_eq!(reply, "", "no acknowledgement for a refused upload");
}

#[tokio::test]
async fn a_terminator_whose_digest_disagrees_is_refused() {
    let scratch = tempfile::tempdir().expect("scratch");
    let archive = scratch.path().join("collected.tar");
    let listener = CollectListener::bind().await.expect("bind");

    let client = async {
        let mut stream = connect(&listener).await;
        send_header(&mut stream, listener.token()).await;
        let data = [3u8; 1000];
        stream
            .write_all(&frame(KIND_DATA, &data))
            .await
            .expect("data");
        // Right count, wrong bytes: a corrupted stream.
        let mut payload = 1000u64.to_be_bytes().to_vec();
        payload.extend_from_slice(&Sha256::digest([4u8; 1000]));
        stream
            .write_all(&frame(KIND_END, &payload))
            .await
            .expect("end");
    };
    let (received, ()) = tokio::join!(listener.receive(&archive), client);
    let err = received.expect_err("digest mismatch");
    assert!(err.to_string().contains("SHA-256 digest mismatch"), "{err}");
}

#[tokio::test]
async fn a_verified_upload_is_acknowledged_and_written_exactly() {
    let scratch = tempfile::tempdir().expect("scratch");
    let archive = scratch.path().join("collected.tar");
    let listener = CollectListener::bind().await.expect("bind");
    let bytes: Vec<u8> = (0..300_000u32).map(|i| (i % 7) as u8).collect();

    let client = async {
        let mut stream = connect(&listener).await;
        send_header(&mut stream, listener.token()).await;
        // Three frames of uneven size, then the terminator over the whole.
        for part in [&bytes[..100], &bytes[100..200_000], &bytes[200_000..]] {
            stream
                .write_all(&frame(KIND_DATA, part))
                .await
                .expect("data");
        }
        stream.write_all(&terminator(&bytes)).await.expect("end");
        let mut reply = String::new();
        stream.read_to_string(&mut reply).await.expect("reply");
        reply
    };
    let (received, reply) = tokio::join!(listener.receive(&archive), client);
    assert_eq!(received.expect("verified").bytes, bytes.len() as u64);
    assert_eq!(reply, "ok\n");
    assert_eq!(std::fs::read(&archive).expect("archive"), bytes);
}

#[tokio::test]
async fn the_listener_outlasts_a_connection_with_the_wrong_token() {
    let scratch = tempfile::tempdir().expect("scratch");
    let archive = scratch.path().join("collected.tar");
    let listener = CollectListener::bind().await.expect("bind");
    let bytes = b"the archive".to_vec();

    let client = async {
        // A stranger first: the wrong token, then a stream that would otherwise be
        // valid. It must be ignored without ending the collection.
        let mut stranger = connect(&listener).await;
        send_header(&mut stranger, "someone-else").await;
        let _ = stranger.write_all(&frame(KIND_DATA, b"nope")).await;
        let _ = stranger.write_all(&terminator(b"nope")).await;
        drop(stranger);

        let mut stream = connect(&listener).await;
        send_header(&mut stream, listener.token()).await;
        stream
            .write_all(&frame(KIND_DATA, &bytes))
            .await
            .expect("data");
        stream.write_all(&terminator(&bytes)).await.expect("end");
    };
    let (received, ()) = tokio::join!(listener.receive(&archive), client);
    assert_eq!(received.expect("verified").bytes, bytes.len() as u64);
    assert_eq!(std::fs::read(&archive).expect("archive"), bytes);
}

#[tokio::test]
async fn a_failure_frame_carries_tars_message() {
    let scratch = tempfile::tempdir().expect("scratch");
    let archive = scratch.path().join("collected.tar");
    let listener = CollectListener::bind().await.expect("bind");

    let client = async {
        let mut stream = connect(&listener).await;
        send_header(&mut stream, listener.token()).await;
        stream
            .write_all(&frame(
                KIND_FAILURE,
                b"tar exited 2: tar: /work: Cannot open: No such file or directory",
            ))
            .await
            .expect("failure");
    };
    let (received, ()) = tokio::join!(listener.receive(&archive), client);
    let err = received.expect_err("tar failed");
    assert!(
        err.to_string()
            .contains("tar failed in the sandbox: tar exited 2: tar: /work: Cannot open"),
        "{err}"
    );
}

#[tokio::test]
async fn an_oversized_frame_is_refused_before_it_is_read() {
    let scratch = tempfile::tempdir().expect("scratch");
    let archive = scratch.path().join("collected.tar");
    let listener = CollectListener::bind().await.expect("bind");

    let client = async {
        let mut stream = connect(&listener).await;
        send_header(&mut stream, listener.token()).await;
        let mut header = vec![KIND_DATA];
        header.extend_from_slice(&(MAX_FRAME_LEN + 1).to_be_bytes());
        let _ = stream.write_all(&header).await;
        // Hold the connection open: the refusal must not depend on EOF.
        let mut reply = String::new();
        let _ = stream.read_to_string(&mut reply).await;
    };
    let (received, ()) = tokio::join!(listener.receive(&archive), client);
    let err = received.expect_err("oversized");
    assert!(err.to_string().contains("over the size cap"), "{err}");
}

#[test]
fn the_uploader_command_runs_the_shipped_script_with_plain_arguments() {
    let command = uploader_command("10.42.0.7", 40123, "tok", "/work", &["node_modules"]);
    assert_eq!(&command[..3], ["node", "--input-type=module", "-e"]);
    assert_eq!(
        &command[4..],
        ["--", "10.42.0.7", "40123", "tok", "/work", "node_modules"]
    );
    // The program is the shipped script minus its comment and blank lines: every
    // code line survives, no comment line does, and the protocol it announces is
    // the one the listener checks for.
    let program = &command[3];
    assert!(program.contains(PROTOCOL));
    for line in UPLOADER_SCRIPT.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with("//") {
            continue;
        }
        assert!(
            program.contains(line.trim_start()),
            "code line dropped: {line}"
        );
    }
    assert!(
        !program
            .lines()
            .any(|line| line.trim_start().starts_with("//")),
        "comment lines are stripped"
    );
    // The exec's command rides the request line as query parameters, and a proxy
    // in front of an API server can cap a request line at 8 KiB. The whole
    // encoded argv, at the most expensive encoding, leaves room under that for the
    // path and the other parameters.
    let encoded = encoded_command_len(&command);
    assert!(encoded < 7 * 1024, "{encoded} bytes encoded");
}

#[test]
fn the_encoded_length_charges_three_bytes_for_every_reserved_byte() {
    let argv = vec!["ab-_.~".to_string(), "a b".to_string()];
    // Each word costs its `&command=` prefix; unreserved bytes cost one, every
    // other byte three.
    assert_eq!(
        encoded_command_len(&argv),
        "&command=".len() * 2 + 6 + (1 + 3 + 1)
    );
}

#[tokio::test]
async fn an_uploader_that_never_connects_fails_the_attempt_within_the_idle_bound() {
    let scratch = tempfile::tempdir().expect("scratch");
    let archive = scratch.path().join("collected.tar");
    let listener = CollectListener::bind()
        .await
        .expect("bind")
        .with_idle(Duration::from_millis(200));

    let started = std::time::Instant::now();
    let err = listener
        .receive(&archive)
        .await
        .expect_err("nobody connected");
    assert!(err.to_string().contains("no uploader connected"), "{err}");
    assert!(started.elapsed() < Duration::from_secs(5));
    assert!(!archive.exists());
}

#[tokio::test]
async fn a_stream_that_stalls_fails_the_attempt_within_the_idle_bound() {
    let scratch = tempfile::tempdir().expect("scratch");
    let archive = scratch.path().join("collected.tar");
    let listener = CollectListener::bind()
        .await
        .expect("bind")
        .with_idle(Duration::from_millis(200));

    let client = async {
        let mut stream = connect(&listener).await;
        send_header(&mut stream, listener.token()).await;
        stream
            .write_all(&frame(KIND_DATA, &[1u8; 1024]))
            .await
            .expect("data");
        // Then nothing, with the connection held open: a peer that has hung.
        tokio::time::sleep(Duration::from_secs(3)).await;
        drop(stream);
    };
    let receive = async {
        let started = std::time::Instant::now();
        let err = listener.receive(&archive).await.expect_err("stalled");
        (err, started.elapsed())
    };
    let ((err, elapsed), ()) = tokio::join!(receive, client);
    let message = err.to_string();
    assert!(message.contains("upload stalled for"), "{message}");
    assert!(message.contains("after 1024 bytes"), "{message}");
    assert!(elapsed < Duration::from_secs(2), "{elapsed:?}");
}
