//! Tests for the invoke path.
//!
//! Two stand-ins replace the cluster. A fake `az` executable on a private `PATH`
//! records its arguments and replays a canned answer, which exercises
//! [`SystemAzRunner`] as the real program is run. [`ShellAz`] instead runs the
//! command an invoke carries through `sh`, as the helper pod does, with `kubectl`,
//! `git`, and `curl` replaced by scripts that play the sidecar and the backend, so
//! the quoting of every generated command is proven by running it.

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use super::*;

/// Write an executable script.
fn executable(dir: &Path, name: &str, body: &str) -> PathBuf {
    let path = dir.join(name);
    std::fs::write(&path, body).expect("the script is written");
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755))
        .expect("the script is executable");
    path
}

fn staging() -> RemoteTarget {
    remote_target("staging")
        .expect("staging is a target")
        .clone()
}

// --- Targets ----------------------------------------------------------------

#[test]
fn the_committed_targets_are_staging_then_prod() {
    let names: Vec<&str> = remote_targets()
        .iter()
        .map(|target| target.name.as_str())
        .collect();
    assert_eq!(names, ["staging", "prod"]);
    let prod = remote_target("prod").expect("prod is a target");
    assert_eq!(prod.ingest_branch, "master");
    assert_eq!(prod.namespace, "tcab-prod");
    assert!(remote_target("local").is_none());
}

#[test]
fn the_committed_targets_are_what_env_sh_generates() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let output = std::process::Command::new("bash")
        .arg(root.join("scripts/generate-publish-targets.sh"))
        .arg("--stdout")
        .output()
        .expect("bash runs the generator");
    assert!(
        output.status.success(),
        "the generator failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(
        String::from_utf8_lossy(&output.stdout),
        TARGETS_TOML,
        "crates/core/publish-targets.toml has drifted from scripts/lib/env.sh; \
         run scripts/generate-publish-targets.sh"
    );
}

// --- The az executable ----------------------------------------------------------

/// A private `PATH` holding a fake `az` that appends its arguments, NUL-separated,
/// to `args`, lists its working directory to `files`, prints `stdout`, and exits
/// with `exit`.
fn fake_az(stdout: &str, exit: i32) -> (tempfile::TempDir, SystemAzRunner) {
    let dir = tempfile::tempdir().expect("a temporary directory");
    std::fs::write(dir.path().join("stdout"), stdout).expect("the answer is written");
    let script = format!(
        "#!/bin/sh\n\
         for arg in \"$@\"; do printf '%s\\0' \"$arg\" >> '{record}/args'; done\n\
         ls >> '{record}/files'\n\
         cat '{record}/stdout'\n\
         [ {exit} -eq 0 ] || echo 'ERROR: Please run az login to setup account.' >&2\n\
         exit {exit}\n",
        record = dir.path().display(),
    );
    executable(dir.path(), "az", &script);
    let runner = SystemAzRunner::with_path(dir.path().as_os_str());
    (dir, runner)
}

fn recorded_args(dir: &tempfile::TempDir) -> Vec<String> {
    std::fs::read_to_string(dir.path().join("args"))
        .expect("az was run")
        .split('\0')
        .filter(|arg| !arg.is_empty())
        .map(str::to_owned)
        .collect()
}

#[tokio::test]
async fn a_signed_in_az_names_its_account() {
    let (dir, runner) = fake_az(
        r#"{"name": "Test Cabinet", "user": {"name": "ops@example.com", "type": "user"}}"#,
        0,
    );
    assert_eq!(
        az_login(&runner).await,
        AzLogin::Authenticated {
            user: Some("ops@example.com".to_owned()),
            subscription: Some("Test Cabinet".to_owned()),
        }
    );
    assert_eq!(recorded_args(&dir), ["account", "show", "--output", "json"]);
}

#[tokio::test]
async fn an_az_that_is_not_signed_in_says_what_az_said() {
    let (_dir, runner) = fake_az("", 1);
    assert_eq!(
        az_login(&runner).await,
        AzLogin::Unauthenticated {
            message: "ERROR: Please run az login to setup account.".to_owned(),
        }
    );
}

#[tokio::test]
async fn an_az_that_is_not_installed_is_missing() {
    let empty = tempfile::tempdir().expect("a temporary directory");
    let runner = SystemAzRunner::with_program(empty.path().join("az"));
    assert!(matches!(az_login(&runner).await, AzLogin::Missing { .. }));
}

