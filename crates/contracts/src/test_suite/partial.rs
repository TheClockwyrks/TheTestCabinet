//! The partial model: one type per test suite file format, in which every key the
//! format requires may be absent.
//!
//! The Spec Cabinet opens a draft in whatever state its author left it, and a draft
//! may be incomplete in any way: any required key absent, any reference naming an
//! entity that has not been authored, any folder empty. The
//! [complete model](super::model) cannot hold such a file — a missing required key is
//! a parse error there — so this module mirrors it with every required key held as an
//! `Option`. A reference is held as the text the file declares, exactly as the
//! complete model holds it, whether or not it resolves.
//!
//! Each type serializes to the same keys in the same order as its complete
//! counterpart, and an absent key is omitted, so the
//! [canonical form](super#the-canonical-form) is shared: a canonically formatted
//! partial file loaded and saved unmodified is rewritten byte for byte, and a
//! complete file emits the same bytes through either model.
//!
//! # Completeness
//!
//! Each type answers which of its required keys are absent through `missing`, and
//! converts to its complete counterpart through `complete` exactly when that list
//! is empty. The two share one list, so the export rule reporting a missing key and
//! the conversion refusing it can never disagree about which keys a file needs.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[path = "partial.tree.rs"]
mod tree;

pub use tree::{
    ASSET_MANIFEST_FILE, DEMO_MANIFEST_FILE, PartialAssetFolder, PartialDebugApi,
    PartialDemoFolder, PartialShowcase, PartialSpecificationFolder, PartialSuiteTree,
    PartialTestCaseFile, SHOWCASE_DESCRIPTION_FILE, SHOWCASE_MANIFEST_FILE,
    SPECIFICATION_MANIFEST_FILE, SPECIFICATION_PROSE_FILE, UnparsedFile,
};

use super::model::{
    AssetCase, AssetManifest, BuildCommands, DebugApiFunction, DebugApiFunctionKind,
    DebugApiModule, DebugApiModuleRef, DebugApiParameter, DemoManifest, ShowcaseManifest,
    ShowcaseMediaEntry, SpecificationManifest, SpriteCase, SuiteAssetKind, SuiteDifficulty,
    SuiteRequirement, SuiteRequirementKind, SuiteTestCaseDefinition, SuiteTestCaseType,
    ToolchainCommands, VersionManifest, VoxelCase, default_max_runtime_hours,
    is_default_max_runtime_hours, is_false,
};

/// A required key that is present, or the key's name pushed onto `missing`.
///
/// The one place a partial value is turned into a complete one, so every
/// conversion reads the same way: collect what is absent, and only build the
/// complete value once nothing is.
fn required<T: Clone>(missing: &mut Vec<String>, key: &str, value: &Option<T>) {
    if value.is_none() {
        missing.push(key.to_owned());
    }
}

/// `version.toml`, with every required key optional.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct PartialVersionManifest {
    /// The suite version in semver form. Export writes it, and a draft omits it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub version: Option<String>,
    /// Classification tags, for filtering. Empty when the key is omitted.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    /// A one-line abstract, authored inline as plain text. Required.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub summary: Option<String>,
    /// The relative path of the Markdown file describing the suite. Required.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub description: Option<String>,
    /// The relative path of the Markdown file recording what changed in this
    /// version. Required.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub changelog: Option<String>,
    /// Whether the version is still being iterated on.
    #[serde(default, skip_serializing_if = "is_false")]
    pub experimental: bool,
}

impl PartialVersionManifest {
    /// The required keys this manifest does not declare.
    pub fn missing(&self) -> Vec<String> {
        let mut missing = Vec::new();
        required(&mut missing, "summary", &self.summary);
        required(&mut missing, "description", &self.description);
        required(&mut missing, "changelog", &self.changelog);
        missing
    }

    /// The complete manifest, or the required keys standing in its way.
    pub fn complete(&self) -> Result<VersionManifest, Vec<String>> {
        let missing = self.missing();
        if !missing.is_empty() {
            return Err(missing);
        }
        Ok(VersionManifest {
            version: self.version.clone(),
            tags: self.tags.clone(),
            summary: self.summary.clone().unwrap_or_default(),
            description: self.description.clone().unwrap_or_default(),
            changelog: self.changelog.clone().unwrap_or_default(),
            experimental: self.experimental,
        })
    }
}

