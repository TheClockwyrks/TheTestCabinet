//! The validator helpers the browser drive and the vitest runners share.
//!
//! A case's checklist flattens into the verdict units its automated validation
//! decides ([`drive_units`]), and the media a drive or a suite recorded is moved to its
//! flat, addressable name ([`relocate_outputs`]). Both validation paths — core's
//! browser drive (`test_cabinet_core::validator`) and the
//! [vitest runner](crate::vitest_validator) — read their work list from here, so one
//! checklist flattens into the same units whichever path decides them. Core
//! re-exports these at their old paths in `test_cabinet_core::validator`.

use std::path::Path;

use crate::test_case::{MediaKind, ReviewItem, ReviewOutput, ReviewValidation};
#[cfg(doc)]
use crate::{test_case::TestCaseVersion, validation::DebugScriptResult};

// The validation media layout, re-exported so the runners name it where they always
// did.
pub use test_cabinet_contracts::layout::{
    VALIDATION_MEDIA_DIR, VALIDATION_SCRIPT_DIR, validation_media_name, validation_output_extension,
};

/// One declared media output of a scripted drive (core's
/// `test_cabinet_core::validator::ScriptedItemDrive`), with whether the drive
/// captured it into the media directory (at its [`validation_media_name`]).
#[derive(Debug, Clone)]
pub struct ScriptedOutput {
    /// The output id — the media file's stem.
    pub id: String,
    /// Human-readable display name.
    pub name: String,
    /// Whether this output is an image or a video clip.
    pub kind: MediaKind,
    /// Whether the driven build produced this output (the file now exists under the
    /// media directory at its [`validation_media_name`]).
    pub present: bool,
}

/// One scripted verdict unit to drive: a whole review item (validated as a whole) or
/// one of its sub-items, resolved to its verdict id, display title, and validation
/// driver. Borrows the driver from the caller's `review_items_for` list.
pub struct DriveUnit<'a> {
    pub item_id: String,
    pub sub_item_id: Option<String>,
    /// The verdict id (`<item>` or `<item>.<sub>`) that keys the auto verdict and media.
    pub verdict_id: String,
    /// The unit's own display title (the sub-item's, or the item's), no category prefix.
    pub title: String,
    /// The backing category/item's title, for grouping under its category.
    pub category_title: String,
    /// Whether this unit is scored: `true` for an ordinary point, `false` when the
    /// backing review point is excluded from scoring for the version (see
    /// [`ReviewItem::scored`] / [`SubReviewItem::scored`](crate::test_case::SubReviewItem::scored)). Carried onto the
    /// [`DebugScriptResult`], where an excluded point costs nothing when it fails to
    /// run because it is not scored at all.
    pub gates: bool,
    pub validation: &'a ReviewValidation,
}

/// Flatten `items` into the verdict units a case's automated validation decides.
///
/// An item validated as a whole contributes one unit keyed by its own id; an item
/// with sub-items contributes one unit per validated sub-item keyed by
/// `<item>.<sub>`. Item-level validation and sub-items are mutually exclusive, so at
/// most one branch fires per item. Both validation paths — the browser drive and the
/// [vitest runner](crate::vitest_validator) — read their work list from here, so one
/// checklist flattens into the same units whichever path decides them.
///
/// `items` is already the run's own checklist
/// ([`TestCaseVersion::review_items_for_engine`]): a point whose validator does not
/// cover the run's engine is gone before this sees it, so every unit here belongs to
/// the run and nothing filters twice.
pub fn drive_units(items: &[ReviewItem]) -> Vec<DriveUnit<'_>> {
    items
        .iter()
        .flat_map(|item| {
            let own = item.validation.as_ref().map(|validation| DriveUnit {
                item_id: item.id.clone(),
                sub_item_id: None,
                verdict_id: item.id.clone(),
                title: item.title.clone(),
                category_title: item.title.clone(),
                gates: item.scored,
                validation,
            });
            let subs = item.sub_items.iter().filter_map(|sub| {
                sub.validation.as_ref().map(|validation| DriveUnit {
                    item_id: item.id.clone(),
                    sub_item_id: Some(sub.id.clone()),
                    verdict_id: ReviewItem::sub_item_verdict_id(&item.id, &sub.id),
                    // The unit's own title is the sub-item's; the category (the item)
                    // groups the sub-items in the reviewer UI, so no prefix here.
                    title: sub.title.clone(),
                    category_title: item.title.clone(),
                    // A sub-item gates only if both it and its parent category are
                    // scored — excluding the whole category also un-gates its points.
                    gates: item.scored && sub.scored,
                    validation,
                })
            });
            own.into_iter().chain(subs)
        })
        .collect()
}

/// Move each declared output's produced file from `tmp` to its stable flat name
/// under `media_dir`, returning the per-output presence record.
///
/// `tmp` is wherever the producer was told to write, named by output id and
/// nothing else: the temp directory a browser drive captures into, or the
/// per-suite directory a [vitest validator](crate::vitest_validator) writes its
/// recordings to. Both arrive here because the destination is the same in both
/// cases — a name keyed by the verdict the media backs, flat enough to route
/// through the one-segment media endpoints.
///
/// A file that is not there is recorded absent rather than treated as a failure.
/// Media is the evidence beside a verdict, not the verdict: what decides the point
/// is the drive's own outcome, or the suite's assertions.
pub fn relocate_outputs(
    outputs: &[ReviewOutput],
    verdict_id: &str,
    media_dir: &Path,
    tmp: &Path,
) -> Vec<ScriptedOutput> {
    outputs
        .iter()
        .map(|output| {
            let ext = validation_output_extension(output.kind);
            let captured = format!("{}.{ext}", output.id);
            let present = relocate(
                &tmp.join(&captured),
                &media_dir.join(validation_media_name(verdict_id, &output.id, output.kind)),
            );
            ScriptedOutput {
                id: output.id.clone(),
                name: output.name.clone(),
                kind: output.kind,
                present,
            }
        })
        .collect()
}

/// Move `from` to `to`, returning whether the source existed and was relocated.
fn relocate(from: &Path, to: &Path) -> bool {
    from.is_file() && std::fs::rename(from, to).is_ok()
}
