//! Tests for committing the run's implementation, bundling it and uploading the
//! bundle to the repos service.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path as UrlPath, State};
use axum::http::{HeaderMap, StatusCode};
use axum::routing::post;
use tempfile::TempDir;

use super::*;
use crate::seeding::SEED_COMMIT_MESSAGE;

/// Run git in `dir` for a test's own setup, isolated from the host's configuration.
fn sh_git(dir: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .output()
        .expect("git runs");
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).into_owned()
}

fn write(path: &Path, contents: &str) {
    std::fs::create_dir_all(path.parent().expect("parent")).expect("mkdir");
    std::fs::write(path, contents).expect("write");
}

/// A seeded workspace as the driver collects it: a repository on `main` whose one
/// commit is the seed, with a `.gitignore` ignoring `dist/` and `node_modules/`.
fn seeded_repo() -> TempDir {
    let dir = TempDir::new().expect("tempdir");
    let repo = dir.path();
    sh_git(repo, &["init", "--quiet", "--initial-branch", "main"]);
    sh_git(repo, &["config", "user.name", "Clockwyrks"]);
    sh_git(repo, &["config", "user.email", "runs@clockwyrks.invalid"]);
    write(&repo.join(".gitignore"), "dist/\nnode_modules/\n");
    write(&repo.join("src/main.ts"), "// seed\n");
    write(&repo.join(".vendor/packages/lib/dist/index.js"), "seeded\n");
    sh_git(repo, &["add", "--all"]);
    sh_git(repo, &["add", "--force", ".vendor/packages"]);
    sh_git(
        repo,
        &["commit", "--quiet", "--message", SEED_COMMIT_MESSAGE],
    );
    dir
}