impl From<VersionManifest> for PartialVersionManifest {
    fn from(manifest: VersionManifest) -> Self {
        Self {
            version: manifest.version,
            tags: manifest.tags,
            summary: Some(manifest.summary),
            description: Some(manifest.description),
            changelog: Some(manifest.changelog),
            experimental: manifest.experimental,
        }
    }
}

/// `specifications/<name>/specification.toml`, with every required key optional.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct PartialSpecificationManifest {
    /// Kebab-case identity, unique among every specification in the suite.
    /// Required.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub id: Option<String>,
    /// The display name. Required.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub name: Option<String>,
    /// A single inline plain-text line. Required.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub summary: Option<String>,
    /// Where the rendered specification is seeded, relative to `specs/`.
    /// Required.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub path: Option<String>,
    /// The requirements, in the order they are presented.
    #[serde(rename = "requirement", default, skip_serializing_if = "Vec::is_empty")]
    pub requirements: Vec<PartialRequirement>,
}

impl PartialSpecificationManifest {
    /// The required keys the specification's own table does not declare. A
    /// requirement's keys are the requirement's to report.
    pub fn missing(&self) -> Vec<String> {
        let mut missing = Vec::new();
        required(&mut missing, "id", &self.id);
        required(&mut missing, "name", &self.name);
        required(&mut missing, "summary", &self.summary);
        required(&mut missing, "path", &self.path);
        missing
    }

    /// The complete manifest, or every required key standing in its way — its own,
    /// then each requirement's, prefixed with the requirement's position.
    pub fn complete(&self) -> Result<SpecificationManifest, Vec<String>> {
        let mut missing = self.missing();
        let mut requirements = Vec::with_capacity(self.requirements.len());
        for (index, requirement) in self.requirements.iter().enumerate() {
            match requirement.complete() {
                Ok(complete) => requirements.push(complete),
                Err(keys) => missing.extend(
                    keys.into_iter()
                        .map(|key| format!("requirement {} {key}", index + 1)),
                ),
            }
        }
        if !missing.is_empty() {
            return Err(missing);
        }
        Ok(SpecificationManifest {
            id: self.id.clone().unwrap_or_default(),
            name: self.name.clone().unwrap_or_default(),
            summary: self.summary.clone().unwrap_or_default(),
            path: self.path.clone().unwrap_or_default(),
            requirements,
        })
    }
}

impl From<SpecificationManifest> for PartialSpecificationManifest {
    fn from(manifest: SpecificationManifest) -> Self {
        Self {
            id: Some(manifest.id),
            name: Some(manifest.name),
            summary: Some(manifest.summary),
            path: Some(manifest.path),
            requirements: manifest.requirements.into_iter().map(Into::into).collect(),
        }
    }
}

/// One `[[requirement]]`, with every required key optional.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct PartialRequirement {
    /// Kebab-case identity, unique within the file. Required.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub id: Option<String>,
    /// Whether the requirement is decided by a validator or by review. Required.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub kind: Option<SuiteRequirementKind>,
    /// The RFC 2119 statement. Required.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub text: Option<String>,
    /// Validator module paths relative to `validators/`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub validators: Vec<String>,
}

impl PartialRequirement {
    /// The required keys this requirement does not declare.
    pub fn missing(&self) -> Vec<String> {
        let mut missing = Vec::new();
        required(&mut missing, "id", &self.id);
        required(&mut missing, "kind", &self.kind);
        required(&mut missing, "text", &self.text);
        missing
    }

    /// The complete requirement, or the required keys standing in its way.
    pub fn complete(&self) -> Result<SuiteRequirement, Vec<String>> {
        let missing = self.missing();
        match (&self.id, self.kind, &self.text) {
            (Some(id), Some(kind), Some(text)) if missing.is_empty() => Ok(SuiteRequirement {
                id: id.clone(),
                kind,
                text: text.clone(),
                validators: self.validators.clone(),
            }),
            _ => Err(missing),
        }
    }
}

impl From<SuiteRequirement> for PartialRequirement {
    fn from(requirement: SuiteRequirement) -> Self {
        Self {
            id: Some(requirement.id),
            kind: Some(requirement.kind),
            text: Some(requirement.text),
            validators: requirement.validators,
        }
    }
}

