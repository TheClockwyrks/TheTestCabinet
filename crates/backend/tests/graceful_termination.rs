//! The `tcab-backend` binary's graceful termination, the control plane's "Graceful
//! termination": told to stop by `SIGTERM`, it fails readiness at once, keeps
//! accepting through the drain delay, then stops accepting, finishes the request in
//! flight and exits 0. An interrupt drains the same way without the delay.
//!
//! Each test starts the real binary on a local SQLite database, a temporary store and
//! the crate's fixture catalog, and signals the process itself. The request held in
//! flight across the stop is an ingest whose body the client has sent only half of:
//! the server has accepted it and its handler is waiting on the rest, which the test
//! sends only once the server has stopped accepting. Every wait polls for the state
//! it needs under a generous deadline rather than sleeping for a guessed time.

#![cfg(unix)]

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::Path;
use std::process::{Child, Command, ExitStatus, Stdio};
use std::time::{Duration, Instant};

/// The shared service token `POST /ingest` takes.
const SERVICE_TOKEN: &str = "graceful-termination-test-token";
/// The deadline every wait below holds to; far longer than any of them needs.
const DEADLINE: Duration = Duration::from_secs(60);
/// The interval between two polls.
const POLL: Duration = Duration::from_millis(50);

/// A running `tcab-backend` and the directories it reads and writes.
struct Backend {
    child: Child,
    addr: SocketAddr,
    log: std::path::PathBuf,
    _dir: tempfile::TempDir,
}

