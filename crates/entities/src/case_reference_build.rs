//! The `case_reference_build` table: the deployed URL of a test-case variant's
//! **reference implementation** — the authored, correct build of that variant.
//!
//! A reference implementation is the case-variant analogue of a run's
//! `run.links.playableBuild`: an in-repo, versioned, buildable static project
//! that a variant may opt into via the `reference_implementation` manifest key.
//! It is built and deployed **out-of-band** (by the `tcab publish-reference` CLI,
//! never at ingest and never seeded into a run), and the served Cloudflare Pages
//! URL is recorded here so the version response and the public snapshot can surface
//! it on the test-case page's "Reference" tab.
//!
//! One row is one `(slug, version, variant)` triple — the same identity a
//! `ManifestVariant` is addressed by — and the composite primary key means a
//! re-deploy of the same variant upserts its `url` in place rather than
//! accumulating rows. A variant with no reference implementation simply has no
//! row here. Timestamps are RFC 3339 strings, matching the model-catalog tables,
//! so the schema stays portable across the SQLite (local/tests) and PostgreSQL
//! (deployment) backends.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "case_reference_build")]
pub struct Model {
    /// The test-case slug (for example `carom`); part of the composite primary key.
    #[sea_orm(primary_key, auto_increment = false)]
    pub slug: String,
    /// The case version (for example `v1.0.1`); part of the composite primary key.
    #[sea_orm(primary_key, auto_increment = false)]
    pub version: String,
    /// The variant slug (for example `base`); part of the composite primary key.
    #[sea_orm(primary_key, auto_increment = false)]
    pub variant: String,
    /// The absolute `https://` URL the reference implementation is served from
    /// (a Cloudflare Pages deployment). Read back from `wrangler` after deploy,
    /// never constructed, because Cloudflare truncates long branch subdomains.
    pub url: String,
    /// RFC 3339 of the last time this row's `url` was written.
    pub updated_at: String,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