/// A debug API module, with every required key optional.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct PartialDebugApiModule {
    /// The `globalThis` property name. Declared by `debug-api.toml` alone, and
    /// required there — which is a rule about where the module sits, so it is the
    /// validator's to report rather than this type's.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub handle: Option<String>,
    /// What this module covers. Required.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub description: Option<String>,
    /// The functions this module defines.
    #[serde(rename = "function", default, skip_serializing_if = "Vec::is_empty")]
    pub functions: Vec<PartialDebugApiFunction>,
    /// The child modules this module reaches.
    #[serde(rename = "module", default, skip_serializing_if = "Vec::is_empty")]
    pub modules: Vec<PartialDebugApiModuleRef>,
}

impl PartialDebugApiModule {
    /// The required keys the module's own table does not declare.
    pub fn missing(&self) -> Vec<String> {
        let mut missing = Vec::new();
        required(&mut missing, "description", &self.description);
        missing
    }

    /// The complete module, or every required key standing in its way: its own,
    /// then each function's and each child reference's, prefixed with its position.
    pub fn complete(&self) -> Result<DebugApiModule, Vec<String>> {
        let mut missing = self.missing();
        let mut functions = Vec::with_capacity(self.functions.len());
        for (index, function) in self.functions.iter().enumerate() {
            match function.complete() {
                Ok(complete) => functions.push(complete),
                Err(keys) => missing.extend(
                    keys.into_iter()
                        .map(|key| format!("function {} {key}", index + 1)),
                ),
            }
        }
        let mut modules = Vec::with_capacity(self.modules.len());
        for (index, module) in self.modules.iter().enumerate() {
            match module.complete() {
                Ok(complete) => modules.push(complete),
                Err(keys) => missing.extend(
                    keys.into_iter()
                        .map(|key| format!("module {} {key}", index + 1)),
                ),
            }
        }
        if !missing.is_empty() {
            return Err(missing);
        }
        Ok(DebugApiModule {
            handle: self.handle.clone(),
            description: self.description.clone().unwrap_or_default(),
            functions,
            modules,
        })
    }
}

impl From<DebugApiModule> for PartialDebugApiModule {
    fn from(module: DebugApiModule) -> Self {
        Self {
            handle: module.handle,
            description: Some(module.description),
            functions: module.functions.into_iter().map(Into::into).collect(),
            modules: module.modules.into_iter().map(Into::into).collect(),
        }
    }
}

/// A `[[module]]` reference, with every required key optional.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct PartialDebugApiModuleRef {
    /// The property name the module is reached by. Required.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub name: Option<String>,
    /// The file declaring it, relative to the suite tree. Required.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub path: Option<String>,
    /// What the module covers. Required.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub description: Option<String>,
}

impl PartialDebugApiModuleRef {
    /// The required keys this reference does not declare.
    pub fn missing(&self) -> Vec<String> {
        let mut missing = Vec::new();
        required(&mut missing, "name", &self.name);
        required(&mut missing, "path", &self.path);
        required(&mut missing, "description", &self.description);
        missing
    }

    /// The complete reference, or the required keys standing in its way.
    pub fn complete(&self) -> Result<DebugApiModuleRef, Vec<String>> {
        match (&self.name, &self.path, &self.description) {
            (Some(name), Some(path), Some(description)) => Ok(DebugApiModuleRef {
                name: name.clone(),
                path: path.clone(),
                description: description.clone(),
            }),
            _ => Err(self.missing()),
        }
    }
}

impl From<DebugApiModuleRef> for PartialDebugApiModuleRef {
    fn from(module: DebugApiModuleRef) -> Self {
        Self {
            name: Some(module.name),
            path: Some(module.path),
            description: Some(module.description),
        }
    }
}

/// A `[[function]]`, with every required key optional.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct PartialDebugApiFunction {
    /// The property name the function is called by. Required.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub name: Option<String>,
    /// Whether the function reports state or changes it. Required.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub kind: Option<DebugApiFunctionKind>,
    /// The function's TypeScript signature. Required.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub signature: Option<String>,
    /// What a query reports, or what a command changes. Required.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub description: Option<String>,
    /// The parameters worth describing.
    #[serde(rename = "parameter", default, skip_serializing_if = "Vec::is_empty")]
    pub parameters: Vec<PartialDebugApiParameter>,
}