/// Clone `bundle` into a fresh directory and return it.
fn clone_bundle(bundle: &Path) -> TempDir {
    let dir = TempDir::new().expect("tempdir");
    let target = dir.path().join("clone");
    let output = Command::new("git")
        .arg("clone")
        .arg("--quiet")
        .arg(bundle)
        .arg(&target)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .output()
        .expect("git clone runs");
    assert!(
        output.status.success(),
        "clone failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    dir
}

fn clone_path(dir: &TempDir) -> PathBuf {
    dir.path().join("clone")
}

fn subjects(repo: &Path) -> Vec<String> {
    sh_git(repo, &["log", "--format=%s", "main"])
        .lines()
        .map(str::to_string)
        .collect()
}

fn tracked(repo: &Path) -> Vec<String> {
    sh_git(repo, &["ls-tree", "-r", "--name-only", "main"])
        .lines()
        .map(str::to_string)
        .collect()
}

#[test]
fn the_bundle_carries_the_seed_and_the_implementation_on_main() {
    let work = seeded_repo();
    let repo = work.path();
    write(&repo.join("src/main.ts"), "// implemented\n");
    write(&repo.join("src/game.ts"), "export const game = 1;\n");
    // Build output the case ignores, dependencies the collection skips, and the
    // validation media the driver wrote: none of them is the model's work.
    write(&repo.join("dist/index.html"), "<html></html>\n");
    write(&repo.join("node_modules/pkg/index.js"), "dep\n");
    write(&repo.join("web/node_modules/pkg/index.js"), "dep\n");
    write(&repo.join(".vendor/validation/item__shot.png"), "png\n");
    // A file a rebuilt vendored package gained under its ignored `dist/`.
    write(
        &repo.join(".vendor/packages/lib/dist/extra.js"),
        "rebuilt\n",
    );

    let out = TempDir::new().expect("tempdir");
    let bundle = out.path().join("run.bundle");
    commit_and_bundle(repo, &bundle).expect("bundled");

    let clone = clone_bundle(&bundle);
    let cloned = clone_path(&clone);
    assert_eq!(
        subjects(&cloned),
        vec![
            IMPLEMENTATION_COMMIT_MESSAGE.to_string(),
            SEED_COMMIT_MESSAGE.to_string()
        ]
    );
    let files = tracked(&cloned);
    assert!(files.contains(&"src/game.ts".to_string()), "{files:?}");
    assert!(
        files.contains(&".vendor/packages/lib/dist/extra.js".to_string()),
        "{files:?}"
    );
    for absent in [
        "dist/index.html",
        "node_modules/pkg/index.js",
        "web/node_modules/pkg/index.js",
        ".vendor/validation/item__shot.png",
    ] {
        assert!(
            !files.contains(&absent.to_string()),
            "{absent} in {files:?}"
        );
    }
    assert_eq!(
        std::fs::read_to_string(cloned.join("src/main.ts")).expect("read"),
        "// implemented\n"
    );
    // The commit carries the seeding identity.
    assert_eq!(
        sh_git(&cloned, &["log", "-1", "--format=%an <%ae>", "main"]).trim(),
        "Clockwyrks <runs@clockwyrks.invalid>"
    );
}

#[test]
fn a_tree_with_nothing_uncommitted_keeps_the_models_history() {
    let work = seeded_repo();
    let repo = work.path();
    write(&repo.join("src/main.ts"), "// committed by the model\n");
    sh_git(
        repo,
        &["commit", "--quiet", "--all", "--message", "Model work"],
    );

    let out = TempDir::new().expect("tempdir");
    let bundle = out.path().join("run.bundle");
    commit_and_bundle(repo, &bundle).expect("bundled");

    let clone = clone_bundle(&bundle);
    assert_eq!(
        subjects(&clone_path(&clone)),
        vec!["Model work".to_string(), SEED_COMMIT_MESSAGE.to_string()]
    );
}

#[test]
fn a_head_left_on_another_branch_is_what_main_carries() {
    let work = seeded_repo();
    let repo = work.path();
    sh_git(repo, &["checkout", "--quiet", "-b", "feature"]);
    write(&repo.join("src/feature.ts"), "export {};\n");
    sh_git(repo, &["add", "--all"]);
    sh_git(repo, &["commit", "--quiet", "--message", "Feature"]);
    write(&repo.join("src/late.ts"), "export {};\n");

    let out = TempDir::new().expect("tempdir");
    let bundle = out.path().join("run.bundle");
    commit_and_bundle(repo, &bundle).expect("bundled");

    let clone = clone_bundle(&bundle);
    let cloned = clone_path(&clone);
    assert_eq!(
        subjects(&cloned),
        vec![
            IMPLEMENTATION_COMMIT_MESSAGE.to_string(),
            "Feature".to_string(),
            SEED_COMMIT_MESSAGE.to_string()
        ]
    );
    let files = tracked(&cloned);
    assert!(files.contains(&"src/feature.ts".to_string()));
    assert!(files.contains(&"src/late.ts".to_string()));
}

#[test]
fn a_detached_head_is_what_main_carries() {
    let work = seeded_repo();
    let repo = work.path();
    sh_git(repo, &["checkout", "--quiet", "--detach"]);
    write(&repo.join("src/detached.ts"), "export {};\n");

    let out = TempDir::new().expect("tempdir");
    let bundle = out.path().join("run.bundle");
    commit_and_bundle(repo, &bundle).expect("bundled");

    let clone = clone_bundle(&bundle);
    assert!(tracked(&clone_path(&clone)).contains(&"src/detached.ts".to_string()));
}

#[test]
fn nothing_the_model_wrote_into_git_runs_on_the_driver() {
    let work = seeded_repo();
    let repo = work.path();
    let witness = TempDir::new().expect("tempdir");
    let marker = |name: &str| witness.path().join(name);
    let touch = |name: &str| format!("#!/bin/sh\ntouch '{}'\n", marker(name).display());

    // A hook in the default place and one in a hooks directory the config names.
    let hook = repo.join(".git/hooks/pre-commit");
    write(&hook, &touch("hook"));
    let hooks_dir = repo.join("evil-hooks");
    write(&hooks_dir.join("pre-commit"), &touch("hooks-path"));
    write(&hooks_dir.join("post-commit"), &touch("hooks-path"));
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        for path in [
            hook.clone(),
            hooks_dir.join("pre-commit"),
            hooks_dir.join("post-commit"),
        ] {
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).expect("chmod");
        }
    }
    // An fsmonitor command, a clean filter, and an include the config names.
    let fsmonitor = repo.join("fsmonitor.sh");
    write(&fsmonitor, &touch("fsmonitor"));
    sh_git(
        repo,
        &["config", "core.hooksPath", &hooks_dir.display().to_string()],
    );
    sh_git(
        repo,
        &["config", "core.fsmonitor", &fsmonitor.display().to_string()],
    );
    sh_git(
        repo,
        &[
            "config",
            "filter.evil.clean",
            &format!("touch '{}'; cat", marker("filter").display()),
        ],
    );
    write(&repo.join(".gitattributes"), "*.ts filter=evil\n");
    write(&repo.join("src/main.ts"), "// implemented\n");

    let out = TempDir::new().expect("tempdir");
    let bundle = out.path().join("run.bundle");
    commit_and_bundle(repo, &bundle).expect("bundled");

    for name in ["hook", "hooks-path", "fsmonitor", "filter"] {
        assert!(
            !marker(name).exists(),
            "the model's {name} ran on the driver"
        );
    }
    let clone = clone_bundle(&bundle);
    assert_eq!(
        subjects(&clone_path(&clone))[0],
        IMPLEMENTATION_COMMIT_MESSAGE
    );
}

