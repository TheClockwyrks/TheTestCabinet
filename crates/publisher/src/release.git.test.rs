//! Tests of the deterministic implementation commit and the tree-aware push
//! against real `git`: implementation repositories in temporary directories and
//! a local bare repository standing in for GitHub (through
//! [`PublishConfig::git_remote_base`]). Only `gh` is faked.

use std::process::Command;
use std::sync::Mutex;

use super::tests::{MockBackend, sample_config, sample_record};
use super::*;

/// The fixed environment the fixtures' own commits are made with, so two
/// fixtures seeded alike carry the same seed commit, as two downloads of one
/// run tree do.
const FIXTURE_ENV: [(&str, &str); 6] = [
    ("GIT_AUTHOR_NAME", "Seeder"),
    ("GIT_AUTHOR_EMAIL", "seed@example.invalid"),
    ("GIT_AUTHOR_DATE", "1700000000 +0000"),
    ("GIT_COMMITTER_NAME", "Seeder"),
    ("GIT_COMMITTER_EMAIL", "seed@example.invalid"),
    ("GIT_COMMITTER_DATE", "1700000000 +0000"),
];

/// Run `git` in `dir` for a fixture, failing the test unless it succeeds, and
/// return its trimmed standard output.
fn git(dir: &Path, args: &[&str], env: &[(&str, &str)]) -> String {
    let output = Command::new("git")
        .args([
            "-c",
            "commit.gpgSign=false",
            "-c",
            "core.hooksPath=/dev/null",
        ])
        .args(args)
        .current_dir(dir)
        .envs(env.iter().copied())
        .output()
        .expect("run git");
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

/// A collected implementation as a run leaves it: a repository with the seed
/// commit and the model's work uncommitted in the working tree.
fn seeded_implementation(dir: &Path) {
    std::fs::create_dir_all(dir.join("src")).expect("src dir");
    std::fs::write(dir.join(".gitignore"), "target/\n").expect(".gitignore");
    std::fs::write(dir.join("src/main.rs"), "fn main() {}\n").expect("seed file");
    git(dir, &["init", "--quiet", "--initial-branch", "main"], &[]);
    git(dir, &["add", "--all"], &[]);
    git(
        dir,
        &["commit", "--quiet", "--message", "Seed test case"],
        &FIXTURE_ENV,
    );
    // The model's work: a change, a new file, and a build output the seeded
    // `.gitignore` keeps out.
    std::fs::write(
        dir.join("src/main.rs"),
        "fn main() {\n    println!(\"pong\");\n}\n",
    )
    .expect("model change");
    std::fs::write(dir.join("src/game.rs"), "pub struct Game;\n").expect("model file");
    std::fs::create_dir_all(dir.join("target")).expect("target dir");
    std::fs::write(dir.join("target/app"), "binary").expect("build output");
}

/// A [`CommandRunner`] that runs `git` for real and fakes `gh`: the repository
/// always exists, so no create (and no settle delay) happens. Every call is
/// recorded.
#[derive(Default)]
struct GitRunner {
    calls: Mutex<Vec<String>>,
}

impl GitRunner {
    fn pushes(&self) -> usize {
        self.calls
            .lock()
            .expect("lock")
            .iter()
            .filter(|c| c.starts_with("git ") && c.contains(" push "))
            .count()
    }
}

#[async_trait::async_trait]
impl CommandRunner for GitRunner {
    async fn run_with_env(
        &self,
        program: &str,
        args: &[&str],
        cwd: Option<&Path>,
        env: &[(&str, &str)],
    ) -> Result<CommandOutput> {
        self.calls
            .lock()
            .expect("lock")
            .push(format!("{program} {}", args.join(" ")));
        match program {
            "git" => {
                SystemCommandRunner
                    .run_with_env(program, args, cwd, env)
                    .await
            }
            "gh" => Ok(CommandOutput {
                success: true,
                stdout: String::new(),
                stderr: String::new(),
            }),
            other => panic!("unexpected program `{other}`"),
        }
    }
}

/// A publisher pushing under `remotes`, with the push retry's delays zeroed.
fn publisher(remotes: &Path) -> BackendPublisher<GitRunner, MockBackend> {
    let config = PublishConfig {
        git_remote_base: remotes.to_str().expect("utf-8 path").to_string(),
        ..sample_config()
    };
    BackendPublisher::new(config, GitRunner::default(), MockBackend).with_push_retry(PushRetry {
        attempts: 5,
        initial_delay: Duration::ZERO,
        backoff: Duration::ZERO,
    })
}

/// Create the run's empty bare repository under `remotes`, returning its path.
fn bare_remote(remotes: &Path) -> PathBuf {
    let record = sample_record();
    let path = PathBuf::from(sample_config().remote_url(&record).replacen(
        DEFAULT_GIT_REMOTE_BASE,
        remotes.to_str().expect("utf-8 path"),
        1,
    ));
    std::fs::create_dir_all(&path).expect("remote dir");
    git(
        &path,
        &["init", "--quiet", "--bare", "--initial-branch", "main"],
        &[],
    );
    path
}

/// Release the run's code from the implementation in `impl_dir`.
async fn release(
    publisher: &BackendPublisher<GitRunner, MockBackend>,
    impl_dir: &Path,
) -> Result<Option<String>> {
    let record = sample_record();
    let artifacts = ArtifactCollection::new(impl_dir.to_path_buf());
    publisher
        .release_code(&ReleaseRequest {
            record: &record,
            artifacts: &artifacts,
            build_dir: None,
        })
        .await
}

/// Push `dir`'s `HEAD` as the remote's `main`, as an earlier publisher would have.
fn push_as_main(dir: &Path, remote: &Path) {
    let remote = remote.to_str().expect("utf-8 path");
    git(
        dir,
        &["push", "--quiet", remote, "HEAD:refs/heads/main"],
        &[],
    );
}

#[tokio::test]
async fn committing_the_same_tree_twice_gives_the_same_sha() {
    let root = tempfile::tempdir().expect("tempdir");
    let date = commit_date(&sample_record().finished_at).expect("date");
    let publisher = publisher(root.path());
    let mut heads = Vec::new();
    for copy in ["first", "second"] {
        let dir = root.path().join(copy);
        seeded_implementation(&dir);
        publisher
            .commit_implementation(&dir, &date)
            .await
            .expect("commit");
        heads.push(git(&dir, &["rev-parse", "HEAD"], &[]));

        let described = git(
            &dir,
            &[
                "log",
                "-1",
                "--format=%an <%ae>|%cn <%ce>|%ad|%cd|%s",
                "--date=raw",
            ],
            &[],
        );
        assert_eq!(
            described,
            "Clockwyrks <runs@clockwyrks.invalid>|Clockwyrks <runs@clockwyrks.invalid>|\
             1781487625 +0000|1781487625 +0000|Publish the run's implementation"
        );
        // The commit carries the model's work and leaves the build output out.
        let files = git(&dir, &["ls-tree", "-r", "--name-only", "HEAD"], &[]);
        assert_eq!(files, ".gitignore\nsrc/game.rs\nsrc/main.rs");
    }
    assert_eq!(heads[0], heads[1]);
}

#[tokio::test]
async fn a_tree_the_model_never_changed_still_gets_the_commit() {
    let root = tempfile::tempdir().expect("tempdir");
    let dir = root.path().join("implementation");
    seeded_implementation(&dir);
    git(&dir, &["checkout", "--quiet", "--", "."], &[]);
    git(&dir, &["clean", "--quiet", "--force", "-d"], &[]);
    let seed = git(&dir, &["rev-parse", "HEAD"], &[]);

    publisher(root.path())
        .commit_implementation(&dir, "1781487625 +0000")
        .await
        .expect("commit");

    assert_eq!(git(&dir, &["rev-parse", "HEAD^"], &[]), seed);
    assert_eq!(
        git(&dir, &["rev-parse", "HEAD^{tree}"], &[]),
        git(&dir, &["rev-parse", "HEAD^^{tree}"], &[])
    );
}

#[tokio::test]
async fn a_repeated_publish_reproduces_the_pushed_commit() {
    let root = tempfile::tempdir().expect("tempdir");
    let remotes = root.path().join("remotes");
    let remote = bare_remote(&remotes);
    let publisher = publisher(&remotes);

    let first = root.path().join("first");
    seeded_implementation(&first);
    release(&publisher, &first).await.expect("first publish");
    let pushed = git(&remote, &["rev-parse", "main"], &[]);
    assert_eq!(pushed, git(&first, &["rev-parse", "HEAD"], &[]));

    // A repeat downloads the tree afresh and reproduces the same commit, so the
    // push finds the remote up to date.
    let second = root.path().join("second");
    seeded_implementation(&second);
    release(&publisher, &second).await.expect("repeat publish");
    assert_eq!(git(&second, &["rev-parse", "HEAD"], &[]), pushed);
    assert_eq!(git(&remote, &["rev-parse", "main"], &[]), pushed);
}

#[tokio::test]
async fn a_remote_holding_the_same_tree_under_another_commit_is_a_success() {
    let root = tempfile::tempdir().expect("tempdir");
    let remotes = root.path().join("remotes");
    let remote = bare_remote(&remotes);

    // An earlier publish carried the same tree under another commit (another
    // message and date).
    let earlier = root.path().join("earlier");
    seeded_implementation(&earlier);
    git(&earlier, &["add", "--all"], &[]);
    git(
        &earlier,
        &["commit", "--quiet", "--message", "Apply run implementation"],
        &FIXTURE_ENV,
    );
    push_as_main(&earlier, &remote);
    let held = git(&remote, &["rev-parse", "main"], &[]);

    let publisher = publisher(&remotes);
    let dir = root.path().join("implementation");
    seeded_implementation(&dir);
    let url = release(&publisher, &dir).await.expect("same tree succeeds");

    assert_eq!(
        url.as_deref(),
        Some("https://github.com/TheClockwyrks/tcab-pong-codex-gpt-5-4-mini-d483a2f9")
    );
    assert_ne!(git(&dir, &["rev-parse", "HEAD"], &[]), held);
    // The remote is left as it was, and the refusal was not retried.
    assert_eq!(git(&remote, &["rev-parse", "main"], &[]), held);
    assert_eq!(publisher.runner().pushes(), 1);
}

#[tokio::test]
async fn a_remote_holding_another_tree_fails_and_is_left_as_it_is() {
    let root = tempfile::tempdir().expect("tempdir");
    let remotes = root.path().join("remotes");
    let remote = bare_remote(&remotes);

    let other = root.path().join("other");
    seeded_implementation(&other);
    std::fs::write(other.join("src/extra.rs"), "// another run's work\n").expect("extra");
    git(&other, &["add", "--all"], &[]);
    git(
        &other,
        &["commit", "--quiet", "--message", "Another tree"],
        &FIXTURE_ENV,
    );
    push_as_main(&other, &remote);
    let held = git(&remote, &["rev-parse", "main"], &[]);

    let publisher = publisher(&remotes);
    let dir = root.path().join("implementation");
    seeded_implementation(&dir);
    let err = release(&publisher, &dir)
        .await
        .expect_err("another tree fails");

    assert!(matches!(err, Error::Diverged(_)), "{err}");
    assert_eq!(git(&remote, &["rev-parse", "main"], &[]), held);
    assert_eq!(publisher.runner().pushes(), 1);
}
