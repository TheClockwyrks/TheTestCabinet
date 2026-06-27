//! The self-contained local cluster the shipped desktop app stands up on launch.
//!
//! The desktop app is meant to be the lowest-friction way to use The Test Cabinet:
//! no git checkout, no image builds, no `make`. So — unless the shell is pointed at
//! an external backend (`TCAB_BACKEND_URL`, the path TTC developers take) — it
//! brings up the *whole* run topology itself on a throwaway **k3d** cluster, the
//! same way [`deployments/local/Makefile`](../../../deployments/local/Makefile)
//! does, but from the **published GHCR images** rather than locally-built ones, and
//! ingesting the test-case catalog the app **bundles** rather than a repo mount.
//!
//! The bootstrap runs as one straight-line routine on its own OS thread, emitting a
//! [`ClusterStatus`] on the `cluster://progress` event after every step so the
//! webview can hold a loading screen until the stack is [`ready`](Phase). The only
//! host prerequisite is a running container runtime — Podman or Docker (preferring a
//! running Podman that can actually run k3s, else a running Docker; see
//! [`detect_runtime`]); `k3d` and `kubectl` ship with the app as sidecars (falling
//! back to `PATH` in development).
//!
//! Resolved service URLs (the forwarded `127.0.0.1` backend) and the live
//! `kubectl port-forward` child processes are kept in the Tauri-managed
//! [`ClusterState`] so [`backend_url`](crate::backend_url) can report them and
//! [`shutdown`] can tear the forwards down on exit.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

/// The k3d cluster (and namespace) the app owns. Deliberately distinct from the
/// Makefile's `tcab`/`tcab-local` so a TTC developer's `make local-up` cluster and
/// the app's cluster never collide on one machine.
const CLUSTER_NAME: &str = "tcab-desktop";
pub(crate) const NAMESPACE: &str = "tcab-desktop";

/// The GHCR namespace the published service images live under (see
/// `.github/workflows/build-service-images.yml`). Substituted into the bundled
/// `overlays/app` `REPLACE_OWNER` placeholders at stage time.
const GHCR_OWNER: &str = "theclockwyrks";

/// The shared dispatcher↔backend claim token. A fixed local value: it never leaves
/// this machine (the cluster is loopback-only), so there is nothing to protect.
const SERVICE_TOKEN: &str = "tcab-desktop-service-token";

/// The event the webview's boot gate listens on for live bootstrap progress.
const PROGRESS_EVENT: &str = "cluster://progress";

/// The event each captured line of subprocess output (k3d/kubectl) is emitted on,
/// so the boot gate can show a live tail of what the long-running steps are doing
/// instead of an opaque progress bar.
const LOG_EVENT: &str = "cluster://log";

/// The forwarded backend URL the webview talks to once the stack is up. Matches the
/// Makefile's `local-forward` backend port; the auth service's forwarded port
/// (8789) is already the shell's [`crate::config::auth_url`] default, so that needs
/// no override.
const BACKEND_URL: &str = "http://127.0.0.1:8787";

/// `(service, localhost port)` forwards the shell holds open — the same set
/// `make local-forward` exposes. Backend and auth let the console talk to the
/// stack; artifacts and arena back the build/media `<img>`/`<iframe>` loads and the
/// arena UI (the backend advertises their URLs via `GET /config`).
const FORWARDS: &[(&str, u16)] = &[
    ("tcab-backend", 8787),
    ("tcab-auth", 8789),
    ("tcab-artifacts", 8790),
    ("tcab-arena", 8791),
];

/// The image tag the app pulls its services at. Stamped at build time by the
/// release workflow to the `:<git-sha>` of the matching service-image build so an
/// installer pins a known-good image set; falls back to `latest` for local builds.
fn image_tag() -> &'static str {
    option_env!("TCAB_DESKTOP_IMAGE_TAG").unwrap_or("latest")
}

/// A coarse bootstrap phase, surfaced to the webview as `ClusterStatus.phase`. The
/// boot gate keys its copy off these strings, so keep them stable.
mod phase {
    pub const PREFLIGHT: &str = "preflight";
    pub const CLUSTER: &str = "cluster";
    pub const SERVICES: &str = "services";
    pub const INGEST: &str = "ingest";
    pub const READY: &str = "ready";
    pub const ERROR: &str = "error";
    /// The dev path: an external backend is configured, so no cluster is stood up.
    pub const SKIPPED: &str = "skipped";
}

/// A snapshot of the bootstrap, mirrored to the webview. `done` marks a terminal
/// state (ready, skipped, or error); `error` distinguishes a failure from success.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClusterStatus {
    /// One of the `phase::*` ids.
    pub phase: String,
    /// A human-readable line for the loading screen.
    pub detail: String,
    /// True once the bootstrap has reached a terminal state.
    pub done: bool,
    /// True when that terminal state is a failure.
    pub error: bool,
}

/// The Tauri-managed cluster lifecycle state: the latest status, the resolved
/// backend URL (once forwarded), and the live port-forward children to reap on exit.
pub struct ClusterState {
    inner: Mutex<Inner>,
}

struct Inner {
    status: ClusterStatus,
    backend_url: Option<String>,
    forwards: Vec<Child>,
}

impl Default for ClusterState {
    fn default() -> Self {
        Self {
            inner: Mutex::new(Inner {
                status: ClusterStatus {
                    phase: phase::PREFLIGHT.to_string(),
                    detail: "Starting…".to_string(),
                    done: false,
                    error: false,
                },
                backend_url: None,
                forwards: Vec::new(),
            }),
        }
    }
}

impl ClusterState {
    /// The latest bootstrap status (the boot gate's initial read).
    pub fn status(&self) -> ClusterStatus {
        self.inner.lock().unwrap().status.clone()
    }

    /// The forwarded backend URL, once the stack is up (else `None`).
    pub fn backend_url(&self) -> Option<String> {
        self.inner.lock().unwrap().backend_url.clone()
    }
}

/// Record + broadcast a status. Updating the managed snapshot before emitting means
/// a late-subscribing webview still reads the current phase via `cluster_status`.
fn publish(app: &AppHandle, phase: &str, detail: impl Into<String>, done: bool, error: bool) {
    let status = ClusterStatus {
        phase: phase.to_string(),
        detail: detail.into(),
        done,
        error,
    };
    if let Some(state) = app.try_state::<ClusterState>() {
        state.inner.lock().unwrap().status = status.clone();
    }
    let _ = app.emit(PROGRESS_EVENT, status);
}