#[test]
fn a_tree_that_is_not_a_repository_is_the_runs_own_failure() {
    let work = TempDir::new().expect("tempdir");
    write(&work.path().join("index.html"), "<html></html>\n");
    let err = commit_and_bundle(work.path(), &work.path().join("x.bundle"))
        .expect_err("not a repository");
    assert!(matches!(err, BundleError::Write(_)), "{err:?}");
    assert!(err.is_runs_own());
}

#[test]
fn a_git_file_pointing_elsewhere_is_not_followed() {
    let work = TempDir::new().expect("tempdir");
    write(&work.path().join(".git"), "gitdir: /elsewhere\n");
    let err = commit_and_bundle(work.path(), &work.path().join("x.bundle"))
        .expect_err("not a repository");
    assert!(err.is_runs_own());
}

#[test]
fn only_a_bad_bundle_or_a_400_413_or_422_is_the_runs_own_failure() {
    let status = |code: u16| BundleError::Status {
        status: reqwest::StatusCode::from_u16(code).expect("status"),
        body: String::new(),
    };
    for code in [400, 413, 422] {
        assert!(status(code).is_runs_own(), "{code}");
    }
    for code in [401, 403, 404, 408, 409, 429, 500, 502, 503] {
        assert!(!status(code).is_runs_own(), "{code}");
    }
    assert!(!BundleError::Stalled(Duration::from_secs(1)).is_runs_own());
    assert!(!BundleError::Read(std::io::Error::other("gone")).is_runs_own());
}

// --- the upload --------------------------------------------------------------

/// One request the stub repos service received.
#[derive(Debug, Clone)]
struct Received {
    run_id: String,
    authorization: Option<String>,
    job_id: Option<String>,
    body: Vec<u8>,
}

/// The stub's state: the statuses to answer in order (the last repeats) and the
/// requests received.
#[derive(Clone)]
struct Stub {
    answers: Arc<Mutex<Vec<StatusCode>>>,
    received: Arc<Mutex<Vec<Received>>>,
}

async fn receive(
    State(stub): State<Stub>,
    UrlPath(run_id): UrlPath<String>,
    headers: HeaderMap,
    body: Bytes,
) -> StatusCode {
    let header = |name: &str| {
        headers
            .get(name)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string)
    };
    stub.received.lock().expect("lock").push(Received {
        run_id,
        authorization: header("authorization"),
        job_id: header("x-tcab-job-id"),
        body: body.to_vec(),
    });
    let mut answers = stub.answers.lock().expect("lock");
    if answers.len() > 1 {
        answers.remove(0)
    } else {
        answers[0]
    }
}

/// A stub repos service answering `answers` in order. Returns its base URL and the
/// requests it received.
async fn stub_repos(answers: Vec<StatusCode>) -> (String, Arc<Mutex<Vec<Received>>>) {
    let stub = Stub {
        answers: Arc::new(Mutex::new(answers)),
        received: Arc::new(Mutex::new(Vec::new())),
    };
    let received = stub.received.clone();
    let app = Router::new()
        .route("/runs/{id}/bundle", post(receive))
        .with_state(stub);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind");
    let addr = listener.local_addr().expect("addr");
    tokio::spawn(async move {
        axum::serve(listener, app).await.expect("serve");
    });
    (format!("http://{addr}"), received)
}

fn fast_policy(give_up_after: Duration) -> RetryPolicy {
    RetryPolicy {
        give_up_after,
        delays: vec![Duration::from_millis(10), Duration::from_millis(20)],
        stall_limit: Duration::from_secs(30),
    }
}

fn target<'a>(url: &'a str) -> BundleTarget<'a> {
    BundleTarget {
        repos_url: url,
        run_id: "run-1",
        job_id: "job-1",
        job_token: "job-token",
    }
}

