//! `read_file` on an **image**: detection by magic number, attaching the picture for a
//! model that can see one, and describing it (never failing) for one that cannot.
//!
//! The load-bearing property under test is that *no* path here is an error. A test case
//! ships reference mockups, so an agent will read them; reading one must never be what
//! discards a run against a text-only model.

use std::collections::BTreeMap;
use std::sync::Arc;

use serde_json::json;
use tempfile::TempDir;

use super::*;
use crate::tools::{Tool, ToolContext};
use crate::vision::VisionSupport;

/// A minimal but structurally valid PNG (an 8×8 solid square), so the sniffer is
/// exercised against a real header rather than a hand-written magic prefix.
const PNG_BYTES: &[u8] = &[
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00, 0x08, 0x08, 0x02, 0x00, 0x00, 0x00, 0x4B, 0x6D, 0x29,
    0xDC,
];

/// A workspace holding `ref.png`, plus a context whose model is described by
/// `modalities` (`None` = the catalog declared nothing, the optimistic case).
fn workspace_with_image(modalities: Option<&[&str]>) -> (TempDir, ToolContext) {
    let dir = TempDir::new().unwrap();
    std::fs::write(dir.path().join("ref.png"), PNG_BYTES).unwrap();
    let mut declared = BTreeMap::new();
    if let Some(modalities) = modalities {
        declared.insert(
            "test/model".to_string(),
            modalities.iter().map(|m| (*m).to_string()).collect(),
        );
    }
    let support = Arc::new(VisionSupport::new(declared));
    let ctx = ToolContext::new(dir.path()).with_vision("test/model", support);
    (dir, ctx)
}