/// Emit one line of subprocess output to the boot gate's live tail. Trimmed and
/// ANSI-stripped by the caller; blank lines are dropped before this is reached.
fn publish_log(app: &AppHandle, line: &str) {
    let _ = app.emit(LOG_EVENT, line);
}

/// Mark the dev path: an external backend is configured, so the app does not stand
/// up its own cluster. The boot gate treats this terminal-non-error state as "go".
pub fn mark_skipped(app: &AppHandle) {
    publish(
        app,
        phase::SKIPPED,
        "Using the configured backend.",
        true,
        false,
    );
}

/// Spawn the bootstrap on its own OS thread (it shells out to k3d/kubectl and waits
/// on rollouts, so it must never run on the UI or async runtime). Re-invokable for a
/// retry after a failure.
pub fn spawn_bootstrap(app: AppHandle) {
    std::thread::spawn(move || {
        if let Err(message) = bootstrap(&app) {
            publish(&app, phase::ERROR, message, true, true);
        }
    });
}

/// Reap the port-forward children on app exit so no `kubectl` processes leak. The
/// cluster itself is intentionally left running for a fast next launch.
pub fn shutdown(app: &AppHandle) {
    if let Some(state) = app.try_state::<ClusterState>() {
        let mut inner = state.inner.lock().unwrap();
        for mut child in inner.forwards.drain(..) {
            let _ = child.kill();
        }
    }
}

/// The whole bootstrap, step by step. Any step's `Err` becomes the terminal error
/// status (with its message shown on the loading screen).
fn bootstrap(app: &AppHandle) -> Result<(), String> {
    publish(
        app,
        phase::PREFLIGHT,
        "Checking prerequisites…",
        false,
        false,
    );
    let runtime = preflight()?;
    tracing::info!(
        runtime = %runtime.binary,
        docker_host = runtime.docker_host.as_deref().unwrap_or("(default)"),
        "resolved the container runtime for the local cluster"
    );

    publish(
        app,
        phase::CLUSTER,
        "Preparing the test-case catalog…",
        false,
        false,
    );
    let checkout = stage_checkout(app)?;
    let overlay = stage_overlay(app)?;
    let kubeconfig = app_data(app)?.join("kubeconfig");

    publish(
        app,
        phase::CLUSTER,
        "Starting the local cluster…",
        false,
        false,
    );
    ensure_cluster(app, &runtime, &checkout, &kubeconfig)?;

    publish(app, phase::SERVICES, "Configuring services…", false, false);
    ensure_namespace(&kubeconfig)?;
    apply_secrets(app, &kubeconfig)?;

    publish(
        app,
        phase::SERVICES,
        "Deploying services (pulling images)…",
        false,
        false,
    );
    apply_overlay(app, &kubeconfig, &overlay)?;

    publish(
        app,
        phase::SERVICES,
        "Waiting for services to become ready…",
        false,
        false,
    );
    wait_for_services(app, &kubeconfig)?;

    publish(app, phase::INGEST, "Connecting…", false, false);
    start_forwards(app, &kubeconfig)?;
    wait_healthz(BACKEND_URL)?;

    publish(
        app,
        phase::INGEST,
        "Loading the test-case catalog…",
        false,
        false,
    );
    ingest(app, BACKEND_URL)?;

    // The backend is reachable and ingested: publish its URL so `backend_url`
    // reports it, then signal the boot gate to reveal the console.
    if let Some(state) = app.try_state::<ClusterState>() {
        state.inner.lock().unwrap().backend_url = Some(BACKEND_URL.to_string());
    }
    publish(app, phase::READY, "Ready.", true, false);
    Ok(())
}

// --- Steps ------------------------------------------------------------------

/// The container runtime k3d runs the cluster on, resolved once at preflight and
/// threaded through every k3d invocation.
struct Runtime {
    /// The runtime binary name, for messages (`podman` or `docker`).
    binary: String,
    /// The value to export as `DOCKER_HOST` so k3d talks to this runtime's API
    /// socket. `None` leaves the inherited environment / default Docker socket in
    /// place (the right thing for Docker, and for a Podman host that already exports
    /// `DOCKER_HOST` itself).
    docker_host: Option<String>,
}

/// Confirm the host prerequisites: a reachable container runtime (k3d's backing
/// daemon) and the k3d/kubectl tools. Returns the resolved [`Runtime`] so the rest
/// of the bootstrap points k3d at the same daemon. Each failure carries actionable
/// remediation — it is the most common reason the app can't start.
fn preflight() -> Result<Runtime, String> {
    let runtime = detect_runtime()?;
    run_quiet(tool("k3d").arg("version")).map_err(|e| format!("k3d is unavailable: {e}"))?;
    run_quiet(tool("kubectl").arg("version").arg("--client"))
        .map_err(|e| format!("kubectl is unavailable: {e}"))?;
    Ok(runtime)
}

/// Resolve the container runtime k3d should use, probing for a *running* one
/// (`<binary> info` succeeding, not merely the binary being installed) and honoring
/// `TCAB_CONTAINER_RUNTIME` as an explicit override.
///
/// Prefers Podman over Docker (matching `crates/core`'s
/// [`CliContainerRuntime::detect`](test_cabinet_core::container::CliContainerRuntime),
/// the local Makefile, and the goal of going Podman-only) — with one exception: a
/// **rootless Podman machine cannot run k3s**. Its server node dies with
/// `failed to find cpuset cgroup (v2)` because rootless cgroup v2 delegation
/// withholds the `cpuset` controller. So when the only running Podman is a rootless
/// machine, a running Docker (e.g. OrbStack) is used instead — and if there is no
/// Docker to fall back to, that's reported *immediately* with the rootful fix rather
/// than left to hang until k3d's create timeout. (Native-Linux rootless Podman, which
/// has no "machine" and can run k3s with proper delegation, is not second-guessed.)
fn detect_runtime() -> Result<Runtime, String> {
    if let Ok(binary) = std::env::var("TCAB_CONTAINER_RUNTIME") {
        let binary = binary.trim().to_string();
        if !binary.is_empty() {
            // Trust the override even if `info` is momentarily unhappy — the user
            // named this runtime specifically.
            return Ok(runtime_named(binary));
        }
    }

    let podman_up = find_on_path("podman").is_some() && runtime_running("podman");
    let docker_up = find_on_path("docker").is_some() && runtime_running("docker");

    if podman_up {
        // `Some(false)` is a confirmed rootless *machine* (macOS/Windows); `Some(true)`
        // rootful; `None` no machine at all (native Linux) — only the confirmed
        // rootless case is the k3s-incompatible one to route around.
        if podman_is_rootful() != Some(false) {
            return Ok(runtime_named("podman".to_string()));
        }
        if docker_up {
            return Ok(runtime_named("docker".to_string()));
        }
        return Err(ROOTLESS_PODMAN_MESSAGE.to_string());
    }
    if docker_up {
        return Ok(runtime_named("docker".to_string()));
    }

    Err(
        if find_on_path("podman").is_some() || find_on_path("docker").is_some() {
            "A container runtime is installed but not running. The Test Cabinet stands its \
         services up on a local cluster, which needs a running Docker- or \
         Podman-compatible runtime. Start it and try again."
                .to_string()
        } else {
            "No container runtime found. The Test Cabinet stands its services up on a local \
         cluster, which needs Docker or Podman installed and running. Install one, start \
         it, and try again."
                .to_string()
        },
    )
}

