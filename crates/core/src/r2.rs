//! R2 access over the S3-compatible API with AWS SigV4 signing.
//!
//! Two callers share this client, which is why it lives in `core` rather than in
//! either of them:
//!
//! - The **backend** writes the public snapshot bucket on every refresh, and
//!   lists it to skip re-uploading content-stable media.
//! - **`tcab publish-reference`** writes an asset-generation case's reference
//!   sheet into that same bucket under `media/references/…`. An asset reference
//!   is regenerated from its committed script rather than committed as bytes, so
//!   there is nothing in the backend's git checkout for it to publish — the
//!   publishing side must upload directly.
//!
//! Both only ever need `PutObject` and `ListObjectsV2`, so rather than pull the
//! full AWS SDK this module signs requests directly with SigV4 over `hmac`/`sha2`
//! and sends them with the already-vendored `reqwest`. The recipe follows AWS's
//! Signature Version 4 for a single-chunk, payload-signed request.

use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};
use time::OffsetDateTime;
use time::format_description::FormatItem;
use time::macros::format_description;

use crate::error::{Error, Result};

type HmacSha256 = Hmac<Sha256>;

/// Credentials and addressing for the one R2 bucket the project writes.
///
/// Resolved from the same `TCAB_R2_*` environment for every caller, so the
/// backend's snapshot refresh and `tcab publish-reference` cannot drift onto
/// different buckets and leave the site pointing at objects that were never
/// written.
#[derive(Debug, Clone)]
pub struct R2Config {
    /// Cloudflare account id (`TCAB_R2_ACCOUNT_ID`); also derives the endpoint.
    pub account_id: String,
    /// The bucket the snapshot is uploaded to (`TCAB_R2_BUCKET`).
    pub bucket: String,
    /// The S3-API access key id (`TCAB_R2_ACCESS_KEY_ID`).
    pub access_key_id: String,
    /// The S3-API secret (`TCAB_R2_SECRET_ACCESS_KEY`).
    pub secret_access_key: String,
    /// The S3 endpoint. Derived from the account id unless overridden by
    /// `TCAB_R2_ENDPOINT`. Has no trailing slash.
    pub endpoint: String,
    /// The region SigV4 signs against. R2 ignores the region but the S3 signing
    /// recipe requires one; `auto` is Cloudflare's documented value.
    pub region: String,
}

