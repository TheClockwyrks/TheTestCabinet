//! A throwaway PostgreSQL server for the tests of what the replicas share.
//!
//! [`TestPostgres::start`] initializes a cluster in a temporary directory from the
//! machine's PostgreSQL server binaries, starts it on a free loopback port, and
//! stops it when dropped. nextest runs each test in a process of its own, so each
//! test that starts one has a server of its own.
//!
//! The binaries are found in `TCAB_TEST_POSTGRES_BIN` when it is set, beside an
//! `initdb` on the `PATH`, or in the newest `/usr/lib/postgresql/<major>/bin`,
//! where Debian and Ubuntu's `postgresql` package installs them. The devcontainer
//! and the Rust CI image install that package.
//!
//! A machine without them prints `skipped:` and the test passes, so the rest of
//! the suite still runs on a laptop without PostgreSQL, as a test that needs a
//! browser does. Where the binaries are meant to be present, a skip is a pass
//! nobody earned: with `TCAB_REQUIRE_POSTGRES=1`, which the pipeline's `rust` job
//! sets, a missing binary fails the test instead.

use std::path::{Path, PathBuf};
use std::process::Command;

/// A running PostgreSQL server, stopped on drop.
pub(crate) struct TestPostgres {
    bin: PathBuf,
    data: PathBuf,
    /// The superuser's connection URL to the server's `postgres` database.
    pub(crate) url: String,
    _dir: tempfile::TempDir,
}

impl TestPostgres {
    /// Initialize and start a server, or answer `None`, having printed why, when
    /// the machine has no PostgreSQL server binaries and none are required.
    pub(crate) fn start() -> Option<Self> {
        let Some(bin) = server_binaries() else {
            let why = "no PostgreSQL server binaries (initdb, pg_ctl) were found: install the \
                       `postgresql` package, or set TCAB_TEST_POSTGRES_BIN to the directory \
                       that holds them";
            assert!(
                std::env::var("TCAB_REQUIRE_POSTGRES").as_deref() != Ok("1"),
                "{why} (TCAB_REQUIRE_POSTGRES=1)"
            );
            println!("skipped: {why}");
            return None;
        };
        let dir = tempfile::tempdir().expect("creating the server's directory");
        let data = dir.path().join("data");
        run(Command::new(bin.join("initdb"))
            .arg("--pgdata")
            .arg(&data)
            .args([
                "--username=postgres",
                "--auth=trust",
                "--encoding=UTF8",
                "--no-sync",
            ]));
        let port = std::net::TcpListener::bind("127.0.0.1:0")
            .and_then(|listener| listener.local_addr())
            .expect("finding a free port")
            .port();
        let options = format!(
            "-p {port} -k {} -c listen_addresses=127.0.0.1 -c fsync=off",
            dir.path().display()
        );
        run(Command::new(bin.join("pg_ctl"))
            .arg("--pgdata")
            .arg(&data)
            .arg("--log")
            .arg(dir.path().join("server.log"))
            .arg("--options")
            .arg(options)
            .args(["--wait", "start"]));
        Some(Self {
            bin,
            data,
            url: format!("postgres://postgres@127.0.0.1:{port}/postgres"),
            _dir: dir,
        })
    }
}

impl Drop for TestPostgres {
    fn drop(&mut self) {
        let _ = Command::new(self.bin.join("pg_ctl"))
            .arg("--pgdata")
            .arg(&self.data)
            .args(["--mode=immediate", "stop"])
            .output();
    }
}

/// Run `command`, panicking with its output when it fails.
fn run(command: &mut Command) {
    let output = command.output().expect("running a PostgreSQL binary");
    assert!(
        output.status.success(),
        "{command:?} failed:\n{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

/// The directory holding `initdb` and `pg_ctl`.
fn server_binaries() -> Option<PathBuf> {
    let holds = |dir: &Path| dir.join("initdb").is_file() && dir.join("pg_ctl").is_file();
    if let Some(dir) = std::env::var_os("TCAB_TEST_POSTGRES_BIN") {
        return Some(PathBuf::from(dir)).filter(|dir| holds(dir));
    }
    if let Some(dir) = std::env::var_os("PATH")
        .iter()
        .flat_map(std::env::split_paths)
        .find(|dir| holds(dir))
    {
        return Some(dir);
    }
    let mut versions: Vec<(u32, PathBuf)> = std::fs::read_dir("/usr/lib/postgresql")
        .ok()?
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let major = entry.file_name().to_str()?.parse().ok()?;
            Some((major, entry.path().join("bin")))
        })
        .filter(|(_, dir)| holds(dir))
        .collect();
    versions.sort();
    versions.pop().map(|(_, dir)| dir)
}