impl PartialDebugApiFunction {
    /// The required keys the function's own table does not declare, then each
    /// parameter's, prefixed with the parameter's position.
    pub fn missing(&self) -> Vec<String> {
        let mut missing = Vec::new();
        required(&mut missing, "name", &self.name);
        required(&mut missing, "kind", &self.kind);
        required(&mut missing, "signature", &self.signature);
        required(&mut missing, "description", &self.description);
        for (index, parameter) in self.parameters.iter().enumerate() {
            missing.extend(
                parameter
                    .missing()
                    .into_iter()
                    .map(|key| format!("parameter {} {key}", index + 1)),
            );
        }
        missing
    }

    /// The complete function, or the required keys standing in its way.
    pub fn complete(&self) -> Result<DebugApiFunction, Vec<String>> {
        let missing = self.missing();
        let parameters: Option<Vec<DebugApiParameter>> = self
            .parameters
            .iter()
            .map(|parameter| parameter.complete().ok())
            .collect();
        match (
            &self.name,
            self.kind,
            &self.signature,
            &self.description,
            parameters,
        ) {
            (Some(name), Some(kind), Some(signature), Some(description), Some(parameters))
                if missing.is_empty() =>
            {
                Ok(DebugApiFunction {
                    name: name.clone(),
                    kind,
                    signature: signature.clone(),
                    description: description.clone(),
                    parameters,
                })
            }
            _ => Err(missing),
        }
    }
}

impl From<DebugApiFunction> for PartialDebugApiFunction {
    fn from(function: DebugApiFunction) -> Self {
        Self {
            name: Some(function.name),
            kind: Some(function.kind),
            signature: Some(function.signature),
            description: Some(function.description),
            parameters: function.parameters.into_iter().map(Into::into).collect(),
        }
    }
}

/// A `[[function.parameter]]`, with every required key optional.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct PartialDebugApiParameter {
    /// The parameter's name. Required.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub name: Option<String>,
    /// What the parameter carries. Required.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub description: Option<String>,
}

impl PartialDebugApiParameter {
    /// The required keys this parameter does not declare.
    pub fn missing(&self) -> Vec<String> {
        let mut missing = Vec::new();
        required(&mut missing, "name", &self.name);
        required(&mut missing, "description", &self.description);
        missing
    }

    /// The complete parameter, or the required keys standing in its way.
    pub fn complete(&self) -> Result<DebugApiParameter, Vec<String>> {
        match (&self.name, &self.description) {
            (Some(name), Some(description)) => Ok(DebugApiParameter {
                name: name.clone(),
                description: description.clone(),
            }),
            _ => Err(self.missing()),
        }
    }
}

impl From<DebugApiParameter> for PartialDebugApiParameter {
    fn from(parameter: DebugApiParameter) -> Self {
        Self {
            name: Some(parameter.name),
            description: Some(parameter.description),
        }
    }
}

/// `assets/<asset-id>/asset.toml`, with every required key optional.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct PartialAssetManifest {
    /// Kebab-case identity, identical to the folder name. Required.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub id: Option<String>,
    /// The display name. Required.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub name: Option<String>,
    /// The asset's format. Required.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub kind: Option<SuiteAssetKind>,
    /// The `id` of the specification describing this asset. Required.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub specification: Option<String>,
    /// The asset's files, relative to the asset folder. Required, and non-empty —
    /// which is a rule about the value rather than about the key being there, so an
    /// empty list is the validator's to report.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub files: Option<Vec<String>>,
}

impl PartialAssetManifest {
    /// The required keys this manifest does not declare.
    pub fn missing(&self) -> Vec<String> {
        let mut missing = Vec::new();
        required(&mut missing, "id", &self.id);
        required(&mut missing, "name", &self.name);
        required(&mut missing, "kind", &self.kind);
        required(&mut missing, "specification", &self.specification);
        required(&mut missing, "files", &self.files);
        missing
    }

    /// The complete manifest, or the required keys standing in its way.
    pub fn complete(&self) -> Result<AssetManifest, Vec<String>> {
        match (
            &self.id,
            &self.name,
            self.kind,
            &self.specification,
            &self.files,
        ) {
            (Some(id), Some(name), Some(kind), Some(specification), Some(files)) => {
                Ok(AssetManifest {
                    id: id.clone(),
                    name: name.clone(),
                    kind,
                    specification: specification.clone(),
                    files: files.clone(),
                })
            }
            _ => Err(self.missing()),
        }
    }
}