impl R2Config {
    /// Resolve the R2 configuration from the environment, returning `None` when
    /// any of the four required variables is absent (the caller then disables
    /// whatever it would have used R2 for — a dev-only mode). When all four are
    /// present an endpoint is derived from the account id unless
    /// `TCAB_R2_ENDPOINT` overrides it.
    pub fn from_env() -> Option<Self> {
        let nonempty = |key: &str| {
            std::env::var(key)
                .ok()
                .filter(|value| !value.is_empty())
                .map(|value| value.to_string())
        };

        let account_id = nonempty("TCAB_R2_ACCOUNT_ID")?;
        let bucket = nonempty("TCAB_R2_BUCKET")?;
        let access_key_id = nonempty("TCAB_R2_ACCESS_KEY_ID")?;
        let secret_access_key = nonempty("TCAB_R2_SECRET_ACCESS_KEY")?;

        let endpoint = nonempty("TCAB_R2_ENDPOINT")
            .unwrap_or_else(|| format!("https://{account_id}.r2.cloudflarestorage.com"));
        let endpoint = endpoint.trim_end_matches('/').to_string();

        Some(Self {
            account_id,
            bucket,
            access_key_id,
            secret_access_key,
            endpoint,
            region: "auto".to_string(),
        })
    }
}

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
    #[tracing::instrument(
        name = "r2.put_object",
        skip(self, body),
        fields(r2.key = %key, r2.bytes = body.len()),
        err,
    )]
    pub async fn put_object(&self, key: &str, body: Vec<u8>, content_type: &str) -> Result<()> {
        let now = OffsetDateTime::now_utc();
        let amz_date = now
            .format(AMZ_DATE)
            .map_err(|e| Error::R2(format!("formatting amz-date: {e}")))?;
        let scope_date = now
            .format(SCOPE_DATE)
            .map_err(|e| Error::R2(format!("formatting scope-date: {e}")))?;

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

        // Inject the current span's W3C trace context as extra headers so the
        // upload joins the refresh trace. These are not in `signed_headers`, so
        // R2 ignores them for signature validation; a no-op when telemetry is off.
        let mut trace_headers = http::HeaderMap::new();
        test_cabinet_telemetry::propagation::inject_current_context(&mut trace_headers);

        let url = format!("{}{canonical_uri}", scheme_prefix(&self.config.endpoint));
        let response = self
            .http
            .put(&url)
            .header("Host", host)
            .header("x-amz-date", amz_date)
            .header("x-amz-content-sha256", payload_hash)
            .header("Authorization", authorization)
            .header("Content-Type", content_type)
            .headers(trace_headers)
            .body(body)
            .send()
            .await
            .map_err(|e| Error::R2(format!("R2 PUT `{key}` failed: {e}")))?;

        if !response.status().is_success() {
            let status = response.status();
            let detail = response.text().await.unwrap_or_default();
            return Err(Error::R2(format!(
                "R2 PUT `{key}` returned {status}: {detail}"
            )));
        }
        Ok(())
    }

    /// List every object key under `prefix`, following the bucket's pagination to
    /// completion. `GET {endpoint}/{bucket}?list-type=2&prefix=…`, signed with SigV4.
    ///
    /// Two callers rely on it. The backend's snapshot refresh learns which
    /// content-stable media objects (`media/runs/<id>/…`) are already uploaded, so it
    /// references them without re-reading or re-uploading their bytes. Ingest lists
    /// [`crate::asset_reference::REFERENCE_MEDIA_PREFIX`] to discover which
    /// asset-generation references have been published, which is why those need no
    /// committed lockfile.
    ///
    /// Returns an error when a request cannot be sent or R2 responds non-2xx.
    #[tracing::instrument(name = "r2.list_keys", skip(self), fields(r2.prefix = %prefix), err)]
    pub async fn list_keys(&self, prefix: &str) -> Result<Vec<String>> {
        let mut keys = Vec::new();
        let mut continuation: Option<String> = None;
        loop {
            // The canonical query string is the params sorted by name, each name and
            // value URI-encoded (slashes included). `list-type` sorts before `prefix`
            // and (when present) `continuation-token` sorts before both.
            let mut params: Vec<(String, String)> =
                vec![("list-type".to_string(), "2".to_string())];
            if let Some(token) = &continuation {
                params.push(("continuation-token".to_string(), token.clone()));
            }
            params.push(("prefix".to_string(), prefix.to_string()));
            params.sort_by(|a, b| a.0.cmp(&b.0));
            let canonical_query = params
                .iter()
                .map(|(k, v)| format!("{}={}", uri_encode(k, true), uri_encode(v, true)))
                .collect::<Vec<_>>()
                .join("&");

            let body = self.list_page(&canonical_query).await?;
            for key in parse_list_keys(&body) {
                keys.push(key);
            }
            match parse_next_continuation_token(&body) {
                Some(token) => continuation = Some(token),
                None => break,
            }
        }
        Ok(keys)
    }

    /// Fetch one `ListObjectsV2` page for a pre-built canonical query string, signed
    /// with SigV4, returning the XML response body.
    async fn list_page(&self, canonical_query: &str) -> Result<String> {
        let now = OffsetDateTime::now_utc();
        let amz_date = now
            .format(AMZ_DATE)
            .map_err(|e| Error::R2(format!("formatting amz-date: {e}")))?;
        let scope_date = now
            .format(SCOPE_DATE)
            .map_err(|e| Error::R2(format!("formatting scope-date: {e}")))?;

        let endpoint = url::trim_scheme(&self.config.endpoint);
        let host = endpoint.host.clone();
        let canonical_uri = format!("/{}", uri_encode(&self.config.bucket, false));

        // An empty-body GET: the payload hash is the hash of the empty string.
        let payload_hash = hex::encode(Sha256::digest(b""));
        let signed_headers = "host;x-amz-content-sha256;x-amz-date";
        let canonical_headers =
            format!("host:{host}\nx-amz-content-sha256:{payload_hash}\nx-amz-date:{amz_date}\n");
        let canonical_request = format!(
            "GET\n{canonical_uri}\n{canonical_query}\n{canonical_headers}\n{signed_headers}\n{payload_hash}"
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

        let url = format!(
            "{}{canonical_uri}?{canonical_query}",
            scheme_prefix(&self.config.endpoint)
        );
        let response = self
            .http
            .get(&url)
            .header("Host", host)
            .header("x-amz-date", amz_date)
            .header("x-amz-content-sha256", payload_hash)
            .header("Authorization", authorization)
            .send()
            .await
            .map_err(|e| Error::R2(format!("R2 LIST failed: {e}")))?;
        if !response.status().is_success() {
            let status = response.status();
            let detail = response.text().await.unwrap_or_default();
            return Err(Error::R2(format!("R2 LIST returned {status}: {detail}")));
        }
        response
            .text()
            .await
            .map_err(|e| Error::R2(format!("reading R2 LIST body: {e}")))
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

/// Extract every `<Key>…</Key>` value from a `ListObjectsV2` XML response body,
/// decoding the handful of XML entities S3 escapes keys with. The keys this bucket
/// holds are traversal-free ASCII paths, so this deliberately avoids pulling an XML
/// parser for what is a flat scan of one repeated element.
fn parse_list_keys(xml: &str) -> Vec<String> {
    let mut keys = Vec::new();
    let mut rest = xml;
    while let Some(open) = rest.find("<Key>") {
        let after = &rest[open + "<Key>".len()..];
        let Some(close) = after.find("</Key>") else {
            break;
        };
        keys.push(xml_unescape(&after[..close]));
        rest = &after[close + "</Key>".len()..];
    }
    keys
}

/// The `<NextContinuationToken>` of a truncated `ListObjectsV2` response, or `None`
/// when the listing is complete (`<IsTruncated>false</IsTruncated>` / absent token).
fn parse_next_continuation_token(xml: &str) -> Option<String> {
    let open = xml.find("<NextContinuationToken>")?;
    let after = &xml[open + "<NextContinuationToken>".len()..];
    let close = after.find("</NextContinuationToken>")?;
    let token = xml_unescape(&after[..close]);
    (!token.is_empty()).then_some(token)
}

/// Decode the five predefined XML entities in an element's text. `&amp;` is decoded
/// last so an escaped entity like `&amp;lt;` round-trips to the literal `&lt;` rather
/// than being double-unescaped to `<`.
fn xml_unescape(text: &str) -> String {
    text.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
}

/// Compute one HMAC-SHA256 in the signing chain.
fn hmac(key: &[u8], data: &[u8]) -> Result<Vec<u8>> {
    let mut mac =
        HmacSha256::new_from_slice(key).map_err(|e| Error::R2(format!("hmac key: {e}")))?;
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
