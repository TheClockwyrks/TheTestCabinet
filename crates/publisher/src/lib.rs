//! The Test Cabinet publisher: a one-shot per-publish-Job binary.
//!
//! The publisher is the publish-path counterpart of the [driver][test-cabinet-driver]:
//! where the driver executes one *run* and streams it back, the publisher releases
//! one *already-reviewed run* — to its own public GitHub repository and a Cloudflare
//! Pages deploy — and streams the publish progress + terminal outcome back to the
//! backend, then exits. The dispatcher creates one publisher Job per claimed publish
//! job; everything it needs arrives through `TCAB_*` env (see [`config`]).
//!
//! It re-implements **none** of the release behavior: the GitHub-repo + Pages work
//! is exactly [`test_cabinet_core::BackendPublisher::release_code`] +
//! [`release_playable_build`](test_cabinet_core::Publisher::release_playable_build),
//! the same two steps a local `tcab publish` drives — only the inputs are downloaded
//! from the artifact service (see [`download`]) instead of read off a local checkout,
//! and the outcome is reported over the publish-job token (see [`client`]) rather
//! than printed.
//!
//! There is no app-level auth on the publisher itself — it is a client, not a
//! server. Its calls authenticate to the backend with the per-publish-job token the
//! dispatcher passed in (see [`client`]); `gh`/`wrangler` authenticate with the
//! `GH_TOKEN`/`CLOUDFLARE_API_TOKEN` the Job's `envFrom` injects (the binary never
//! reads those — the tools do).

pub mod client;
pub mod config;
pub mod download;
pub mod publish;