impl From<AssetManifest> for PartialAssetManifest {
    fn from(manifest: AssetManifest) -> Self {
        Self {
            id: Some(manifest.id),
            name: Some(manifest.name),
            kind: Some(manifest.kind),
            specification: Some(manifest.specification),
            files: Some(manifest.files),
        }
    }
}

/// `demos/<slug>/demo.toml`, with every required key optional.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct PartialDemoManifest {
    /// Kebab-case identity, matching the directory name. Required.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub id: Option<String>,
    /// The display name. Required.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub name: Option<String>,
    /// A one-line abstract. Required.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub summary: Option<String>,
    /// The `id` of the specification whose mechanic this demonstrates. Required.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub specification: Option<String>,
}

impl PartialDemoManifest {
    /// The required keys this manifest does not declare.
    pub fn missing(&self) -> Vec<String> {
        let mut missing = Vec::new();
        required(&mut missing, "id", &self.id);
        required(&mut missing, "name", &self.name);
        required(&mut missing, "summary", &self.summary);
        required(&mut missing, "specification", &self.specification);
        missing
    }

    /// The complete manifest, or the required keys standing in its way.
    pub fn complete(&self) -> Result<DemoManifest, Vec<String>> {
        match (&self.id, &self.name, &self.summary, &self.specification) {
            (Some(id), Some(name), Some(summary), Some(specification)) => Ok(DemoManifest {
                id: id.clone(),
                name: name.clone(),
                summary: summary.clone(),
                specification: specification.clone(),
            }),
            _ => Err(self.missing()),
        }
    }
}

impl From<DemoManifest> for PartialDemoManifest {
    fn from(manifest: DemoManifest) -> Self {
        Self {
            id: Some(manifest.id),
            name: Some(manifest.name),
            summary: Some(manifest.summary),
            specification: Some(manifest.specification),
        }
    }
}

/// `showcase/showcase.toml`, with every required key optional.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct PartialShowcaseManifest {
    /// The carousel, in carousel order.
    #[serde(rename = "media", default, skip_serializing_if = "Vec::is_empty")]
    pub media: Vec<PartialShowcaseMediaEntry>,
}

impl PartialShowcaseManifest {
    /// Every required key the carousel does not declare, prefixed with the
    /// entry's position.
    pub fn missing(&self) -> Vec<String> {
        self.media
            .iter()
            .enumerate()
            .flat_map(|(index, entry)| {
                entry
                    .missing()
                    .into_iter()
                    .map(move |key| format!("media {} {key}", index + 1))
            })
            .collect()
    }

    /// The complete carousel, or the required keys standing in its way.
    pub fn complete(&self) -> Result<ShowcaseManifest, Vec<String>> {
        let media: Option<Vec<ShowcaseMediaEntry>> = self
            .media
            .iter()
            .map(|entry| entry.complete().ok())
            .collect();
        media
            .map(|media| ShowcaseManifest { media })
            .ok_or_else(|| self.missing())
    }
}

impl From<ShowcaseManifest> for PartialShowcaseManifest {
    fn from(manifest: ShowcaseManifest) -> Self {
        Self {
            media: manifest.media.into_iter().map(Into::into).collect(),
        }
    }
}

/// One `[[media]]` entry, with every required key optional.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct PartialShowcaseMediaEntry {
    /// The media file's name in the showcase directory. Required.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub file: Option<String>,
    /// The short caption. Required.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub name: Option<String>,
}

impl PartialShowcaseMediaEntry {
    /// The required keys this entry does not declare.
    pub fn missing(&self) -> Vec<String> {
        let mut missing = Vec::new();
        required(&mut missing, "file", &self.file);
        required(&mut missing, "name", &self.name);
        missing
    }

    /// The complete entry, or the required keys standing in its way.
    pub fn complete(&self) -> Result<ShowcaseMediaEntry, Vec<String>> {
        match (&self.file, &self.name) {
            (Some(file), Some(name)) => Ok(ShowcaseMediaEntry {
                file: file.clone(),
                name: name.clone(),
            }),
            _ => Err(self.missing()),
        }
    }
}

impl From<ShowcaseMediaEntry> for PartialShowcaseMediaEntry {
    fn from(entry: ShowcaseMediaEntry) -> Self {
        Self {
            file: Some(entry.file),
            name: Some(entry.name),
        }
    }
}