/// Build a [`Runtime`] for a named binary, resolving Podman's `DOCKER_HOST` socket.
fn runtime_named(binary: String) -> Runtime {
    let docker_host = (binary == "podman").then(podman_docker_host).flatten();
    Runtime {
        binary,
        docker_host,
    }
}

/// Whether `<binary> info` succeeds — i.e. the runtime's daemon is actually up.
fn runtime_running(binary: &str) -> bool {
    run_quiet(tool(binary).arg("info")).is_ok()
}

/// The error shown when the only running runtime is a rootless Podman machine, which
/// can't run k3s. Names the underlying cgroup failure so it's recognizable.
const ROOTLESS_PODMAN_MESSAGE: &str = "Podman is running, but its machine is rootless — \
    k3s can't start there (its server node fails with \"failed to find cpuset cgroup \
    (v2)\", because rootless cgroup v2 delegation withholds the cpuset controller). Make \
    the machine rootful: run `podman machine stop && podman machine set --rootful && \
    podman machine start`, then try again. (Or start a Docker-compatible runtime, or set \
    TCAB_CONTAINER_RUNTIME to force a specific one.)";

/// The `DOCKER_HOST` value that points k3d at Podman's API socket. Returns `None`
/// when the environment already sets `DOCKER_HOST` (respect it) or no socket can be
/// resolved (let k3d fall back to its default).
///
/// On macOS/Windows Podman runs inside a VM, so the *host-reachable* socket is the
/// forwarded one `podman machine inspect` reports — **not** the one `podman info`
/// reports there, which is the path *inside* the VM (`/run/user/<uid>/podman/…`) and
/// is unreachable from the host (k3d connecting to it fails with "Cannot connect to
/// the Docker daemon"). So the machine socket is tried first; `podman info` is the
/// fallback for native Linux, where there is no VM and that path is correct.
fn podman_docker_host() -> Option<String> {
    if std::env::var_os("DOCKER_HOST").is_some_and(|v| !v.is_empty()) {
        return None;
    }
    podman_socket(&[
        "machine",
        "inspect",
        "--format",
        "{{.ConnectionInfo.PodmanSocket.Path}}",
    ])
    .or_else(|| podman_socket(&["info", "--format", "{{.Host.RemoteSocket.Path}}"]))
}

/// Run a `podman` query that prints a socket path and turn its output into a
/// `DOCKER_HOST` value, or `None` if the command fails or reports nothing.
fn podman_socket(args: &[&str]) -> Option<String> {
    let out = run(tool("podman").args(args)).ok()?;
    normalize_docker_host(&String::from_utf8_lossy(&out))
}

/// Turn a socket path reported by Podman into a `DOCKER_HOST` value: take the first
/// non-empty line (a multi-machine `podman machine inspect` prints one per machine),
/// and prefix a bare filesystem path with `unix://` (a value that already carries a
/// scheme is passed through untouched). `None` when nothing usable was reported.
fn normalize_docker_host(reported: &str) -> Option<String> {
    let path = reported
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())?;
    Some(if path.contains("://") {
        path.to_string()
    } else {
        format!("unix://{path}")
    })
}

/// Stage the bundled `test-cases/` under `<app-data>/checkout/test-cases` and return
/// the `checkout` dir. k3d maps this dir to `/checkout` on the node, where the
/// backend (`TCAB_BACKEND_CHECKOUT=/checkout`) ingests it.
fn stage_checkout(app: &AppHandle) -> Result<PathBuf, String> {
    let checkout = app_data(app)?.join("checkout");
    let src = bundled(app, "test-cases", "", &[Path::new("test-cases")])?;
    mirror_dir(&src, &checkout.join("test-cases"))?;
    Ok(checkout)
}

/// Stage the bundled k8s manifests under `<app-data>/k8s`, substitute the GHCR
/// owner/tag placeholders into the `overlays/app` files, and return the overlay dir
/// to `kubectl apply -k`. The whole tree is copied so the overlay's `../../base`
/// reference resolves.
fn stage_overlay(app: &AppHandle) -> Result<PathBuf, String> {
    let dst = app_data(app)?.join("k8s");
    let src = bundled(
        app,
        "k8s",
        "overlays/app/kustomization.yaml",
        &[Path::new("deployments/k8s")],
    )?;
    mirror_dir(&src, &dst)?;
    let overlay = dst.join("overlays").join("app");
    substitute_dir(&overlay)?;
    Ok(overlay)
}

/// Bring the app's k3d cluster up and write the dedicated kubeconfig the shell uses
/// for every `kubectl` call (never touching the user's).
///
/// Robust to a cluster left behind by a previous launch that was closed, crashed, or
/// force-quit mid-bootstrap — the common case being a cluster still *registered* with
/// k3d but whose server container is stopped, so `k3d kubeconfig get` succeeds while
/// every actual API call is connection-refused. A leftover is **started** if it
/// merely stopped, and **recreated** if it can't be brought up (a throwaway cluster
/// is safe to delete). A final reachability probe catches a cluster that reports up
/// but whose API never answers, recreating it once from scratch.
fn ensure_cluster(
    app: &AppHandle,
    runtime: &Runtime,
    checkout: &Path,
    kubeconfig: &Path,
) -> Result<(), String> {
    if cluster_exists(runtime)? {
        // Stopped → start brings it back; broken → delete so the create below
        // rebuilds it (start is a no-op for an already-running cluster).
        if start_cluster(app, runtime).is_err() {
            delete_cluster(runtime)?;
        }
    }
    if !cluster_exists(runtime)? {
        create_cluster(app, runtime, checkout)?;
    }
    write_kubeconfig(runtime, kubeconfig)?;

    // A started/created cluster can still refuse connections — briefly while the API
    // server settles, or permanently if a prior create was interrupted partway. Wait
    // it out; if it never answers, recreate once from scratch and wait again (and let
    // that failure surface).
    if wait_api_reachable(kubeconfig).is_err() {
        delete_cluster(runtime)?;
        create_cluster(app, runtime, checkout)?;
        write_kubeconfig(runtime, kubeconfig)?;
        wait_api_reachable(kubeconfig)?;
    }
    Ok(())
}