#[tokio::test]
async fn an_ingest_invokes_the_target_cluster_and_relays_the_feed_in_its_logs() {
    let logs = [
        "ingest: refreshing /state/checkout to origin/staging with its submodules",
        " 3f2a1c test-suites (heads/master)",
        "ingest: triggering the ingest",
        r#"{"event":"start","total":1}"#,
        r#"{"event":"version","index":1,"total":1,"slug":"carom","version":"v1.0.0","ingested":true,"renderedReferences":0}"#,
        r#"{"event":"done","total":1,"ingested":1,"skipped":0}"#,
    ]
    .join("\n");
    let answer =
        serde_json::json!({ "exitCode": 0, "logs": logs, "provisioningState": "Succeeded" });
    let (dir, runner) = fake_az(&answer.to_string(), 0);
    let backend = RemoteBackend::new(staging(), Arc::new(runner));

    let mut lines = Vec::new();
    let mut events = Vec::new();
    let summary = backend
        .ingest(
            &["carom@v1.0.0".to_owned()],
            true,
            IngestMode::Absent,
            &mut |line| lines.push(line.to_owned()),
            &mut |progress| events.push(progress.clone()),
        )
        .await
        .expect("the ingest finished");

    assert_eq!(
        summary,
        IngestSummary {
            total: 1,
            ingested: 1,
            skipped: 0
        }
    );
    assert_eq!(events.len(), 3);
    assert_eq!(lines.len(), 3, "{lines:?}");
    let args = recorded_args(&dir);
    assert_eq!(
        &args[..7],
        [
            "aks",
            "command",
            "invoke",
            "--resource-group",
            "testcabinet-staging-westus2-rg",
            "--name",
            "testcabinet-staging-westus2-aks"
        ]
    );
    assert_eq!(args[7], "--command");
    let script = backend.ingest_script(r#"{"force":true,"testCases":["carom@v1.0.0"]}"#);
    assert_eq!(args[8], format!("sh -c {}", shell_quote(&script)));
    assert!(
        script.contains("kubectl -n 'tcab-staging' exec deploy/the-test-cabinet-backend -c ingest")
    );
    assert!(script.contains(" 'staging' "));
    assert_eq!(&args[9..], ["--output", "json"]);
}

#[tokio::test]
async fn an_ingest_whose_feed_never_closes_is_a_failure() {
    let answer = serde_json::json!({
        "exitCode": 0,
        "logs": "{\"event\":\"start\",\"total\":2}\n",
    });
    let (_dir, runner) = fake_az(&answer.to_string(), 0);
    let error = RemoteBackend::new(staging(), Arc::new(runner))
        .ingest(&[], false, IngestMode::Changed, &mut |_| {}, &mut |_| {})
        .await
        .expect_err("a feed without done did not finish");
    assert!(matches!(error, RemoteError::Ingest { .. }), "{error}");
    assert!(error.to_string().contains("ended without a summary"));
}

#[tokio::test]
async fn a_command_exiting_non_zero_reports_the_end_of_its_logs() {
    let answer = serde_json::json!({
        "exitCode": 128,
        "logs": "ingest: refreshing\nfatal: could not read Username for 'https://dev.azure.com'\n",
    });
    let (_dir, runner) = fake_az(&answer.to_string(), 0);
    let error = RemoteBackend::new(staging(), Arc::new(runner))
        .ingest(&[], false, IngestMode::Changed, &mut |_| {}, &mut |_| {})
        .await
        .expect_err("the refresh failed");
    let message = error.to_string();
    assert!(message.contains("exited 128"), "{message}");
    assert!(message.contains("could not read Username"), "{message}");
}

#[tokio::test]
async fn an_invoke_az_refuses_names_signing_in() {
    let (_dir, runner) = fake_az("", 1);
    let error = RemoteBackend::new(staging(), Arc::new(runner))
        .ingest(&[], false, IngestMode::Changed, &mut |_| {}, &mut |_| {})
        .await
        .expect_err("az refused");
    assert!(matches!(error, RemoteError::Invoke { .. }));
    assert!(error.to_string().contains("az login"), "{error}");
}

#[tokio::test]
async fn an_upload_attaches_every_archive_from_its_working_directory() {
    let answer = serde_json::json!({
        "exitCode": 0,
        "logs": "tcab-upload 0 201 {\"engine\":\"none\",\"url\":\"/suites/carom/versions/v1.0.0/reference-builds/none/\"}\n",
    });
    let (dir, runner) = fake_az(&answer.to_string(), 0);
    let archives = [ReferenceBuildArchive {
        slug: "carom".to_owned(),
        version: "v1.0.0".to_owned(),
        engine: "none".to_owned(),
        archive: vec![1, 2, 3],
    }];
    let answers = RemoteBackend::new(staging(), Arc::new(runner))
        .upload_reference_builds(&archives)
        .await
        .expect("the invoke ran");
    assert_eq!(answers.len(), 1);
    assert_eq!(
        answers[0].as_ref().expect("stored").url,
        "/suites/carom/versions/v1.0.0/reference-builds/none/"
    );
    let args = recorded_args(&dir);
    assert_eq!(&args[args.len() - 2..], ["--file", "."]);
    let files = std::fs::read_to_string(dir.path().join("files")).expect("listed");
    assert_eq!(files.trim(), "build-0.tar.gz");
}

// --- The commands, run -------------------------------------------------------------

/// An [`AzRunner`] that runs the invoked command through `sh` in the working
/// directory it is given, with `kubectl`, `git`, and `curl` played by scripts, and
/// answers as `az aks command invoke --output json` does.
#[derive(Debug)]
struct ShellAz {
    bin: tempfile::TempDir,
    scripts: Mutex<Vec<String>>,
}

impl ShellAz {
    fn new(feed: &str) -> Arc<Self> {
        let bin = tempfile::tempdir().expect("a temporary directory");
        std::fs::write(bin.path().join("feed"), feed).expect("the feed is written");
        // `kubectl exec … -- <command>` runs the command here, standing in for the
        // sidecar.
        executable(
            bin.path(),
            "kubectl",
            "#!/bin/sh\nwhile [ \"$#\" -gt 0 ] && [ \"$1\" != \"--\" ]; do shift; done\nshift\nexec \"$@\"\n",
        );
        executable(bin.path(), "git", "#!/bin/sh\necho \"git $*\"\n");
        executable(
            bin.path(),
            "curl",
            r#"#!/bin/sh
out=""; data=""; url=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -w|-X|-H|--data-binary) shift 2 ;;
    --data) data="$2"; shift 2 ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
case "$url" in
  */ingest) printf %s "$data" > "$RECORD/ingest-body"; cat "$RECORD/feed" ;;
  */reference-builds/*)
    engine="${url##*/}"
    cat > "$RECORD/upload-$engine"
    if [ "$engine" = broken ]; then
      printf '{"error":{"code":"unprocessable","message":"no definition declares engine broken"}}' > "$out"; printf 422
    else
      printf '{"engine":"%s","url":"/suites/it'"'"'s/%s/"}' "$engine" "$engine" > "$out"; printf 201
    fi ;;
  */test-suites/carom/v1.0.0) printf '{"digest":"abc",\n"referenceBuilds":{"none":"/b/none/"}}' > "$out"; printf 200 ;;
  */test-suites/carom/v9.0.0) exit 7 ;;
  *) printf '{"error":{"code":"not_found","message":"not ingested"}}' > "$out"; printf 404 ;;