/// `test-cases/<name>.toml`, with every required key optional.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct PartialTestCaseDefinition {
    /// The display name. Required.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub name: Option<String>,
    /// The test case type. Required.
    #[serde(rename = "type", default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub test_type: Option<SuiteTestCaseType>,
    /// The difficulty. Required.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub difficulty: Option<SuiteDifficulty>,
    /// The engine slugs a run may select one entry from.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub engines: Vec<String>,
    /// The specification ids this test case covers; absent covers every one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub specifications: Option<Vec<String>>,
    /// The Handlebars template handed to the harness. Required.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub prompt: Option<String>,
    /// The cap on the session in hours.
    #[serde(
        default = "default_max_runtime_hours",
        skip_serializing_if = "is_default_max_runtime_hours"
    )]
    pub max_runtime_hours: f64,
    /// Whether the definition is kept out of the catalog by default.
    #[serde(default, skip_serializing_if = "is_false")]
    pub experimental: bool,
    /// The command run in the run container after seeding, before the harness.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub init: Option<String>,
    /// The `[sprite]` table.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub sprite: Option<PartialSpriteCase>,
    /// The `[voxel]` table.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub voxel: Option<PartialVoxelCase>,
    /// The `[blender]` table.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub blender: Option<PartialAssetCase>,
    /// The `[particle]` table.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub particle: Option<PartialAssetCase>,
    /// The `[music]` table.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub music: Option<PartialAssetCase>,
    /// The `[audio-fx]` table.
    #[serde(rename = "audio-fx", default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub audio_fx: Option<PartialAssetCase>,
    /// `[workspaces]`: engine slug to starter workspace.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub workspaces: Option<BTreeMap<String, String>>,
    /// `[build]`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub build: Option<PartialBuildCommands>,
    /// `[toolchain]`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub toolchain: Option<PartialToolchainCommands>,
}

impl Default for PartialTestCaseDefinition {
    /// A definition declaring nothing, with the runtime cap at its documented
    /// default so it emits no `max_runtime_hours` key.
    fn default() -> Self {
        Self {
            name: None,
            test_type: None,
            difficulty: None,
            engines: Vec::new(),
            specifications: None,
            prompt: None,
            max_runtime_hours: default_max_runtime_hours(),
            experimental: false,
            init: None,
            sprite: None,
            voxel: None,
            blender: None,
            particle: None,
            music: None,
            audio_fx: None,
            workspaces: None,
            build: None,
            toolchain: None,
        }
    }
}

impl PartialTestCaseDefinition {
    /// The required keys this definition does not declare, including the keys
    /// required inside each table it carries, named as `[table] key`.
    ///
    /// Which tables a definition must carry is decided by its type, and is the
    /// validator's to report; this is only about the keys of what is there.
    pub fn missing(&self) -> Vec<String> {
        let mut missing = Vec::new();
        required(&mut missing, "name", &self.name);
        required(&mut missing, "type", &self.test_type);
        required(&mut missing, "difficulty", &self.difficulty);
        required(&mut missing, "prompt", &self.prompt);
        let tables = [
            ("sprite", self.sprite.as_ref().map(|table| &table.id)),
            ("voxel", self.voxel.as_ref().map(|table| &table.id)),
            ("blender", self.blender.as_ref().map(|table| &table.id)),
            ("particle", self.particle.as_ref().map(|table| &table.id)),
            ("music", self.music.as_ref().map(|table| &table.id)),
            ("audio-fx", self.audio_fx.as_ref().map(|table| &table.id)),
        ];
        for (table, id) in tables {
            if let Some(None) = id {
                missing.push(format!("[{table}] id"));
            }
        }
        if let Some(build) = &self.build {
            required(&mut missing, "[build] install", &build.install);
            required(&mut missing, "[build] build", &build.build);
        }
        if let Some(toolchain) = &self.toolchain {
            required(&mut missing, "[toolchain] typecheck", &toolchain.typecheck);
        }
        missing
    }

