//! Tests for the model catalog: declaration parsing, resolution, and listing.

use super::*;

/// Write a model declaration into a temporary catalog directory.
fn write_model(root: &std::path::Path, slug: &str, body: &str) {
    std::fs::write(root.join(format!("{slug}.toml")), body).expect("write model");
}

#[test]
fn resolves_a_model_with_all_fields() {
    let dir = tempfile::tempdir().expect("temp dir");
    std::fs::write(dir.path().join("gpt-5.md"), "# GPT-5\n").expect("write description");
    write_model(
        dir.path(),
        "gpt-5",
        r#"
            name = "GPT-5"
            provider = "OpenAI"
            openrouter_slug = "openai/gpt-5"
            description = "gpt-5.md"
            model_ids = ["gpt-5", "openai/gpt-5"]
        "#,
    );

    let catalog = ModelCatalog::new(dir.path());
    let model = catalog.resolve("gpt-5").expect("resolve gpt-5");

    assert_eq!(model.slug, "gpt-5");
    assert_eq!(model.name, "GPT-5");
    assert_eq!(model.provider, "OpenAI");
    assert_eq!(model.openrouter_slug.as_deref(), Some("openai/gpt-5"));
    assert_eq!(model.model_ids, vec!["gpt-5", "openai/gpt-5"]);
    assert!(
        model
            .description_path
            .as_deref()
            .is_some_and(|p| p.ends_with("gpt-5.md"))
    );
}

#[test]
fn omitted_optional_fields_default() {
    let dir = tempfile::tempdir().expect("temp dir");
    write_model(
        dir.path(),
        "local-model",
        r#"
            name = "Local Model"
            provider = "Self-hosted"
        "#,
    );

    let model = ModelCatalog::new(dir.path())
        .resolve("local-model")
        .expect("resolve");
    assert_eq!(model.openrouter_slug, None);
    assert_eq!(model.description_path, None);
    assert!(model.model_ids.is_empty());
}

#[test]
fn declared_but_missing_description_is_an_error() {
    let dir = tempfile::tempdir().expect("temp dir");
    write_model(
        dir.path(),
        "ghost",
        r#"
            name = "Ghost"
            provider = "Nowhere"
            description = "missing.md"
        "#,
    );

    assert!(ModelCatalog::new(dir.path()).resolve("ghost").is_err());
}

#[test]
fn list_is_sorted_and_ignores_non_toml() {
    let dir = tempfile::tempdir().expect("temp dir");
    write_model(dir.path(), "zeta", "name = \"Zeta\"\nprovider = \"P\"\n");
    write_model(dir.path(), "alpha", "name = \"Alpha\"\nprovider = \"P\"\n");
    std::fs::write(dir.path().join("notes.md"), "ignored").expect("write stray");

    let models = ModelCatalog::new(dir.path()).list().expect("list");
    let slugs: Vec<_> = models.iter().map(|m| m.slug.as_str()).collect();
    assert_eq!(slugs, vec!["alpha", "zeta"]);
}

#[test]
fn missing_catalog_dir_lists_empty() {
    let dir = tempfile::tempdir().expect("temp dir");
    let catalog = ModelCatalog::new(dir.path().join("does-not-exist"));
    assert!(catalog.list().expect("list").is_empty());
}

#[test]
fn serializes_to_camel_case() {
    let dir = tempfile::tempdir().expect("temp dir");
    write_model(
        dir.path(),
        "m",
        r#"
            name = "M"
            provider = "P"
            openrouter_slug = "p/m"
            model_ids = ["m"]
        "#,
    );
    let model = ModelCatalog::new(dir.path()).resolve("m").expect("resolve");
    let value = serde_json::to_value(&model).expect("serialize");
    assert!(value.get("openrouterSlug").is_some());
    assert!(value.get("modelIds").is_some());
}