/// Create the cluster from scratch, mapping the staged checkout to `/checkout` on the
/// server node. `--wait` (bounded) holds until the server node is ready.
fn create_cluster(app: &AppHandle, runtime: &Runtime, checkout: &Path) -> Result<(), String> {
    let volume = format!("{}:/checkout@server:0", checkout.display());
    run_streaming(
        app,
        k3d(runtime)
            .args(["cluster", "create", CLUSTER_NAME, "--volume"])
            .arg(&volume)
            .args(["--wait", "--timeout", "300s"]),
    )
    .map_err(|e| {
        format!(
            "creating the local cluster: {e}{}",
            podman_rootless_hint(runtime)
        )
    })
}

/// Start an existing (stopped) cluster, waiting until its node is ready. Succeeds
/// quickly when the cluster is already running.
fn start_cluster(app: &AppHandle, runtime: &Runtime) -> Result<(), String> {
    run_streaming(
        app,
        k3d(runtime)
            .args(["cluster", "start", CLUSTER_NAME])
            .args(["--wait", "--timeout", "300s"]),
    )
    .map_err(|e| {
        format!(
            "starting the local cluster: {e}{}",
            podman_rootless_hint(runtime)
        )
    })
}

/// A remediation hint to append to a k3d bring-up failure when the runtime is a
/// *rootless* Podman machine. Normally [`detect_runtime`] routes around such a
/// machine, so this only fires when the user forced it with `TCAB_CONTAINER_RUNTIME`
/// — but then the failure (k3s's `failed to find cpuset cgroup (v2)`) is opaque
/// without it. Empty for Docker, for a rootful machine, or when we can't tell (e.g.
/// native Linux Podman, where there is no machine and this advice wouldn't apply).
fn podman_rootless_hint(runtime: &Runtime) -> String {
    if runtime.binary != "podman" || podman_is_rootful() != Some(false) {
        return String::new();
    }
    " — the Podman machine is rootless, which can't run k3s (its server fails with \
     \"failed to find cpuset cgroup (v2)\"). Make it rootful: `podman machine stop && \
     podman machine set --rootful && podman machine start`, then try again."
        .to_string()
}

/// Whether the Podman machine backing the runtime is rootful. `None` when it can't be
/// determined — there is no machine (native Linux) or the query failed — so callers
/// stay silent rather than guess.
fn podman_is_rootful() -> Option<bool> {
    let out = run(tool("podman").args(["machine", "inspect", "--format", "{{.Rootful}}"])).ok()?;
    match String::from_utf8_lossy(&out)
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())?
    {
        "true" => Some(true),
        "false" => Some(false),
        _ => None,
    }
}

/// Delete the cluster and everything in it. Used to clear a leftover that can't be
/// brought up before recreating it (the cluster is throwaway).
fn delete_cluster(runtime: &Runtime) -> Result<(), String> {
    run_quiet(k3d(runtime).args(["cluster", "delete", CLUSTER_NAME]))
        .map_err(|e| format!("removing the unhealthy local cluster: {e}"))
}

/// Read the cluster's kubeconfig from k3d and write it to the shell's dedicated path.
fn write_kubeconfig(runtime: &Runtime, kubeconfig: &Path) -> Result<(), String> {
    let out = run(k3d(runtime).args(["kubeconfig", "get", CLUSTER_NAME]))
        .map_err(|e| format!("reading the cluster kubeconfig: {e}"))?;
    std::fs::write(kubeconfig, &out)
        .map_err(|e| format!("writing the kubeconfig to {}: {e}", kubeconfig.display()))
}

/// Poll the cluster's API server until it answers or a bound elapses. `--wait` on
/// create/start usually means this passes on the first probe; the loop covers the
/// brief settle after a start and distinguishes a genuinely dead API (so the caller
/// can recreate) from a slow one.
fn wait_api_reachable(kubeconfig: &Path) -> Result<(), String> {
    for _ in 0..30 {
        if run_quiet(kubectl(kubeconfig).arg("get").arg("--raw=/healthz")).is_ok() {
            return Ok(());
        }
        std::thread::sleep(Duration::from_secs(1));
    }
    Err("the cluster's API server did not become reachable".to_string())
}

/// Whether the app's k3d cluster already exists (parsed from `k3d cluster list`).
fn cluster_exists(runtime: &Runtime) -> Result<bool, String> {
    let out = run(k3d(runtime).args(["cluster", "list", "-o", "json"]))
        .map_err(|e| format!("listing k3d clusters: {e}"))?;
    let parsed: serde_json::Value =
        serde_json::from_slice(&out).map_err(|e| format!("parsing the k3d cluster list: {e}"))?;
    Ok(parsed
        .as_array()
        .map(|clusters| {
            clusters
                .iter()
                .any(|c| c.get("name").and_then(|n| n.as_str()) == Some(CLUSTER_NAME))
        })
        .unwrap_or(false))
}

/// Create the namespace if absent (idempotent: an existing one is not an error).
fn ensure_namespace(kubeconfig: &Path) -> Result<(), String> {
    let out = kubectl(kubeconfig)
        .args(["create", "namespace", NAMESPACE])
        .output()
        .map_err(|e| format!("creating the namespace: {e}"))?;
    if out.status.success() || String::from_utf8_lossy(&out.stderr).contains("AlreadyExists") {
        return Ok(());
    }
    Err(format!(
        "creating the namespace: {}",
        String::from_utf8_lossy(&out.stderr).trim()
    ))
}

/// Create the cluster Secrets the manifests reference, by fixed name, from local
/// values: the shared service token (backend + dispatcher) and the per-harness
/// authentication Secrets (driver API keys / auth modes and subscription
/// credential files), built by [`crate::harness_auth`] from the persisted
/// authentication settings layered over the host environment.
fn apply_secrets(app: &AppHandle, kubeconfig: &Path) -> Result<(), String> {
    apply_secret(
        kubeconfig,
        "tcab-backend-secrets",
        &[("TCAB_BACKEND_SERVICE_TOKEN", SERVICE_TOKEN)],
    )?;
    apply_secret(
        kubeconfig,
        "tcab-dispatcher-secrets",
        &[("TCAB_BACKEND_SERVICE_TOKEN", SERVICE_TOKEN)],
    )?;
    crate::harness_auth::apply_harness_secrets(app, kubeconfig)?;
    Ok(())
}

