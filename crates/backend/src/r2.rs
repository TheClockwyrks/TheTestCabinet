//! R2 upload over the S3-compatible API with AWS SigV4 signing.
//!
//! The backend holds the only credential that can write the public snapshot
//! bucket (§5). It only ever needs `PutObject`, so rather than pull the full AWS
//! SDK this module signs requests directly with SigV4 over `hmac`/`sha2` and
//! sends them with the already-vendored `reqwest`. The recipe follows AWS's
//! Signature Version 4 for a single-chunk, payload-signed PUT.

use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};
use time::OffsetDateTime;
use time::format_description::FormatItem;
use time::macros::format_description;

use crate::config::R2Config;
use crate::error::{BackendError, Result};

type HmacSha256 = Hmac<Sha256>;

/// `YYYYMMDD'T'HHMMSS'Z'` — the SigV4 `x-amz-date` format.
const AMZ_DATE: &[FormatItem<'_>] =
    format_description!("[year][month][day]T[hour][minute][second]Z");
/// `YYYYMMDD` — the SigV4 credential-scope date.
const SCOPE_DATE: &[FormatItem<'_>] = format_description!("[year][month][day]");

/// The S3 service name SigV4 scopes against.
const SERVICE: &str = "s3";

/// An R2 client that uploads objects to one bucket.
pub struct R2Client {
    config: R2Config,
    http: reqwest::Client,
}

impl R2Client {
    /// Build a client for the given R2 configuration.
    pub fn new(config: R2Config) -> Self {
        Self {
            config,
            http: reqwest::Client::new(),
        }
    }

    /// Upload one object: `PUT {endpoint}/{bucket}/{key}` with `body` and the
    /// given content type, signed with SigV4. Returns an error when the request
    /// cannot be sent or R2 responds with a non-2xx status.
    pub async fn put_object(&self, key: &str, body: Vec<u8>, content_type: &str) -> Result<()> {
        let now = OffsetDateTime::now_utc();
        let amz_date = now
            .format(AMZ_DATE)
            .map_err(|e| BackendError::Snapshot(format!("formatting amz-date: {e}")))?;
        let scope_date = now
            .format(SCOPE_DATE)
            .map_err(|e| BackendError::Snapshot(format!("formatting scope-date: {e}")))?;

        // The canonical URI is `/{bucket}/{key}`, each path segment URI-encoded
        // (S3 does not encode the `/` separators). The host comes from the
        // endpoint so the `Host` header and signature agree.
        let endpoint = url::trim_scheme(&self.config.endpoint);
        let host = endpoint.host.clone();
        let canonical_uri = format!(
            "/{}/{}",
            uri_encode(&self.config.bucket, false),
            encode_key(key)
        );

        let payload_hash = hex::encode(Sha256::digest(&body));

        // Headers that participate in the signature, sorted by lowercase name.
        let signed_headers = "host;x-amz-content-sha256;x-amz-date";
        let canonical_headers =
            format!("host:{host}\nx-amz-content-sha256:{payload_hash}\nx-amz-date:{amz_date}\n");

        let canonical_request = format!(
            "PUT\n{canonical_uri}\n\n{canonical_headers}\n{signed_headers}\n{payload_hash}"
        );
        let canonical_request_hash = hex::encode(Sha256::digest(canonical_request.as_bytes()));

        let credential_scope =
            format!("{scope_date}/{}/{SERVICE}/aws4_request", self.config.region);
        let string_to_sign =
            format!("AWS4-HMAC-SHA256\n{amz_date}\n{credential_scope}\n{canonical_request_hash}");

        let signature = self.sign(&scope_date, &string_to_sign)?;
        let authorization = format!(
            "AWS4-HMAC-SHA256 Credential={}/{credential_scope}, SignedHeaders={signed_headers}, Signature={signature}",
            self.config.access_key_id
        );

        let url = format!("{}{canonical_uri}", scheme_prefix(&self.config.endpoint));
        let response = self
            .http
            .put(&url)
            .header("Host", host)
            .header("x-amz-date", amz_date)
            .header("x-amz-content-sha256", payload_hash)
            .header("Authorization", authorization)
            .header("Content-Type", content_type)
            .body(body)
            .send()
            .await
            .map_err(|e| BackendError::Snapshot(format!("R2 PUT `{key}` failed: {e}")))?;

        if !response.status().is_success() {
            let status = response.status();
            let detail = response.text().await.unwrap_or_default();
            return Err(BackendError::Snapshot(format!(
                "R2 PUT `{key}` returned {status}: {detail}"
            )));
        }
        Ok(())
    }

    /// Compute the SigV4 signing key chain and sign the string-to-sign.
    fn sign(&self, scope_date: &str, string_to_sign: &str) -> Result<String> {
        let k_date = hmac(
            format!("AWS4{}", self.config.secret_access_key).as_bytes(),
            scope_date.as_bytes(),
        )?;
        let k_region = hmac(&k_date, self.config.region.as_bytes())?;
        let k_service = hmac(&k_region, SERVICE.as_bytes())?;
        let k_signing = hmac(&k_service, b"aws4_request")?;
        let signature = hmac(&k_signing, string_to_sign.as_bytes())?;
        Ok(hex::encode(signature))
    }
}

/// Compute one HMAC-SHA256 in the signing chain.
fn hmac(key: &[u8], data: &[u8]) -> Result<Vec<u8>> {
    let mut mac = HmacSha256::new_from_slice(key)
        .map_err(|e| BackendError::Snapshot(format!("hmac key: {e}")))?;
    mac.update(data);
    Ok(mac.finalize().into_bytes().to_vec())
}

/// URI-encode a single path segment per SigV4's rules. When `encode_slash` is
/// false, `/` is left as-is (so multi-segment keys keep their separators).
fn uri_encode(input: &str, encode_slash: bool) -> String {
    let mut out = String::with_capacity(input.len());
    for byte in input.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(byte as char);
            }
            b'/' if !encode_slash => out.push('/'),
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

/// Encode an object key for the canonical URI, preserving `/` separators.
fn encode_key(key: &str) -> String {
    uri_encode(key, false)
}

/// The `scheme://` prefix of an endpoint (e.g. `https://`).
fn scheme_prefix(endpoint: &str) -> String {
    match endpoint.split_once("://") {
        Some((scheme, rest)) => format!("{scheme}://{}", rest.trim_end_matches('/')),
        None => format!("https://{}", endpoint.trim_end_matches('/')),
    }
}

/// Minimal endpoint parsing: strip the scheme to recover the host for signing.
mod url {
    /// A parsed endpoint's host (everything after the scheme, before any path).
    pub struct Parsed {
        pub host: String,
    }

    /// Strip the scheme from an endpoint, returning its host.
    pub fn trim_scheme(endpoint: &str) -> Parsed {
        let without_scheme = endpoint
            .split_once("://")
            .map(|(_, rest)| rest)
            .unwrap_or(endpoint);
        let host = without_scheme
            .split('/')
            .next()
            .unwrap_or(without_scheme)
            .to_string();
        Parsed { host }
    }
}

#[cfg(test)]
#[path = "r2.test.rs"]
mod tests;
