//! The `case_reference_sheet` table: which frames of an asset-generation test-case
//! variant's **reference implementation** have been published to the public
//! snapshot bucket.
//!
//! The asset-generation analogue of [`crate::case_reference_build`]. A reference
//! implementation of an end-to-end or full-stack variant is a deployed static site,
//! so recording it means recording one URL. An asset-generation variant's reference
//! is a *script* (`reference-impl/<variant>/draw.sh`) whose output is a set of
//! rendered frames; `tcab publish-reference` runs it and uploads each frame under a
//! deterministic key derived from the triple and the frame index
//! (`media/references/<slug>/<version>/<variant>/frames/<index>.png` — see
//! `test_cabinet_core::asset_reference`). Every URL is therefore *derivable*, and
//! the only fact worth storing is which frame indices exist.
//!
//! Rows are written **out-of-band**, never at ingest from a manifest and never
//! seeded into a run: the backend learns the set by listing the bucket during
//! ingest and reconciling this table to what it found. Reads feed
//! `GET /test-cases/{slug}/versions/{version}` and the public snapshot, which fold
//! the frame list onto each variant so a client can build the frame URLs itself.
//!
//! One row is one `(slug, version, variant)` triple — the same identity a
//! `ManifestVariant` is addressed by — and the composite primary key means
//! re-publishing a variant upserts its frame list in place rather than accumulating
//! rows. A variant with no published reference simply has no row here. Timestamps
//! are RFC 3339 strings, matching `case_reference_build` and the model-catalog
//! tables, so the schema stays portable across the SQLite (local/tests) and
//! PostgreSQL (deployment) backends.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "case_reference_sheet")]
pub struct Model {
    /// The test-case slug (for example `lattice-belt`); part of the composite
    /// primary key.
    #[sea_orm(primary_key, auto_increment = false)]
    pub slug: String,
    /// The case version (for example `v1.0.0`); part of the composite primary key.
    #[sea_orm(primary_key, auto_increment = false)]
    pub version: String,
    /// The variant slug (for example `base`); part of the composite primary key.
    #[sea_orm(primary_key, auto_increment = false)]
    pub variant: String,
    /// The published frame indices, encoded as ascending, de-duplicated decimal
    /// integers joined by commas with no whitespace (for example `0,1,2`); the empty
    /// string encodes no frames.
    ///
    /// Text rather than an array column because SeaORM's portable schema builder has
    /// no array type common to SQLite and PostgreSQL, and text rather than a child
    /// table because the payload is a handful of small integers. The encoding is
    /// canonical, so two equal frame sets always produce the same string and the
    /// reconcile can detect "nothing moved" with a string comparison. Encode and
    /// decode through the backend's `db` helpers rather than by hand.
    pub frames: String,
    /// RFC 3339 of the last time this row's `frames` was written.
    pub updated_at: String,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