impl Drop for Backend {
    fn drop(&mut self) {
        // A failed assertion must not leave the process running.
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Backend {
    /// Start the binary on a free port, wait until it answers, and fill its store
    /// from the fixture catalog so it reports ready.
    fn start() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let checkout = dir.path().join("checkout");
        let suites = dir.path().join("suites");
        let cold = dir.path().join("cold-storage");
        for path in [&checkout, &suites, &cold] {
            std::fs::create_dir_all(path).unwrap();
        }
        let definitions = Path::new(env!("CARGO_MANIFEST_DIR")).join("testdata/definitions");
        let addr = free_addr();
        let log = dir.path().join("backend.log");
        let output = std::fs::File::create(&log).unwrap();
        let child = Command::new(env!("CARGO_BIN_EXE_tcab-backend"))
            // Only what this test sets: no `TCAB_*` or `OTEL_*` from the
            // environment the suite runs in reaches the process.
            .env_clear()
            .env("PATH", std::env::var_os("PATH").unwrap_or_default())
            .env("HOME", dir.path())
            // `tower_http` at debug logs each request as the server takes it in,
            // which `wait_until_accepted` reads; no colour codes split its lines.
            .env("RUST_LOG", "info,tower_http=debug")
            .env("NO_COLOR", "1")
            .env("TCAB_BACKEND_BIND", addr.to_string())
            .env(
                "TCAB_BACKEND_DATABASE_URL",
                format!(
                    "sqlite://{}?mode=rwc",
                    dir.path().join("backend.sqlite").display()
                ),
            )
            .env("TCAB_BACKEND_STORE", dir.path().join("store"))
            .env("TCAB_BACKEND_CHECKOUT", &checkout)
            .env("TCAB_DEFINITIONS_ROOT", &definitions)
            .env("TCAB_SUITES_ROOT", &suites)
            .env("TCAB_COLD_STORAGE_ROOT", &cold)
            .env("TCAB_BACKEND_SERVICE_TOKEN", SERVICE_TOKEN)
            // The working directory holds no `.env.backend` for it to load.
            .current_dir(dir.path())
            .stdin(Stdio::null())
            .stdout(output.try_clone().unwrap())
            .stderr(output)
            .spawn()
            .unwrap();
        let mut backend = Self {
            child,
            addr,
            log,
            _dir: dir,
        };
        backend.wait_until("it answers /healthz", |b| {
            b.try_get("/healthz")
                .is_some_and(|(status, _)| status == 200)
        });
        let (status, body) = backend.ingest_all_at_once();
        assert_eq!(status, 200, "the ingest failed: {body}");
        let (status, body) = backend.get("/readyz");
        assert_eq!(status, 200, "the filled backend is not ready: {body}");
        backend
    }

    /// Deliver `signal` (a `kill` signal name) to the process.
    fn signal(&self, signal: &str) {
        let status = Command::new("kill")
            .arg(format!("-{signal}"))
            .arg(self.child.id().to_string())
            .status()
            .unwrap();
        assert!(status.success(), "kill -{signal} failed");
    }

    /// Poll `condition` until it holds, failing the test past the deadline.
    fn wait_until(&mut self, what: &str, mut condition: impl FnMut(&mut Self) -> bool) {
        let start = Instant::now();
        while !condition(self) {
            if let Some(status) = self.child.try_wait().unwrap() {
                panic!(
                    "the backend exited ({status}) waiting until {what}:\n{}",
                    self.log()
                );
            }
            assert!(
                start.elapsed() < DEADLINE,
                "timed out waiting until {what}:\n{}",
                self.log()
            );
            std::thread::sleep(POLL);
        }
    }

    /// Wait for the process to exit, failing the test past the deadline.
    fn wait_for_exit(&mut self) -> ExitStatus {
        let start = Instant::now();
        loop {
            if let Some(status) = self.child.try_wait().unwrap() {
                return status;
            }
            assert!(
                start.elapsed() < DEADLINE,
                "the backend did not exit:\n{}",
                self.log()
            );
            std::thread::sleep(POLL);
        }
    }

    /// Whether a new connection is refused: the server has stopped accepting.
    fn refuses_connections(&self) -> bool {
        TcpStream::connect(self.addr).is_err()
    }

    /// `GET path` on a new connection, or `None` when it could not be made.
    fn try_get(&self, path: &str) -> Option<(u16, String)> {
        let mut stream = TcpStream::connect(self.addr).ok()?;
        stream.set_read_timeout(Some(DEADLINE)).unwrap();
        write!(
            stream,
            "GET {path} HTTP/1.1\r\nHost: {}\r\nConnection: close\r\n\r\n",
            self.addr
        )
        .ok()?;
        read_response(&mut stream)
    }

    /// `GET path`, failing the test when it could not be made.
    fn get(&self, path: &str) -> (u16, String) {
        self.try_get(path)
            .unwrap_or_else(|| panic!("GET {path} failed:\n{}", self.log()))
    }

    /// `POST /ingest` with its whole body.
    fn ingest_all_at_once(&self) -> (u16, String) {
        let mut request = self.begin_ingest();
        request.write_all(b"}").unwrap();
        read_response(&mut request).expect("no response to the ingest")
    }

    /// Start a `POST /ingest` whose `{}` body is sent only up to its first byte; the
    /// caller sends the `}` that finishes it.
    fn begin_ingest(&self) -> TcpStream {
        let mut stream = TcpStream::connect(self.addr).unwrap();
        stream.set_read_timeout(Some(DEADLINE)).unwrap();
        write!(
            stream,
            "POST /ingest HTTP/1.1\r\nHost: {}\r\nConnection: close\r\n\
             Authorization: Bearer {SERVICE_TOKEN}\r\nContent-Type: application/json\r\n\
             Content-Length: 2\r\n\r\n{{",
            self.addr
        )
        .unwrap();
        stream.flush().unwrap();
        stream
    }

    /// What the process has logged so far.
    fn log(&self) -> String {
        std::fs::read_to_string(&self.log).unwrap_or_default()
    }
}

/// An address on the loopback interface no listener holds right now.
fn free_addr() -> SocketAddr {
    TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
}

/// Read a `Connection: close` response to its end: its status and its body.
fn read_response(stream: &mut TcpStream) -> Option<(u16, String)> {
    let mut raw = Vec::new();
    stream.read_to_end(&mut raw).ok()?;
    let raw = String::from_utf8_lossy(&raw).into_owned();
    let status = raw.split(' ').nth(1)?.parse().ok()?;
    let body = raw
        .split_once("\r\n\r\n")
        .map(|(_, body)| body.to_owned())?;
    Some((status, body))
}

/// How many `POST /ingest` requests the server has taken in so far, by its log.
fn ingests_taken(backend: &Backend) -> usize {
    backend
        .log()
        .lines()
        .filter(|line| line.contains("started processing request") && line.contains("/ingest"))
        .count()
}

/// Wait until the server has taken the half-sent request in and handed it to the
/// router, which then waits on the rest of its body. Until then a stop could close
/// the connection as idle, before the request was ever in flight.
fn wait_until_accepted(backend: &mut Backend, taken_before: usize) {
    backend.wait_until("the half-sent ingest is taken in", |b| {
        ingests_taken(b) > taken_before
    });
}

#[test]
fn sigterm_drains_with_the_delay_and_finishes_the_request_in_flight() {
    let mut backend = Backend::start();
    let before = ingests_taken(&backend);
    let mut in_flight = backend.begin_ingest();
    wait_until_accepted(&mut backend, before);

    backend.signal("TERM");

    // Through the drain delay a new connection is still accepted, and readiness
    // fails on it.
    let mut readiness = None;
    backend.wait_until("/readyz answers 503 during the drain delay", |b| {
        readiness = b.try_get("/readyz");
        readiness.as_ref().is_some_and(|(status, _)| *status == 503)
    });
    let (_, body) = readiness.unwrap();
    assert!(body.contains("\"draining\""), "{body}\n{}", backend.log());

    // Past the delay it stops accepting, with the request still in flight.
    backend.wait_until("new connections are refused", |b| b.refuses_connections());
    assert!(backend.child.try_wait().unwrap().is_none());

    in_flight.write_all(b"}").unwrap();
    let (status, body) = read_response(&mut in_flight).expect("no response in flight");
    assert_eq!(status, 200, "the request in flight failed: {body}");

    let exit = backend.wait_for_exit();
    assert_eq!(exit.code(), Some(0), "{}", backend.log());
    assert!(backend.log().contains("drain delay"), "{}", backend.log());
}

#[test]
fn an_interrupt_drains_without_the_delay() {
    let mut backend = Backend::start();
    let before = ingests_taken(&backend);
    let mut in_flight = backend.begin_ingest();
    wait_until_accepted(&mut backend, before);

    backend.signal("INT");

    backend.wait_until("new connections are refused", |b| b.refuses_connections());
    in_flight.write_all(b"}").unwrap();
    let (status, body) = read_response(&mut in_flight).expect("no response in flight");
    assert_eq!(status, 200, "the request in flight failed: {body}");

    let exit = backend.wait_for_exit();
    assert_eq!(exit.code(), Some(0), "{}", backend.log());
    assert!(
        backend.log().contains("without the drain delay"),
        "{}",
        backend.log()
    );
}