/// Read `ref.png` through an unlimited-policy tool.
async fn read_ref(ctx: &ToolContext) -> ToolOutcome {
    ReadFileTool::new(ReadPolicy::Unlimited)
        .invoke(json!({ "path": "ref.png" }), ctx)
        .await
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

#[test]
fn sniff_image_recognizes_the_supported_formats() {
    assert_eq!(
        sniff_image(PNG_BYTES).map(|f| f.media_type),
        Some("image/png")
    );
    assert_eq!(
        sniff_image(&[0xFF, 0xD8, 0xFF, 0xE0]).map(|f| f.media_type),
        Some("image/jpeg")
    );
    assert_eq!(
        sniff_image(b"GIF89a....").map(|f| f.media_type),
        Some("image/gif")
    );
    assert_eq!(
        sniff_image(b"RIFF\0\0\0\0WEBPVP8 ").map(|f| f.media_type),
        Some("image/webp")
    );
}

#[test]
fn sniff_image_ignores_text_and_unrecognized_binaries() {
    assert!(sniff_image(b"<!doctype html>").is_none());
    assert!(sniff_image(b"").is_none());
    // An ELF binary is not an image; it must read as the ordinary file it is.
    assert!(sniff_image(b"\x7FELF\x02\x01\x01\0").is_none());
    // A truncated JPEG marker is not enough to claim the format.
    assert!(sniff_image(&[0xFF, 0xD8]).is_none());
}

#[tokio::test]
async fn detection_is_by_content_not_extension() {
    // A mockup saved under the wrong name is still a picture, and a `.png` that holds
    // text is still text — the tool has the bytes, so it uses them.
    let dir = TempDir::new().unwrap();
    std::fs::write(dir.path().join("mockup.txt"), PNG_BYTES).unwrap();
    std::fs::write(dir.path().join("notes.png"), b"just some notes\n").unwrap();
    let ctx = ToolContext::new(dir.path());
    let tool = ReadFileTool::new(ReadPolicy::Unlimited);

    let image = tool.invoke(json!({ "path": "mockup.txt" }), &ctx).await;
    assert!(image.ok);
    assert_eq!(
        image.images.len(),
        1,
        "the misnamed PNG is read as an image"
    );

    let text = tool.invoke(json!({ "path": "notes.png" }), &ctx).await;
    assert!(text.ok);
    assert!(text.images.is_empty());
    assert_eq!(text.output, "just some notes\n");
}

// ---------------------------------------------------------------------------
// A model that can see images
// ---------------------------------------------------------------------------

#[tokio::test]
async fn a_vision_model_receives_the_image_itself() {
    let (_dir, ctx) = workspace_with_image(Some(&["text", "image"]));
    let outcome = read_ref(&ctx).await;

    assert!(outcome.ok);
    assert_eq!(outcome.images.len(), 1);
    let image = &outcome.images[0];
    assert_eq!(image.media_type, "image/png");
    assert_eq!(image.bytes, PNG_BYTES.len() as u64);
    assert!(image.data_url().starts_with("data:image/png;base64,"));
    // The prose names the file and format so the model can refer back to what it saw.
    assert!(outcome.output.contains("ref.png"), "{}", outcome.output);
    assert!(outcome.output.contains("PNG"), "{}", outcome.output);
    // The image bytes are never decoded as text — that would be pure noise.
    assert!(!outcome.output.contains("PNG\r\n"));
}

#[tokio::test]
async fn an_undeclared_model_is_given_the_image_optimistically() {
    // The catalog knowing nothing must not withhold a reference mockup: the runtime
    // fallback covers being wrong, and refusing up front cannot be recovered from.
    let (_dir, ctx) = workspace_with_image(None);
    assert_eq!(read_ref(&ctx).await.images.len(), 1);
}

#[tokio::test]
async fn offset_and_limit_do_not_apply_to_an_image() {
    // They describe lines of text. A picture is returned whole or not at all.
    let (_dir, ctx) = workspace_with_image(Some(&["text", "image"]));
    let outcome = ReadFileTool::new(ReadPolicy::HardCap(1))
        .invoke(json!({ "path": "ref.png", "offset": 4, "limit": 2 }), &ctx)
        .await;

    assert!(outcome.ok);
    assert_eq!(outcome.images.len(), 1);
    assert_eq!(outcome.images[0].bytes, PNG_BYTES.len() as u64);
}

// ---------------------------------------------------------------------------
// A model that cannot
// ---------------------------------------------------------------------------

#[tokio::test]
async fn a_text_only_model_gets_a_description_and_not_an_error() {
    let (_dir, ctx) = workspace_with_image(Some(&["text"]));
    let outcome = read_ref(&ctx).await;

    // The read *succeeds*. This is the whole point: a reference image must never be
    // what fails a run on a text-only model.
    assert!(outcome.ok, "reading an image is never an error");
    assert!(outcome.images.is_empty(), "no image is attached");
    assert!(outcome.output.contains("ref.png"), "{}", outcome.output);
    assert!(outcome.output.contains("PNG"), "{}", outcome.output);
    // The model is told it cannot see images and that retrying is pointless, so it
    // works from the written spec instead of re-reading mockups forever.
    assert!(
        outcome.output.contains("does not accept image input"),
        "{}",
        outcome.output
    );
    assert!(
        outcome.output.contains("will not help"),
        "{}",
        outcome.output
    );
}

#[tokio::test]
async fn a_model_denied_at_runtime_stops_receiving_images() {
    let (_dir, ctx) = workspace_with_image(None);
    assert_eq!(
        read_ref(&ctx).await.images.len(),
        1,
        "optimistic first read"
    );

    // A provider refusal denies the model run-wide; every later read on it describes
    // rather than attaches, so one wasted request is the whole cost.
    ctx.vision.support.deny("test/model");

    let outcome = read_ref(&ctx).await;
    assert!(outcome.ok);
    assert!(outcome.images.is_empty());
    // Worded as the provider's refusal rather than as a catalog fact, because that is
    // what actually happened.
    assert!(
        outcome.output.contains("provider refused"),
        "{}",
        outcome.output
    );
}

#[tokio::test]
async fn an_oversized_image_is_described_rather_than_attached() {
    // An inline image is charged to the window at a rate no estimator can pin down, so
    // an unbounded one is the easiest way to blow a run's context on a single call.
    let dir = TempDir::new().unwrap();
    let mut huge = PNG_BYTES.to_vec();
    huge.resize((IMAGE_ATTACH_CAP + 1) as usize, 0);
    std::fs::write(dir.path().join("ref.png"), &huge).unwrap();
    let ctx = ToolContext::new(dir.path());

    let outcome = read_ref(&ctx).await;
    assert!(outcome.ok, "too large to show is still a successful read");
    assert!(outcome.images.is_empty());
    assert!(outcome.output.contains("too large"), "{}", outcome.output);
}

// ---------------------------------------------------------------------------
// Confinement still applies
// ---------------------------------------------------------------------------

#[tokio::test]
async fn an_image_read_is_still_confined_to_the_workspace() {
    let (_dir, ctx) = workspace_with_image(Some(&["text", "image"]));
    let outcome = ReadFileTool::new(ReadPolicy::Unlimited)
        .invoke(json!({ "path": "../outside.png" }), &ctx)
        .await;
    assert!(!outcome.ok);
    assert!(outcome.output.contains("escapes the workspace root"));
}