    /// The complete definition, or the required keys standing in its way.
    pub fn complete(&self) -> Result<SuiteTestCaseDefinition, Vec<String>> {
        let missing = self.missing();
        if !missing.is_empty() {
            return Err(missing);
        }
        let asset = |table: &Option<PartialAssetCase>| {
            table.as_ref().map(|table| AssetCase {
                id: table.id.clone().unwrap_or_default(),
            })
        };
        Ok(SuiteTestCaseDefinition {
            name: self.name.clone().unwrap_or_default(),
            test_type: self.test_type.unwrap_or(SuiteTestCaseType::EndToEnd),
            difficulty: self.difficulty.unwrap_or(SuiteDifficulty::Easy),
            engines: self.engines.clone(),
            specifications: self.specifications.clone(),
            prompt: self.prompt.clone().unwrap_or_default(),
            max_runtime_hours: self.max_runtime_hours,
            experimental: self.experimental,
            init: self.init.clone(),
            sprite: self.sprite.as_ref().map(|table| SpriteCase {
                id: table.id.clone().unwrap_or_default(),
                sheet: table.sheet,
            }),
            voxel: self.voxel.as_ref().map(|table| VoxelCase {
                id: table.id.clone().unwrap_or_default(),
                animated: table.animated,
            }),
            blender: asset(&self.blender),
            particle: asset(&self.particle),
            music: asset(&self.music),
            audio_fx: asset(&self.audio_fx),
            workspaces: self.workspaces.clone(),
            build: self.build.as_ref().map(|build| BuildCommands {
                install: build.install.clone().unwrap_or_default(),
                build: build.build.clone().unwrap_or_default(),
            }),
            toolchain: self.toolchain.as_ref().map(|toolchain| ToolchainCommands {
                typecheck: toolchain.typecheck.clone().unwrap_or_default(),
                lint: toolchain.lint.clone(),
                format: toolchain.format.clone(),
                test: toolchain.test.clone(),
            }),
        })
    }
}

impl From<SuiteTestCaseDefinition> for PartialTestCaseDefinition {
    fn from(definition: SuiteTestCaseDefinition) -> Self {
        let asset =
            |table: Option<AssetCase>| table.map(|table| PartialAssetCase { id: Some(table.id) });
        Self {
            name: Some(definition.name),
            test_type: Some(definition.test_type),
            difficulty: Some(definition.difficulty),
            engines: definition.engines,
            specifications: definition.specifications,
            prompt: Some(definition.prompt),
            max_runtime_hours: definition.max_runtime_hours,
            experimental: definition.experimental,
            init: definition.init,
            sprite: definition.sprite.map(|table| PartialSpriteCase {
                id: Some(table.id),
                sheet: table.sheet,
            }),
            voxel: definition.voxel.map(|table| PartialVoxelCase {
                id: Some(table.id),
                animated: table.animated,
            }),
            blender: asset(definition.blender),
            particle: asset(definition.particle),
            music: asset(definition.music),
            audio_fx: asset(definition.audio_fx),
            workspaces: definition.workspaces,
            build: definition.build.map(|build| PartialBuildCommands {
                install: Some(build.install),
                build: Some(build.build),
            }),
            toolchain: definition
                .toolchain
                .map(|toolchain| PartialToolchainCommands {
                    typecheck: Some(toolchain.typecheck),
                    lint: toolchain.lint,
                    format: toolchain.format,
                    test: toolchain.test,
                }),
        }
    }
}

/// The `[sprite]` table, with its required key optional.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct PartialSpriteCase {
    /// The id of the asset the model produces. Required.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub id: Option<String>,
    /// Whether the produced asset is a sprite sheet.
    #[serde(default, skip_serializing_if = "is_false")]
    pub sheet: bool,
}

/// The `[voxel]` table, with its required key optional.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct PartialVoxelCase {
    /// The id of the asset the model produces. Required.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub id: Option<String>,
    /// Whether rigid-body animation is required.
    #[serde(default, skip_serializing_if = "is_false")]
    pub animated: bool,
}

/// A type table whose only key is the asset it targets, with that key optional.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct PartialAssetCase {
    /// The id of the asset the model produces. Required.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub id: Option<String>,
}

/// The `[build]` table, with its required keys optional.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct PartialBuildCommands {
    /// Installs the produced implementation's dependencies. Required.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub install: Option<String>,
    /// Produces the static build. Required.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub build: Option<String>,
}

/// The `[toolchain]` table, with its required key optional.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct PartialToolchainCommands {
    /// Typechecks the implementation. Required.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub typecheck: Option<String>,
    /// Lints the implementation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub lint: Option<String>,
    /// Format-checks the implementation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub format: Option<String>,
    /// Runs the implementation's own tests.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub test: Option<String>,
}

#[cfg(test)]
#[path = "partial.test.rs"]
mod tests;