esac
"#,
        );
        Arc::new(Self {
            bin,
            scripts: Mutex::new(Vec::new()),
        })
    }

    fn record(&self, name: &str) -> Vec<u8> {
        std::fs::read(self.bin.path().join(name)).expect("the record exists")
    }
}

#[async_trait::async_trait]
impl AzRunner for ShellAz {
    async fn run(&self, args: &[String], cwd: Option<&Path>) -> std::io::Result<AzOutput> {
        let script = args
            .iter()
            .position(|arg| arg == "--command")
            .map(|index| args[index + 1].clone())
            .expect("an invoke carries a command");
        self.scripts.lock().expect("scripts").push(script.clone());
        let path = format!(
            "{}:{}",
            self.bin.path().display(),
            std::env::var("PATH").unwrap_or_default()
        );
        let output = tokio::process::Command::new("sh")
            .arg("-c")
            .arg(&script)
            .current_dir(cwd.unwrap_or(self.bin.path()))
            .env("PATH", path)
            .env("RECORD", self.bin.path())
            .output()
            .await?;
        let logs = format!(
            "{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        Ok(AzOutput {
            success: true,
            stdout: serde_json::json!({
                "exitCode": output.status.code().unwrap_or(-1),
                "logs": logs,
            })
            .to_string(),
            stderr: String::new(),
        })
    }
}