/// Render one Secret with `--dry-run=client` and `kubectl apply -f -` it, so the
/// call is idempotent (created or updated in place) and no value is ever written to
/// disk.
pub(crate) fn apply_secret(
    kubeconfig: &Path,
    name: &str,
    literals: &[(&str, &str)],
) -> Result<(), String> {
    apply_secret_with(kubeconfig, name, |render| {
        for (key, value) in literals {
            render.arg(format!("--from-literal={key}={value}"));
        }
    })
}

/// Like [`apply_secret`], but each entry's value is read by `kubectl` directly from
/// a file on the host (`--from-file=<key>=<path>`), keyed by `key`. Used for the
/// subscription Secret, whose values are the host's signed-in credential files:
/// reading them through `kubectl` keeps arbitrary (possibly binary) bytes intact
/// and keeps the contents off the rendered manifest and out of process arguments.
pub(crate) fn apply_secret_from_files(
    kubeconfig: &Path,
    name: &str,
    files: &[(&str, &Path)],
) -> Result<(), String> {
    apply_secret_with(kubeconfig, name, |render| {
        for (key, path) in files {
            render.arg(format!("--from-file={key}={}", path.display()));
        }
    })
}

/// Shared body for the secret appliers: render `name` to YAML with the
/// caller-supplied `--from-*` flags under `--dry-run=client`, then pipe it to
/// `kubectl apply -f -` (idempotent create-or-update, nothing written to disk).
fn apply_secret_with(
    kubeconfig: &Path,
    name: &str,
    add_sources: impl FnOnce(&mut Command),
) -> Result<(), String> {
    let mut render = kubectl(kubeconfig);
    render.args([
        "create",
        "secret",
        "generic",
        name,
        "-n",
        NAMESPACE,
        "--dry-run=client",
        "-o",
        "yaml",
    ]);
    add_sources(&mut render);
    let manifest = run(&mut render).map_err(|e| format!("rendering secret {name}: {e}"))?;

    let mut apply = kubectl(kubeconfig);
    apply
        .args(["apply", "-f", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    let mut child = apply
        .spawn()
        .map_err(|e| format!("applying secret {name}: {e}"))?;
    child
        .stdin
        .take()
        .ok_or_else(|| format!("applying secret {name}: no stdin"))?
        .write_all(&manifest)
        .map_err(|e| format!("applying secret {name}: {e}"))?;
    let out = child
        .wait_with_output()
        .map_err(|e| format!("applying secret {name}: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "applying secret {name}: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(())
}

/// Apply the staged, substituted desktop overlay.
fn apply_overlay(app: &AppHandle, kubeconfig: &Path, overlay: &Path) -> Result<(), String> {
    run_streaming(app, kubectl(kubeconfig).arg("apply").arg("-k").arg(overlay))
        .map_err(|e| format!("deploying the services: {e}"))?;
    Ok(())
}

/// Block until every always-on workload reports ready (driver Jobs are per-run, so
/// they are not awaited here). Mirrors the Makefile's `apply` rollout waits.
fn wait_for_services(app: &AppHandle, kubeconfig: &Path) -> Result<(), String> {
    const STATEFULSETS: &[&str] = &["tcab-backend", "tcab-auth", "tcab-artifacts"];
    const DEPLOYMENTS: &[&str] = &["tcab-arena", "tcab-dispatcher"];
    for name in STATEFULSETS {
        rollout(app, kubeconfig, "statefulset", name)?;
    }
    for name in DEPLOYMENTS {
        rollout(app, kubeconfig, "deployment", name)?;
    }
    Ok(())
}

fn rollout(app: &AppHandle, kubeconfig: &Path, kind: &str, name: &str) -> Result<(), String> {
    run_streaming(
        app,
        kubectl(kubeconfig).args([
            "-n",
            NAMESPACE,
            "rollout",
            "status",
            &format!("{kind}/{name}"),
            "--timeout=300s",
        ]),
    )
    .map_err(|e| format!("waiting for {name}: {e}"))
}

/// Start (and record) the port-forwards. Each local port is checked first: one already
/// held by another process — an editor's automatic port-forwarding squatting on 8787 is
/// the classic culprit — is reported with the offender, rather than left to misroute the
/// backend probe and surface as an opaque [`wait_healthz`] timeout. Each `kubectl
/// port-forward` is then pinned to `127.0.0.1` (the family [`BACKEND_URL`] and every
/// forwarded-service URL use), so a conflict makes kubectl *exit* with its reason on
/// stderr instead of silently half-binding only `[::1]` and limping; a forward that dies
/// on spawn surfaces that reason here. Recording each child as it spawns means a
/// later-step failure still leaves them reapable by [`shutdown`].
fn start_forwards(app: &AppHandle, kubeconfig: &Path) -> Result<(), String> {
    for (service, port) in FORWARDS {
        if port_in_use(*port) {
            return Err(format!(
                "local port {port} (the {service} forward) is already in use{}. Another \
                 process holds it — an editor's automatic port-forwarding is a common \
                 culprit — so free the port and try again.",
                port_occupant_hint(*port),
            ));
        }

        let mut cmd = kubectl(kubeconfig);
        cmd.args([
            "-n",
            NAMESPACE,
            "port-forward",
            &format!("svc/{service}"),
            "--address",
            "127.0.0.1",
        ])
        .arg(format!("{port}:{port}"))
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("forwarding {service}: {e}"))?;

        // A bind conflict (or any immediate failure) makes kubectl exit right away with
        // its reason on stderr; a healthy forward stays up. Give it a beat, then catch the
        // dead-on-arrival case so it surfaces here rather than as a healthz timeout.
        std::thread::sleep(Duration::from_millis(500));
        if let Some(status) = child
            .try_wait()
            .map_err(|e| format!("checking the {service} forward: {e}"))?
        {
            return Err(format!(
                "forwarding {service} on port {port}: {}",
                forward_exit_detail(&mut child, status),
            ));
        }

        // Still running: drain its stderr on a side thread so the pipe can't fill and
        // wedge the long-lived forward, then record the child for later teardown.
        if let Some(stderr) = child.stderr.take() {
            std::thread::spawn(move || {
                use std::io::Read;
                let _ = std::io::BufReader::new(stderr).read_to_end(&mut Vec::new());
            });
        }
        if let Some(state) = app.try_state::<ClusterState>() {
            state.inner.lock().unwrap().forwards.push(child);
        }
    }
    Ok(())
}

/// The reason a port-forward child that exited on spawn gave, for the error message:
/// its (ANSI-stripped) stderr tail, falling back to the exit status when stderr was
/// empty.
fn forward_exit_detail(child: &mut Child, status: std::process::ExitStatus) -> String {
    use std::io::Read;
    let mut buf = Vec::new();
    if let Some(mut stderr) = child.stderr.take() {
        let _ = stderr.read_to_end(&mut buf);
    }
    let detail = strip_ansi(String::from_utf8_lossy(&buf).trim());
    if detail.is_empty() {
        format!("kubectl exited with {status}")
    } else {
        detail
    }
}

/// Whether another process already holds `127.0.0.1:port`. This is exactly the address
/// the healthz client, [`BACKEND_URL`], and every forwarded-service URL use, so a bind
/// conflict here is precisely one that would misroute those connections to the squatter.
fn port_in_use(port: u16) -> bool {
    std::net::TcpListener::bind(("127.0.0.1", port)).is_err()
}

/// A best-effort " (held by <command>, pid <n>)" suffix naming the process listening on
/// `port`, via `lsof`. Empty when `lsof` is unavailable or names nothing — the conflict
/// is still reported, just without naming the culprit.
fn port_occupant_hint(port: u16) -> String {
    let Ok(out) = run(tool("lsof").args(["-nP", &format!("-iTCP:{port}"), "-sTCP:LISTEN"])) else {
        return String::new();
    };
    parse_lsof_occupant(&String::from_utf8_lossy(&out))
}

/// Parse `lsof -nP -iTCP:<port> -sTCP:LISTEN` output into a " (held by <command>, pid
/// <n>)" suffix from the first listener row (COMMAND in column 0, PID in column 1).
/// Empty when there is no data row. `lsof` escapes spaces in the command as `\x20`,
/// which is unescaped here for readability (e.g. `Code\x20H` → `Code H`).
fn parse_lsof_occupant(text: &str) -> String {
    let Some(fields) = text
        .lines()
        .skip(1) // lsof's header row
        .map(|line| line.split_whitespace().collect::<Vec<_>>())
        .find(|fields| fields.len() >= 2)
    else {
        return String::new();
    };
    format!(
        " (held by {}, pid {})",
        fields[0].replace("\\x20", " "),
        fields[1]
    )
}

/// Poll the backend's `/healthz` until it answers (the port-forward needs a moment),
/// bounded so a stuck forward fails legibly instead of hanging the loading screen. A
/// success requires the backend's own readiness body (`{"status":"ok",…}`), not merely
/// any 2xx — so a foreign listener that happened to win the port (and which
/// [`start_forwards`] couldn't already rule out) is rejected rather than mistaken for
/// the backend.
fn wait_healthz(base: &str) -> Result<(), String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(4))
        .build()
        .map_err(|e| format!("building the HTTP client: {e}"))?;
    let url = format!("{base}/healthz");
    for _ in 0..45 {
        if let Ok(resp) = client.get(&url).send()
            && resp.status().is_success()
            && let Ok(body) = resp.json::<serde_json::Value>()
            && body.get("status").and_then(|status| status.as_str()) == Some("ok")
        {
            return Ok(());
        }
        std::thread::sleep(Duration::from_secs(1));
    }
    Err("the backend did not become reachable in time".to_string())
}

/// Ingest the catalog from the mounted checkout (the backend does not ingest on
/// boot). Asks for the backend's NDJSON progress feed (`Accept:
/// application/x-ndjson`) and drains it line by line, mirroring each completed
/// version into the boot gate's live tail — so the long render shows the same kind
/// of progress as the k3d/kubectl steps instead of an opaque pause. A generous
/// timeout still bounds a first full render of the reference mockups.
///
/// The bundled `test-cases/` are baked into this build, so the build's commit (see
/// [`test_cabinet_core::COMMIT`]) identifies the catalog snapshot. Tagging the
/// ingest with it lets the backend skip the whole re-render when the store already
/// holds that exact catalog — the common case on every restart after the first.
/// Only a *clean* commit is trusted as an identity: a `-dirty` build (or one with
/// no resolvable commit) can change content under the same token, so it forces a
/// full re-ingest instead.
fn ingest(app: &AppHandle, base: &str) -> Result<(), String> {
    use std::io::BufRead;

    let body = match test_cabinet_core::COMMIT {
        Some(commit) if !commit.ends_with("-dirty") => {
            serde_json::json!({ "catalogVersion": commit })
        }
        _ => serde_json::json!({ "force": true }),
    };

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|e| format!("building the HTTP client: {e}"))?;
    let resp = client
        .post(format!("{base}/ingest"))
        .header(reqwest::header::ACCEPT, "application/x-ndjson")
        .json(&body)
        .send()
        .map_err(|e| format!("triggering catalog ingest: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("catalog ingest failed: HTTP {}", resp.status()));
    }

    // The feed is one JSON object per line: a `start` with the version count, a
    // `version` as each is ingested, then a single closing `done` (or `error`). The
    // stream's 200 is sent before the scan runs, so a late failure arrives in-band as
    // an `error` line rather than an HTTP status — hence we also require a `done`.
    let mut completed = false;
    for line in std::io::BufReader::new(resp).lines().map_while(Result::ok) {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(event) = serde_json::from_str::<serde_json::Value>(trimmed) else {
            continue;
        };
        match event.get("event").and_then(|v| v.as_str()) {
            Some("version") => {
                let index = event.get("index").and_then(|v| v.as_u64()).unwrap_or(0);
                let total = event.get("total").and_then(|v| v.as_u64()).unwrap_or(0);
                let slug = event.get("slug").and_then(|v| v.as_str()).unwrap_or("?");
                let version = event.get("version").and_then(|v| v.as_str()).unwrap_or("?");
                publish_log(app, &format!("{slug} {version} ({index}/{total})"));
                publish(
                    app,
                    phase::INGEST,
                    format!("Loading the test-case catalog… ({index}/{total})"),
                    false,
                    false,
                );
            }
            Some("done") => {
                let ingested = event.get("ingested").and_then(|v| v.as_u64()).unwrap_or(0);
                let skipped = event.get("skipped").and_then(|v| v.as_u64()).unwrap_or(0);
                publish_log(
                    app,
                    &format!("Catalog ready: {ingested} ingested, {skipped} skipped"),
                );
                completed = true;
            }
            Some("error") => {
                let message = event
                    .get("message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown error");
                return Err(format!("catalog ingest failed: {message}"));
            }
            // `start` carries only the total, already implied by the per-version lines.
            _ => {}
        }
    }
    if !completed {
        return Err("catalog ingest stream ended before completing".to_string());
    }
    Ok(())
}

// --- Commands ---------------------------------------------------------------

/// The current bootstrap status (the boot gate's initial read before its
/// `cluster://progress` subscription takes over).
#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn cluster_status(state: State<ClusterState>) -> ClusterStatus {
    state.status()
}

