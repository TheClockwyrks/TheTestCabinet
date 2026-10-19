//! The Test Cabinet publisher: a one-shot per-publish-Job binary.
//!
//! The publisher is the publish-path counterpart of the driver
//! (`test-cabinet-driver`): where the driver executes one *run* and streams it
//! back, the publisher releases one *already-reviewed run* — to its own public
//! GitHub repository and a Cloudflare Pages deploy — and streams the publish
//! progress + terminal outcome back to the backend, then exits. The dispatcher
//! creates one publisher Job per claimed publish job; everything it needs
//! arrives through `TCAB_*` env (see [`config`]).
//!
//! The Pages and GitHub-repo work is
//! [`release_playable_build`](release::Publisher::release_playable_build) and
//! [`release_code`](release::Publisher::release_code), run in that order (see
//! [`release`], and [`pages`] for the deployment lookup); the inputs are downloaded from the artifact service (see
//! [`download`]), and the outcome is reported over the publish-job token (see
//! [`client`]).
//!
//! There is no app-level auth on the publisher itself — it is a client, not a
//! server. Its calls authenticate to the backend with the per-publish-job token the
//! dispatcher passed in (see [`client`]); `gh`/`wrangler` authenticate with the
//! `GH_TOKEN`/`CLOUDFLARE_API_TOKEN` the Job's `envFrom` injects. The binary never
//! reads `GH_TOKEN` (`gh` does); it reads `CLOUDFLARE_ACCOUNT_ID` and
//! `CLOUDFLARE_API_TOKEN` itself to look the build's Pages deployment up before
//! `wrangler` deploys it (see [`pages`]).

pub mod client;
pub mod config;
pub mod download;
pub mod error;
pub mod pages;
pub mod publish;
pub mod release;

pub use error::{Error, Result};