#[tokio::test]
async fn a_store_condition_is_retried_until_the_bundle_is_stored() {
    let work = seeded_repo();
    write(&work.path().join("src/main.ts"), "// implemented\n");
    let scratch = TempDir::new().expect("tempdir");
    let (url, received) = stub_repos(vec![
        StatusCode::SERVICE_UNAVAILABLE,
        StatusCode::UNAUTHORIZED,
        StatusCode::CREATED,
    ])
    .await;

    store_bundle(
        target(&url),
        work.path(),
        scratch.path(),
        &fast_policy(Duration::from_secs(30)),
        std::future::pending(),
    )
    .await
    .expect("stored");

    let received = received.lock().expect("lock").clone();
    assert_eq!(received.len(), 3);
    for request in &received {
        assert_eq!(request.run_id, "run-1");
        assert_eq!(request.authorization.as_deref(), Some("Bearer job-token"));
        assert_eq!(request.job_id.as_deref(), Some("job-1"));
        // Every attempt sends the whole bundle from its first byte.
        assert_eq!(request.body, received[0].body);
    }
    // What arrived is a bundle `git clone` recreates the repository from.
    let file = scratch.path().join("received.bundle");
    std::fs::write(&file, &received[2].body).expect("write");
    let clone = clone_bundle(&file);
    assert_eq!(
        subjects(&clone_path(&clone)),
        vec![
            IMPLEMENTATION_COMMIT_MESSAGE.to_string(),
            SEED_COMMIT_MESSAGE.to_string()
        ]
    );
    // The temporary bundle is gone once the upload ends.
    let left: Vec<_> = std::fs::read_dir(scratch.path())
        .expect("read")
        .flatten()
        .map(|entry| entry.file_name())
        .filter(|name| name != "received.bundle")
        .collect();
    assert!(left.is_empty(), "{left:?}");
}

#[tokio::test]
async fn a_runs_own_refusal_ends_the_upload_at_once() {
    for code in [
        StatusCode::PAYLOAD_TOO_LARGE,
        StatusCode::BAD_REQUEST,
        StatusCode::UNPROCESSABLE_ENTITY,
    ] {
        let work = seeded_repo();
        let scratch = TempDir::new().expect("tempdir");
        let (url, received) = stub_repos(vec![code]).await;
        let err = store_bundle(
            target(&url),
            work.path(),
            scratch.path(),
            &fast_policy(Duration::from_secs(30)),
            std::future::pending(),
        )
        .await
        .expect_err("refused");
        assert!(
            matches!(&err, BundleError::Status { status, .. } if status.as_u16() == code.as_u16())
        );
        assert_eq!(received.lock().expect("lock").len(), 1, "{code}");
    }
}

#[tokio::test]
async fn a_bundle_that_cannot_be_written_makes_no_request() {
    let work = TempDir::new().expect("tempdir");
    let scratch = TempDir::new().expect("tempdir");
    let (url, received) = stub_repos(vec![StatusCode::CREATED]).await;
    let err = store_bundle(
        target(&url),
        work.path(),
        scratch.path(),
        &fast_policy(Duration::from_secs(30)),
        std::future::pending(),
    )
    .await
    .expect_err("not a repository");
    assert!(err.is_runs_own());
    assert!(received.lock().expect("lock").is_empty());
}

#[tokio::test]
async fn a_zero_wait_makes_a_single_attempt() {
    let work = seeded_repo();
    let scratch = TempDir::new().expect("tempdir");
    let (url, received) = stub_repos(vec![StatusCode::SERVICE_UNAVAILABLE]).await;
    let err = store_bundle(
        target(&url),
        work.path(),
        scratch.path(),
        &fast_policy(Duration::ZERO),
        std::future::pending(),
    )
    .await
    .expect_err("not stored");
    assert!(!err.is_runs_own());
    assert_eq!(received.lock().expect("lock").len(), 1);
}

#[tokio::test]
async fn the_wait_bounds_the_retries_from_the_first_failure() {
    let work = seeded_repo();
    let scratch = TempDir::new().expect("tempdir");
    let (url, received) = stub_repos(vec![StatusCode::BAD_GATEWAY]).await;
    let started = std::time::Instant::now();
    let err = store_bundle(
        target(&url),
        work.path(),
        scratch.path(),
        &fast_policy(Duration::from_millis(300)),
        std::future::pending(),
    )
    .await
    .expect_err("never stored");
    assert!(matches!(&err, BundleError::Status { status, .. } if status.as_u16() == 502));
    assert!(started.elapsed() >= Duration::from_millis(300));
    assert!(received.lock().expect("lock").len() >= 3);
}

#[tokio::test]
async fn an_attempt_with_no_progress_and_no_answer_is_abandoned_as_stalled() {
    let work = seeded_repo();
    let scratch = TempDir::new().expect("tempdir");
    // A service that accepts the connection and never answers.
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind");
    let addr = listener.local_addr().expect("addr");
    tokio::spawn(async move {
        let mut held = Vec::new();
        while let Ok((socket, _)) = listener.accept().await {
            held.push(socket);
        }
    });
    let url = format!("http://{addr}");
    let policy = RetryPolicy {
        give_up_after: Duration::ZERO,
        delays: vec![Duration::from_millis(10)],
        stall_limit: Duration::from_millis(200),
    };
    let err = store_bundle(
        target(&url),
        work.path(),
        scratch.path(),
        &policy,
        std::future::pending(),
    )
    .await
    .expect_err("stalled");
    assert!(matches!(err, BundleError::Stalled(_)), "{err:?}");
    assert!(!err.is_runs_own());
}