/// Re-run the bootstrap after a failure (the loading screen's "Try again").
#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn cluster_retry(app: AppHandle) {
    spawn_bootstrap(app);
}

// --- Helpers ----------------------------------------------------------------

/// The path to the dedicated kubeconfig the shell writes for the desktop cluster,
/// under the app-data dir. Used by the bootstrap and by [`crate::harness_auth`] to
/// re-apply Secrets to the running cluster after a settings change.
pub(crate) fn kubeconfig_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data(app)?.join("kubeconfig"))
}

/// Whether the desktop cluster exists right now. [`crate::harness_auth`] uses this
/// to decide whether a settings change can be applied live (persisting always, and
/// applying only when there is a cluster — there is none on the external-backend
/// developer path).
pub(crate) fn cluster_present() -> bool {
    match detect_runtime() {
        Ok(runtime) => cluster_exists(&runtime).unwrap_or(false),
        Err(_) => false,
    }
}

/// The app-data dir (created if missing), where the staged checkout, manifests, and
/// kubeconfig live.
pub(crate) fn app_data(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("resolving the app-data directory: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("creating {}: {e}", dir.display()))?;
    Ok(dir)
}

/// Resolve a bundled input directory. In a packaged app it sits under the resource
/// dir as `rel`; in development it is read from the repo via one of `dev_rel`
/// (searched from the working dir up through its ancestors).
///
/// `marker` confirms a candidate really holds the expected tree (a relative path
/// that must exist beneath it, or empty to accept any directory) — so a differing
/// bundle layout can't yield a wrong, empty match. A defensive `rel/rel` candidate
/// covers bundlers that nest a directory resource under its own name.
fn bundled(app: &AppHandle, rel: &str, marker: &str, dev_rel: &[&Path]) -> Result<PathBuf, String> {
    let holds = |dir: &Path| -> bool {
        if marker.is_empty() {
            dir.is_dir()
        } else {
            dir.join(marker).exists()
        }
    };
    if let Ok(resources) = app.path().resource_dir() {
        for candidate in [resources.join(rel), resources.join(rel).join(rel)] {
            if holds(&candidate) {
                return Ok(candidate);
            }
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        for base in std::iter::once(cwd.as_path()).chain(cwd.ancestors()) {
            for dev in dev_rel {
                let candidate = base.join(dev);
                if holds(&candidate) {
                    return Ok(candidate);
                }
            }
        }
    }
    Err(format!(
        "bundled resource `{rel}` not found (and no development copy on disk)"
    ))
}

/// Replace each file's GHCR owner/tag placeholders in place (the overlay only).
fn substitute_dir(dir: &Path) -> Result<(), String> {
    for entry in std::fs::read_dir(dir)
        .map_err(|e| format!("reading {}: {e}", dir.display()))?
        .flatten()
    {
        let path = entry.path();
        if path.is_file() {
            let text = std::fs::read_to_string(&path)
                .map_err(|e| format!("reading {}: {e}", path.display()))?;
            std::fs::write(&path, substitute(&text))
                .map_err(|e| format!("writing {}: {e}", path.display()))?;
        }
    }
    Ok(())
}

/// Substitute the overlay's GHCR owner/tag placeholders. (`REPLACE_REGISTRY` image
/// *names* are left alone — they are kustomize match keys, not values to fill.)
fn substitute(text: &str) -> String {
    text.replace("REPLACE_OWNER", GHCR_OWNER)
        .replace("REPLACE_TAG", image_tag())
}

/// Recursively mirror `src` onto `dst`, replacing any prior contents so a re-launch
/// always stages the current bundled inputs.
fn mirror_dir(src: &Path, dst: &Path) -> Result<(), String> {
    if dst.exists() {
        std::fs::remove_dir_all(dst).map_err(|e| format!("clearing {}: {e}", dst.display()))?;
    }
    copy_tree(src, dst)
}

fn copy_tree(src: &Path, dst: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dst).map_err(|e| format!("creating {}: {e}", dst.display()))?;
    for entry in std::fs::read_dir(src)
        .map_err(|e| format!("reading {}: {e}", src.display()))?
        .flatten()
    {
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if from.is_dir() {
            copy_tree(&from, &to)?;
        } else {
            std::fs::copy(&from, &to)
                .map_err(|e| format!("copying {} → {}: {e}", from.display(), to.display()))?;
        }
    }
    Ok(())
}

/// Resolve a tool (`k3d`/`kubectl`/`podman`/`docker`) to a `Command`, preferring a
/// sidecar bundled beside the executable (packaged `k3d`/`kubectl`), then an
/// absolute path found across the inherited and well-known PATH dirs. Whatever it
/// resolves to, the child runs with an [augmented PATH](augmented_path) so a bundled
/// `k3d` shelling out to the container runtime — and a `docker`/`podman` that lives
/// only under Homebrew/OrbStack — is found even when the app was launched from the
/// macOS Dock (which hands the process a truncated `PATH`). `podman`/`docker` are
/// never bundled — the container runtime is the host prerequisite.
fn tool(name: &str) -> Command {
    let mut cmd = match sidecar(name).or_else(|| find_on_path(name)) {
        Some(path) => Command::new(path),
        None => Command::new(name),
    };
    cmd.env("PATH", augmented_path());
    cmd
}

/// A `k3d` command pointed at the resolved [`Runtime`]: when that runtime is Podman
/// with a resolvable socket, `DOCKER_HOST` is exported so k3d talks to Podman rather
/// than hunting for a Docker daemon.
fn k3d(runtime: &Runtime) -> Command {
    let mut cmd = tool("k3d");
    if let Some(host) = &runtime.docker_host {
        cmd.env("DOCKER_HOST", host);
    }
    cmd
}

/// A `kubectl` command pinned to the app's own kubeconfig, so it never reads or
/// mutates the user's current context.
fn kubectl(kubeconfig: &Path) -> Command {
    let mut cmd = tool("kubectl");
    cmd.arg("--kubeconfig").arg(kubeconfig);
    cmd
}

/// A bundled sidecar beside the executable (`<exe-dir>/<name>`), present only in a
/// packaged app. `None` in development, where the tools come from `PATH`.
fn sidecar(name: &str) -> Option<PathBuf> {
    let dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    let mut candidate = dir.join(name);
    if cfg!(windows) {
        candidate.set_extension("exe");
    }
    candidate.is_file().then_some(candidate)
}

/// Find an executable by name across the inherited `PATH` and the
/// [extra dirs](extra_path_dirs) a Dock-launched macOS app's truncated `PATH`
/// omits. Returns its absolute path, so resolution never depends on what the child
/// process's own `PATH` lookup would find.
fn find_on_path(name: &str) -> Option<PathBuf> {
    let file_name = if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    };
    std::env::var_os("PATH")
        .map(|path| std::env::split_paths(&path).collect::<Vec<_>>())
        .unwrap_or_default()
        .into_iter()
        .chain(extra_path_dirs())
        .map(|dir| dir.join(&file_name))
        .find(|candidate| candidate.is_file())
}