#[tokio::test]
async fn the_ingest_command_refreshes_with_submodules_and_posts_the_body_intact() {
    let feed = "{\"event\":\"start\",\"total\":0}\n{\"event\":\"done\",\"total\":0,\"ingested\":0,\"skipped\":0}\n";
    let az = ShellAz::new(feed);
    let backend = RemoteBackend::new(staging(), Arc::clone(&az) as Arc<dyn AzRunner>);
    let mut lines = Vec::new();
    let targets = ["it's-a-slug".to_owned()];
    backend
        .ingest(
            &targets,
            false,
            IngestMode::Changed,
            &mut |line| lines.push(line.to_owned()),
            &mut |_| {},
        )
        .await
        .expect("the ingest finished");

    let body: serde_json::Value =
        serde_json::from_slice(&az.record("ingest-body")).expect("the body is JSON");
    assert_eq!(
        body,
        serde_json::json!({ "force": false, "mode": "changed", "testCases": ["it's-a-slug"] })
    );
    let git: Vec<&String> = lines
        .iter()
        .filter(|line| line.starts_with("git "))
        .collect();
    assert_eq!(
        git,
        [
            "git -C /state/checkout fetch --depth 1 origin staging",
            "git -C /state/checkout reset --hard FETCH_HEAD",
            "git -C /state/checkout submodule sync --recursive",
            "git -C /state/checkout submodule update --init --depth 1 cold-storage",
            "git -C /state/checkout submodule update --init --recursive --force test-suites",
            "git -C /state/checkout submodule status --recursive",
        ]
    );
}

#[tokio::test]
async fn the_detail_command_reads_each_version_in_one_invoke() {
    let az = ShellAz::new("");
    let backend = RemoteBackend::new(staging(), Arc::clone(&az) as Arc<dyn AzRunner>);
    let versions = [
        ("carom".to_owned(), "v1.0.0".to_owned()),
        ("carom".to_owned(), "v1.1.0".to_owned()),
        ("carom".to_owned(), "v9.0.0".to_owned()),
    ];
    let details = backend
        .stored_versions(&versions)
        .await
        .expect("the invoke ran");
    assert_eq!(az.scripts.lock().expect("scripts").len(), 1);
    assert_eq!(
        details[&versions[0]],
        StoredDetail::Stored(serde_json::json!({
            "digest": "abc",
            "referenceBuilds": { "none": "/b/none/" },
        }))
    );
    assert_eq!(details[&versions[1]], StoredDetail::Absent);
    assert_eq!(
        details[&versions[2]],
        StoredDetail::Failed("the backend did not answer".to_owned())
    );
}

#[tokio::test]
async fn the_upload_command_posts_each_archive_and_reads_each_answer() {
    let az = ShellAz::new("");
    let backend = RemoteBackend::new(staging(), Arc::clone(&az) as Arc<dyn AzRunner>);
    let archive = |engine: &str, bytes: Vec<u8>| ReferenceBuildArchive {
        slug: "carom".to_owned(),
        version: "v1.0.0".to_owned(),
        engine: engine.to_owned(),
        archive: bytes,
    };
    let answers = backend
        .upload_reference_builds(&[
            archive("none", vec![0x1f, 0x8b, 0, 1, 2]),
            archive("broken", vec![9; 4096]),
        ])
        .await
        .expect("the invoke ran");

    assert_eq!(
        answers[0].as_ref().expect("stored"),
        &ReferenceBuildUpload {
            engine: "none".to_owned(),
            url: "/suites/it's/none/".to_owned(),
        }
    );
    assert_eq!(
        answers[1].as_ref().expect_err("refused"),
        "the backend answered HTTP 422: no definition declares engine broken"
    );
    assert_eq!(az.record("upload-none"), vec![0x1f, 0x8b, 0, 1, 2]);
    assert_eq!(az.record("upload-broken").len(), 4096);
}

#[test]
fn a_shell_word_survives_single_quotes() {
    assert_eq!(shell_quote("it's"), r#"'it'\''s'"#);
}
