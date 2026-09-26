//! Unit tests for the [vision registry](super::VisionSupport) — the two-stage rule that
//! decides whether a model may be shown a picture.

use std::collections::BTreeMap;

use super::*;

/// A declared-modalities map from `(model, modalities)` pairs.
fn declared(entries: &[(&str, &[&str])]) -> BTreeMap<String, Vec<String>> {
    entries
        .iter()
        .map(|(model, modalities)| {
            (
                (*model).to_string(),
                modalities.iter().map(|m| (*m).to_string()).collect(),
            )
        })
        .collect()
}

#[test]
fn declared_image_modality_allows_images() {
    let vision = VisionSupport::new(declared(&[(
        "anthropic/claude-opus-4.8",
        &["text", "image"],
    )]));
    assert!(vision.allows_images("anthropic/claude-opus-4.8"));
    assert!(!vision.declared_text_only("anthropic/claude-opus-4.8"));
}

#[test]
fn declared_text_only_model_is_never_sent_an_image() {
    let vision = VisionSupport::new(declared(&[("z-ai/glm-5.2", &["text"])]));
    assert!(!vision.allows_images("z-ai/glm-5.2"));
    // And the reason is distinguishable, so the agent can be told *why*.
    assert!(vision.declared_text_only("z-ai/glm-5.2"));
}

#[test]
fn undeclared_model_is_treated_optimistically() {
    // The catalog knowing nothing about a model must not withhold a test case's
    // reference mockups from it: unknown is not text-only. The runtime fallback is what
    // covers being wrong.
    let vision = VisionSupport::new(declared(&[("some/other-model", &["text"])]));
    assert!(vision.allows_images("brand-new/model"));
    assert!(!vision.declared_text_only("brand-new/model"));
}

#[test]
fn an_empty_registry_allows_every_model() {
    let vision = VisionSupport::default();
    assert!(vision.allows_images("anything/at-all"));
}

#[test]
fn denying_a_model_stops_images_for_that_model_only() {
    let vision = VisionSupport::new(declared(&[]));
    assert!(vision.allows_images("mystery/model"));

    assert!(vision.deny("mystery/model"), "first denial is reported");
    assert!(!vision.allows_images("mystery/model"));
    // The denial is per model id — every other model is untouched.
    assert!(vision.allows_images("other/model"));
    // A denied-but-undeclared model was never *declared* text-only; the distinction
    // survives the denial, so the agent is told the provider refused rather than that
    // the catalog said so.
    assert!(!vision.declared_text_only("mystery/model"));
}

#[test]
fn repeat_denials_report_only_the_first() {
    // The loop logs on the first denial only, so a run with many agents on one model
    // does not emit the same warning once per agent.
    let vision = VisionSupport::new(declared(&[]));
    assert!(vision.deny("mystery/model"));
    assert!(!vision.deny("mystery/model"));
    assert!(!vision.deny("mystery/model"));
}

#[test]
fn a_denial_is_shared_across_agents_on_the_same_model() {
    // The registry is what the orchestrator shares between the root agent and every
    // subagent: one agent's discovery must silence the rest.
    let vision = Arc::new(VisionSupport::new(declared(&[])));
    let root = Arc::clone(&vision);
    let subagent = Arc::clone(&vision);

    assert!(subagent.allows_images("shared/model"));
    root.deny("shared/model");
    assert!(
        !subagent.allows_images("shared/model"),
        "a model denied on the root's turn is denied for every agent bound to it"
    );
}

#[test]
fn a_declared_model_that_is_denied_stays_denied() {
    // A catalog that claims image support but a provider route that refuses it: the
    // runtime observation wins, since it is the one that actually failed.
    let vision = VisionSupport::new(declared(&[("optimistic/model", &["text", "image"])]));
    assert!(vision.allows_images("optimistic/model"));
    vision.deny("optimistic/model");
    assert!(!vision.allows_images("optimistic/model"));
}