/// The inherited `PATH` with the [well-known tool dirs](extra_path_dirs) appended,
/// exported to every child so a bundled `k3d` (and the secret-render pipe to
/// `kubectl`) can find the container runtime even under the truncated `PATH` a
/// GUI-launched macOS app inherits.
fn augmented_path() -> std::ffi::OsString {
    let inherited = std::env::var_os("PATH").unwrap_or_default();
    let dirs = std::env::split_paths(&inherited).chain(extra_path_dirs());
    std::env::join_paths(dirs).unwrap_or(inherited)
}

/// Directories that commonly hold `docker`/`podman`/`k3d`/`kubectl` but are absent
/// from the `/usr/bin:/bin:/usr/sbin:/sbin` `PATH` a macOS app inherits when
/// launched from Finder/Dock (never the shell's login `PATH`). Only existing
/// directories are returned, to keep the exported `PATH` tidy.
fn extra_path_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = [
        "/opt/homebrew/bin", // Homebrew (Apple Silicon)
        "/opt/homebrew/sbin",
        "/usr/local/bin", // Homebrew (Intel), Docker Desktop, OrbStack
        "/usr/local/sbin",
        "/opt/podman/bin",            // Podman's macOS installer
        "/run/current-system/sw/bin", // Nix
    ]
    .iter()
    .map(PathBuf::from)
    .collect();
    if let Some(home) = std::env::var_os("HOME").filter(|h| !h.is_empty()) {
        let home = PathBuf::from(home);
        dirs.push(home.join(".orbstack/bin")); // OrbStack's docker/podman shims
        dirs.push(home.join(".docker/bin")); // Docker Desktop CLI plugins
        dirs.push(home.join(".rd/bin")); // Rancher Desktop
    }
    dirs.retain(|dir| dir.is_dir());
    dirs
}

/// Run a command, returning its captured stdout on success or a message built from
/// its stderr/stdout on failure. The failure message is stripped of ANSI escape
/// codes: tools like k3d (logrus) colorize their output, and those raw escapes would
/// otherwise reach the webview's plain-text error line as mojibake.
fn run(cmd: &mut Command) -> Result<Vec<u8>, String> {
    let out = cmd.output().map_err(|e| format!("failed to launch: {e}"))?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        let stdout = String::from_utf8_lossy(&out.stdout);
        let detail = if stderr.trim().is_empty() {
            stdout.trim()
        } else {
            stderr.trim()
        };
        return Err(strip_ansi(detail));
    }
    Ok(out.stdout)
}

/// Drop ANSI escape sequences (CSI color/SGR codes and the like) from `input` so a
/// captured tool message renders as plain text. A CSI sequence is `ESC [` followed
/// by parameter/intermediate bytes and a final byte in `0x40..=0x7E`; any other
/// escape just has its lone `ESC` dropped.
fn strip_ansi(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '\u{1b}' {
            out.push(c);
            continue;
        }
        if chars.peek() == Some(&'[') {
            chars.next(); // consume '['
            while let Some(&next) = chars.peek() {
                chars.next();
                if ('@'..='~').contains(&next) {
                    break; // the final byte ends the sequence
                }
            }
        }
    }
    out
}

/// As [`run`], discarding the captured output.
fn run_quiet(cmd: &mut Command) -> Result<(), String> {
    run(cmd).map(|_| ())
}

/// Run a long-running command (k3d/kubectl), forwarding each line of its output to
/// the boot gate's live tail as it arrives, instead of blocking silently until it
/// exits. On failure the captured tail (stderr preferred) becomes the error message.
///
/// stdout and stderr are drained concurrently — stderr on a side thread, stdout on
/// this one — so a full pipe can never deadlock the child. The bootstrap already
/// runs on its own OS thread, so the blocking reads here are fine.
fn run_streaming(app: &AppHandle, cmd: &mut Command) -> Result<(), String> {
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| format!("failed to launch: {e}"))?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let app_for_stderr = app.clone();
    let stderr_drain = std::thread::spawn(move || drain(&app_for_stderr, stderr));
    let stdout_lines = drain(app, stdout);
    let stderr_lines = stderr_drain.join().unwrap_or_default();

    let status = child
        .wait()
        .map_err(|e| format!("waiting for the process: {e}"))?;
    if status.success() {
        return Ok(());
    }
    // The last captured line is the most useful summary of what went wrong; prefer
    // stderr (where k3d/kubectl report failures), falling back to stdout.
    let tail = stderr_lines.last().or_else(|| stdout_lines.last());
    Err(match tail {
        Some(line) => line.clone(),
        None => format!("exited with status {status}"),
    })
}

/// Read a child pipe line by line, forwarding each non-empty, ANSI-stripped line to
/// the boot gate's tail and collecting them for the failure message. `None` (a pipe
/// that wasn't captured) drains to nothing.
fn drain<R: std::io::Read>(app: &AppHandle, reader: Option<R>) -> Vec<String> {
    use std::io::BufRead;
    let Some(reader) = reader else {
        return Vec::new();
    };
    let mut lines = Vec::new();
    for line in std::io::BufReader::new(reader)
        .lines()
        .map_while(Result::ok)
    {
        let clean = strip_ansi(&line);
        let trimmed = clean.trim();
        if trimmed.is_empty() {
            continue;
        }
        publish_log(app, trimmed);
        lines.push(trimmed.to_string());
    }
    lines
}

#[cfg(test)]
#[path = "cluster.test.rs"]
mod tests;
