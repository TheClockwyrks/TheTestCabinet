//! R2 access over the S3-compatible API with AWS SigV4 signing.
//!
//! The artifacts service is the object-store writer, so the client is its own.
//! In the service it is the R2 [public store](crate::public): the public
//! dataset's documents and media are written through it, read back as streams,
//! and probed for existence. Two callers outside the service still write R2
//! directly through it, an interim edge that ends once the backend's dataset
//! writes and the CLI's reference uploads go through the service's API:
//!
//! - The **backend** writes the public snapshot bucket on every refresh, and
//!   lists it to skip re-uploading content-stable media.
//! - **`tcab publish-reference`** writes an asset-generation case's reference
//!   sheet into that same bucket under `media/references/…`. An asset reference
//!   is regenerated from its committed script rather than committed as bytes, so
//!   there is nothing in the backend's git checkout for it to publish — the
//!   publishing side must upload directly.
//!
//! The verbs are `PutObject` (or a multipart upload for an object larger than
//! one [piece](crate::object::PIECE_SIZE)), `GetObject`, `HeadObject`,
//! `ListObjectsV2` and `DeleteObjects`, so rather than pull the full AWS SDK this
//! module signs requests directly with SigV4 over `hmac`/`sha2` and sends them
//! with the already-vendored `reqwest`. Every request carries the SHA-256 of its
//! payload, which a write holds in memory one piece at a time.

use base64::Engine as _;
use bytes::Bytes;
use hmac::{Hmac, Mac};
use reqwest::Method;
use sha2::{Digest, Sha256};
use time::OffsetDateTime;
use time::format_description::FormatItem;
use time::macros::format_description;

use crate::object::{
    ByteRange, ObjectBody, ObjectProperties, ObjectStream, PIECE_SIZE, Pieces, first_pieces,
    properties_from_headers, response_body,
};

/// An R2 request failed: the object store could not be reached, or it rejected a
/// signed request. Carries the key or prefix
/// and the store's own explanation.
#[derive(Debug, thiserror::Error)]
#[error("the R2 object store: {0}")]
pub struct R2Error(pub String);

/// The result of an R2 request.
pub type Result<T, E = R2Error> = std::result::Result<T, E>;

type HmacSha256 = Hmac<Sha256>;

/// Credentials and addressing for the one R2 bucket the project writes.
///
/// Resolved from the same `TCAB_R2_*` environment for every caller, so the
/// backend's snapshot refresh and `tcab publish-reference` cannot drift onto
/// different buckets and leave the site pointing at objects that were never
/// written. Its `Debug` form leaves the secret out.
#[derive(Clone, PartialEq, Eq)]
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

impl std::fmt::Debug for R2Config {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("R2Config")
            .field("account_id", &self.account_id)
            .field("bucket", &self.bucket)
            .field("access_key_id", &self.access_key_id)
            .field("secret_access_key", &"<redacted>")
            .field("endpoint", &self.endpoint)
            .field("region", &self.region)
            .finish()
    }
}

impl R2Config {
    /// Resolve the R2 configuration from the environment, returning `None` when
    /// any of the four required variables is absent (the caller then disables
    /// whatever it would have used R2 for — a dev-only mode). When all four are
    /// present an endpoint is derived from the account id unless
    /// `TCAB_R2_ENDPOINT` overrides it.
    pub fn from_env() -> Option<Self> {
        Self::from_lookup(|key| std::env::var(key).ok())
    }

    /// [`Self::from_env`] over `lookup`, which answers a variable's value or
    /// `None` when it is unset. An empty value counts as unset.
    pub fn from_lookup(lookup: impl Fn(&str) -> Option<String>) -> Option<Self> {
        let nonempty = |key: &str| lookup(key).filter(|value| !value.is_empty());

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

/// The S3 service name SigV4 scopes against.
const SERVICE: &str = "s3";

/// The maximum number of keys one `DeleteObjects` request may carry. S3 caps the
/// batch at 1000 and R2 implements the same limit, so [`R2Client::delete_objects`]
/// chunks anything larger.
const DELETE_BATCH: usize = 1000;

/// The SHA-256 of an empty payload, the payload hash of every bodiless request.
const EMPTY_PAYLOAD_HASH: &str = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

/// A header a request is signed and sent with, name lower case.
type Header = (String, String);

/// One signed request, ready to send.
struct Signed {
    url: String,
    /// Every signed header plus `authorization`.
    headers: Vec<Header>,
}

/// An R2 client that reads and writes objects of one bucket.
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

    /// The bucket this client addresses.
    pub fn bucket(&self) -> &str {
        &self.config.bucket
    }

    /// Upload one object: `PUT {endpoint}/{bucket}/{key}` with `body` under the given
    /// [labels](test_cabinet_suites::content_labels::ContentLabels), signed with SigV4. Returns an
    /// error when the request cannot be sent or R2 responds with a non-2xx status.
    ///
    /// The labels are stored on the object and returned on every read of it, so an
    /// object whose body is framed — a `.json.gz` recording — is served to a browser
    /// as the JSON it is, with the gzip declared as the framing.
    #[tracing::instrument(
        name = "r2.put_object",
        skip(self, body),
        fields(r2.key = %key, r2.bytes = body.len()),
        err,
    )]
    pub async fn put_object(
        &self,
        key: &str,
        body: Vec<u8>,
        content_type: &str,
        content_encoding: Option<&str>,
    ) -> Result<()> {
        self.put_bytes(key, Bytes::from(body), content_type, content_encoding)
            .await
    }

    /// Write a streamed `body` as object `key`, holding at most one
    /// [piece](PIECE_SIZE) of it: a body of one piece or less in one
    /// `PutObject`, a larger one as a multipart upload of equal parts completed
    /// whole (and aborted if any part fails, so no orphaned parts are left).
    /// Returns the number of bytes written.
    #[tracing::instrument(name = "r2.upload", skip(self, body), fields(r2.key = %key), err)]
    pub async fn upload(
        &self,
        key: &str,
        body: ObjectBody,
        content_type: &str,
        content_encoding: Option<&str>,
    ) -> Result<u64> {
        let body_error = |e: std::io::Error| R2Error(format!("reading the body for `{key}`: {e}"));
        match first_pieces(body, PIECE_SIZE).await.map_err(body_error)? {
            Pieces::Single(bytes) => {
                let length = bytes.len() as u64;
                self.put_bytes(key, bytes, content_type, content_encoding)
                    .await?;
                Ok(length)
            }
            Pieces::Staged {
                first,
                second,
                rest,
            } => {
                let upload_id = self
                    .create_multipart(key, content_type, content_encoding)
                    .await?;
                match self
                    .upload_parts(key, &upload_id, first, second, rest)
                    .await
                {
                    Ok(length) => Ok(length),
                    Err(error) => {
                        if let Err(abort) = self.abort_multipart(key, &upload_id).await {
                            tracing::warn!(error = %abort, key, "aborting a failed multipart upload");
                        }
                        Err(error)
                    }
                }
            }
        }
    }

    /// Read object `key`, or `range` of it, as a stream. `Ok(None)` when there is
    /// no such object. The body is relayed as stored, still in its content
    /// encoding.
    #[tracing::instrument(name = "r2.get_object", skip(self), fields(r2.key = %key), err)]
    pub async fn get_object(
        &self,
        key: &str,
        range: Option<ByteRange>,
    ) -> Result<Option<ObjectStream>> {
        let headers = range
            .map(|range| vec![("range".to_string(), range.header_value())])
            .unwrap_or_default();
        let response = self
            .execute(
                Method::GET,
                Some(key),
                &[],
                headers,
                Vec::new(),
                EMPTY_PAYLOAD_HASH,
                None,
            )
            .await?;
        match response.status().as_u16() {
            200 | 206 => Ok(Some(ObjectStream {
                properties: properties_from_headers(response.headers()),
                body: response_body(response),
            })),
            404 => Ok(None),
            _ => Err(status_error("GET", key, response).await),
        }
    }

    /// Read object `key`'s properties (`HeadObject`), `Ok(None)` when there is no
    /// such object.
    #[tracing::instrument(name = "r2.head_object", skip(self), fields(r2.key = %key), err)]
    pub async fn head_object(&self, key: &str) -> Result<Option<ObjectProperties>> {
        let response = self
            .execute(
                Method::HEAD,
                Some(key),
                &[],
                Vec::new(),
                Vec::new(),
                EMPTY_PAYLOAD_HASH,
                None,
            )
            .await?;
        match response.status().as_u16() {
            200 => Ok(Some(properties_from_headers(response.headers()))),
            404 => Ok(None),
            _ => Err(status_error("HEAD", key, response).await),
        }
    }

    /// List every object key under `prefix`, following the bucket's pagination to
    /// completion. `GET {endpoint}/{bucket}?list-type=2&prefix=…`, signed with SigV4.
    ///
    /// Two callers rely on it. The backend's snapshot refresh learns which
    /// content-stable media objects (`media/runs/<id>/…`) are already uploaded, so it
    /// references them without re-reading or re-uploading their bytes. Ingest lists
    /// [`REFERENCE_MEDIA_PREFIX`](test_cabinet_contracts::asset_reference::REFERENCE_MEDIA_PREFIX) to discover which
    /// asset-generation references have been published, which is why those need no
    /// committed lockfile.
    ///
    /// Returns an error when a request cannot be sent or R2 responds non-2xx.
    #[tracing::instrument(name = "r2.list_keys", skip(self), fields(r2.prefix = %prefix), err)]
    pub async fn list_keys(&self, prefix: &str) -> Result<Vec<String>> {
        let mut keys = Vec::new();
        let mut continuation: Option<String> = None;
        loop {
            let mut query = vec![
                ("list-type", "2".to_string()),
                ("prefix", prefix.to_string()),
            ];
            if let Some(token) = &continuation {
                query.push(("continuation-token", token.clone()));
            }
            let response = self
                .execute(
                    Method::GET,
                    None,
                    &query,
                    Vec::new(),
                    Vec::new(),
                    EMPTY_PAYLOAD_HASH,
                    None,
                )
                .await?;
            if !response.status().is_success() {
                return Err(status_error("LIST", prefix, response).await);
            }
            let body = response
                .text()
                .await
                .map_err(|e| R2Error(format!("reading the LIST body: {e}")))?;
            keys.extend(parse_list_keys(&body));
            match parse_next_continuation_token(&body) {
                Some(token) => continuation = Some(token),
                None => break,
            }
        }
        Ok(keys)
    }

    /// Delete every listed key, chunking into 1000-key
    /// `POST {endpoint}/{bucket}?delete` requests signed with SigV4 (the batch size
    /// S3 and R2 cap a single request at). Returns the number of keys deleted.
    ///
    /// The backend's snapshot refresh is the only caller: after the atomic
    /// `index.json` cut-over it prunes the snapshot generations nothing points at
    /// any more (see `crate::snapshot::stale_generation_keys` in the backend). Left
    /// unpruned the bucket grows without bound — every refresh writes a fresh
    /// generation and no earlier one is ever reachable again.
    ///
    /// A batch that R2 reports a per-key `<Error>` for fails the whole call: the
    /// caller treats pruning as best-effort and logs, so a partial delete simply
    /// leaves the remainder for the next refresh to retry.
    #[tracing::instrument(
        name = "r2.delete_objects",
        skip(self, keys),
        fields(r2.keys = keys.len()),
        err,
    )]
    pub async fn delete_objects(&self, keys: &[String]) -> Result<usize> {
        let mut deleted = 0;
        for chunk in keys.chunks(DELETE_BATCH) {
            self.delete_batch(chunk).await?;
            deleted += chunk.len();
        }
        Ok(deleted)
    }

    /// Delete one batch of at most [`DELETE_BATCH`] keys.
    ///
    /// Unlike the reads this signs a request *body*, and S3 additionally
    /// authenticates that body with a `Content-MD5` header which must itself be in
    /// `SignedHeaders`. `<Quiet>true</Quiet>` suppresses a success element per key,
    /// leaving a response body that is empty unless something failed.
    async fn delete_batch(&self, keys: &[String]) -> Result<()> {
        let mut body =
            String::from(r#"<?xml version="1.0" encoding="UTF-8"?><Delete><Quiet>true</Quiet>"#);
        for key in keys {
            body.push_str("<Object><Key>");
            body.push_str(&xml_escape(key));
            body.push_str("</Key></Object>");
        }
        body.push_str("</Delete>");
        let body = Bytes::from(body);
        let payload_hash = hex::encode(Sha256::digest(&body));
        let content_md5 = base64::engine::general_purpose::STANDARD.encode(md5::Md5::digest(&body));

        let response = self
            .execute(
                Method::POST,
                None,
                &[("delete", String::new())],
                vec![("content-md5".to_string(), content_md5)],
                vec![("content-type", "application/xml".to_string())],
                &payload_hash,
                Some(body),
            )
            .await?;
        if !response.status().is_success() {
            return Err(status_error("DELETE batch", "", response).await);
        }
        // A quiet-mode success body carries no elements; anything reported is a
        // per-key failure the caller must not mistake for a completed prune.
        let detail = response.text().await.unwrap_or_default();
        if let Some(failures) = parse_delete_errors(&detail) {
            return Err(R2Error(format!(
                "DELETE batch reported {failures} per-key error(s): {detail}"
            )));
        }
        Ok(())
    }

    /// One `PutObject` of a body held in memory, its SHA-256 signed.
    async fn put_bytes(
        &self,
        key: &str,
        body: Bytes,
        content_type: &str,
        content_encoding: Option<&str>,
    ) -> Result<()> {
        let payload_hash = hex::encode(Sha256::digest(&body));
        let response = self
            .execute(
                Method::PUT,
                Some(key),
                &[],
                Vec::new(),
                labels(content_type, content_encoding),
                &payload_hash,
                Some(body),
            )
            .await?;
        if !response.status().is_success() {
            return Err(status_error("PUT", key, response).await);
        }
        Ok(())
    }

    /// Begin a multipart upload of `key` (`CreateMultipartUpload`), whose labels
    /// the completed object carries. Returns the upload id.
    async fn create_multipart(
        &self,
        key: &str,
        content_type: &str,
        content_encoding: Option<&str>,
    ) -> Result<String> {
        let response = self
            .execute(
                Method::POST,
                Some(key),
                &[("uploads", String::new())],
                Vec::new(),
                labels(content_type, content_encoding),
                EMPTY_PAYLOAD_HASH,
                None,
            )
            .await?;
        if !response.status().is_success() {
            return Err(status_error("CreateMultipartUpload", key, response).await);
        }
        let body = response
            .text()
            .await
            .map_err(|e| R2Error(format!("reading the CreateMultipartUpload body: {e}")))?;
        xml_element(&body, "UploadId")
            .filter(|id| !id.is_empty())
            .ok_or_else(|| R2Error(format!("CreateMultipartUpload `{key}` named no upload id")))
    }

    /// Upload every part of a staged body and complete the upload. Every part
    /// but the last is one [piece](PIECE_SIZE), as R2 requires equal parts.
    async fn upload_parts(
        &self,
        key: &str,
        upload_id: &str,
        first: Bytes,
        second: Bytes,
        mut rest: crate::object::Chunker,
    ) -> Result<u64> {
        let mut etags = Vec::new();
        let mut length = 0u64;
        let mut next = Some(first);
        let mut queued = Some(second);
        while let Some(piece) = next {
            length += piece.len() as u64;
            let part_number = etags.len() + 1;
            etags.push(self.upload_part(key, upload_id, part_number, piece).await?);
            next = match queued.take() {
                Some(piece) => Some(piece),
                None => rest
                    .next_piece()
                    .await
                    .map_err(|e| R2Error(format!("reading the body for `{key}`: {e}")))?,
            };
        }
        self.complete_multipart(key, upload_id, &etags).await?;
        Ok(length)
    }

    /// Upload part `part_number` (from 1) of a multipart upload, returning the
    /// part's `ETag`, which the completion names it by.
    async fn upload_part(
        &self,
        key: &str,
        upload_id: &str,
        part_number: usize,
        body: Bytes,
    ) -> Result<String> {
        let payload_hash = hex::encode(Sha256::digest(&body));
        let query = [
            ("partNumber", part_number.to_string()),
            ("uploadId", upload_id.to_string()),
        ];
        let response = self
            .execute(
                Method::PUT,
                Some(key),
                &query,
                Vec::new(),
                Vec::new(),
                &payload_hash,
                Some(body),
            )
            .await?;
        if !response.status().is_success() {
            return Err(status_error("UploadPart", key, response).await);
        }
        response
            .headers()
            .get("etag")
            .and_then(|value| value.to_str().ok())
            .map(str::to_string)
            .ok_or_else(|| R2Error(format!("UploadPart {part_number} of `{key}` named no ETag")))
    }

    /// Complete a multipart upload from its parts' `ETag`s, in order. S3 may
    /// answer `200` with an `<Error>` body, which is a failure.
    async fn complete_multipart(&self, key: &str, upload_id: &str, etags: &[String]) -> Result<()> {
        let mut body = String::from("<CompleteMultipartUpload>");
        for (index, etag) in etags.iter().enumerate() {
            body.push_str(&format!(
                "<Part><PartNumber>{}</PartNumber><ETag>{}</ETag></Part>",
                index + 1,
                xml_escape(etag)
            ));
        }
        body.push_str("</CompleteMultipartUpload>");
        let body = Bytes::from(body);
        let payload_hash = hex::encode(Sha256::digest(&body));
        let response = self
            .execute(
                Method::POST,
                Some(key),
                &[("uploadId", upload_id.to_string())],
                Vec::new(),
                vec![("content-type", "application/xml".to_string())],
                &payload_hash,
                Some(body),
            )
            .await?;
        if !response.status().is_success() {
            return Err(status_error("CompleteMultipartUpload", key, response).await);
        }
        let detail = response.text().await.unwrap_or_default();
        if detail.contains("<Error>") {
            return Err(R2Error(format!(
                "CompleteMultipartUpload `{key}` failed: {detail}"
            )));
        }
        Ok(())
    }

    /// Abort a multipart upload, discarding its uploaded parts.
    async fn abort_multipart(&self, key: &str, upload_id: &str) -> Result<()> {
        let response = self
            .execute(
                Method::DELETE,
                Some(key),
                &[("uploadId", upload_id.to_string())],
                Vec::new(),
                Vec::new(),
                EMPTY_PAYLOAD_HASH,
                None,
            )
            .await?;
        if !response.status().is_success() {
            return Err(status_error("AbortMultipartUpload", key, response).await);
        }
        Ok(())
    }

    /// Sign and send one request against the bucket, or against object `key` in
    /// it. `signed` headers join the signature; `unsigned` ones (the content
    /// labels a write stores) are sent beside it.
    #[allow(clippy::too_many_arguments)]
    async fn execute(
        &self,
        method: Method,
        key: Option<&str>,
        query: &[(&str, String)],
        signed: Vec<Header>,
        unsigned: Vec<(&'static str, String)>,
        payload_hash: &str,
        body: Option<Bytes>,
    ) -> Result<reqwest::Response> {
        let signed = self.sign_request(
            method.as_str(),
            key,
            query,
            signed,
            payload_hash,
            OffsetDateTime::now_utc(),
        )?;

        // The current span's W3C trace context joins the request to the caller's
        // trace. It is not signed, so R2 ignores it; a no-op when telemetry is off.
        let mut trace_headers = http::HeaderMap::new();
        test_cabinet_telemetry::propagation::inject_current_context(&mut trace_headers);

        let mut request = self.http.request(method.clone(), &signed.url);
        for (name, value) in &signed.headers {
            request = request.header(name.as_str(), value.as_str());
        }
        for (name, value) in unsigned {
            request = request.header(name, value);
        }
        request = request.headers(trace_headers);
        if let Some(body) = body {
            request = request.body(body);
        } else if method == Method::PUT || method == Method::POST {
            request = request.header("content-length", "0");
        }
        request.send().await.map_err(|e| {
            R2Error(format!(
                "{method} `{}` failed: {e}",
                key.unwrap_or(&self.config.bucket)
            ))
        })
    }

    /// Sign a request with SigV4 at `now`, answering its URL and headers.
    fn sign_request(
        &self,
        method: &str,
        key: Option<&str>,
        query: &[(&str, String)],
        mut headers: Vec<Header>,
        payload_hash: &str,
        now: OffsetDateTime,
    ) -> Result<Signed> {
        let amz_date = now
            .format(AMZ_DATE)
            .map_err(|e| R2Error(format!("formatting amz-date: {e}")))?;
        // The canonical URI is `/{bucket}/{key}`, each path segment URI-encoded
        // (S3 does not encode the `/` separators). The host comes from the
        // endpoint so the `Host` header and signature agree.
        let host = url::trim_scheme(&self.config.endpoint).host;
        let mut canonical_uri = format!("/{}", uri_encode(&self.config.bucket, false));
        if let Some(key) = key {
            canonical_uri.push('/');
            canonical_uri.push_str(&encode_key(key));
        }
        let canonical_query = canonical_query(query);

        headers.push(("host".to_string(), host));
        headers.push(("x-amz-content-sha256".to_string(), payload_hash.to_string()));
        headers.push(("x-amz-date".to_string(), amz_date.clone()));
        headers.sort();
        let (canonical, signed_headers) = canonical_request(
            method,
            &canonical_uri,
            &canonical_query,
            &headers,
            payload_hash,
        );
        let (credential_scope, signature) = sign_v4(
            &self.config.secret_access_key,
            &self.config.region,
            &amz_date,
            &canonical,
        )?;
        headers.push((
            "authorization".to_string(),
            format!(
                "AWS4-HMAC-SHA256 Credential={}/{credential_scope}, SignedHeaders={signed_headers}, Signature={signature}",
                self.config.access_key_id
            ),
        ));

        let mut url = format!("{}{canonical_uri}", scheme_prefix(&self.config.endpoint));
        if !canonical_query.is_empty() {
            url.push('?');
            url.push_str(&canonical_query);
        }
        Ok(Signed { url, headers })
    }
}

/// The unsigned content-label headers a write stores on its object.
fn labels(content_type: &str, content_encoding: Option<&str>) -> Vec<(&'static str, String)> {
    let mut headers = vec![("content-type", content_type.to_string())];
    if let Some(encoding) = content_encoding {
        headers.push(("content-encoding", encoding.to_string()));
    }
    headers
}

/// The SigV4 canonical query string: every parameter's name and value
/// URI-encoded (slashes included), sorted by encoded name then value. A
/// valueless subresource is `name=`.
fn canonical_query(query: &[(&str, String)]) -> String {
    let mut pairs: Vec<(String, String)> = query
        .iter()
        .map(|(name, value)| (uri_encode(name, true), uri_encode(value, true)))
        .collect();
    pairs.sort();
    pairs
        .iter()
        .map(|(name, value)| format!("{name}={value}"))
        .collect::<Vec<_>>()
        .join("&")
}

/// The SigV4 canonical request over `headers` (names lower case, sorted), and
/// its `SignedHeaders` list.
fn canonical_request(
    method: &str,
    canonical_uri: &str,
    canonical_query: &str,
    headers: &[Header],
    payload_hash: &str,
) -> (String, String) {
    let canonical_headers: String = headers
        .iter()
        .map(|(name, value)| format!("{name}:{}\n", value.trim()))
        .collect();
    let signed_headers = headers
        .iter()
        .map(|(name, _)| name.as_str())
        .collect::<Vec<_>>()
        .join(";");
    (
        format!(
            "{method}\n{canonical_uri}\n{canonical_query}\n{canonical_headers}\n{signed_headers}\n{payload_hash}"
        ),
        signed_headers,
    )
}

/// Sign a canonical request at `amz_date` (`YYYYMMDDTHHMMSSZ`): the credential
/// scope and the hex signature.
fn sign_v4(
    secret_access_key: &str,
    region: &str,
    amz_date: &str,
    canonical_request: &str,
) -> Result<(String, String)> {
    let scope_date = amz_date.get(..8).unwrap_or(amz_date);
    let credential_scope = format!("{scope_date}/{region}/{SERVICE}/aws4_request");
    let string_to_sign = format!(
        "AWS4-HMAC-SHA256\n{amz_date}\n{credential_scope}\n{}",
        hex::encode(Sha256::digest(canonical_request.as_bytes()))
    );
    let k_date = hmac(
        format!("AWS4{secret_access_key}").as_bytes(),
        scope_date.as_bytes(),
    )?;
    let k_region = hmac(&k_date, region.as_bytes())?;
    let k_service = hmac(&k_region, SERVICE.as_bytes())?;
    let k_signing = hmac(&k_service, b"aws4_request")?;
    let signature = hmac(&k_signing, string_to_sign.as_bytes())?;
    Ok((credential_scope, hex::encode(signature)))
}

/// The error for a response whose status the request does not accept.
async fn status_error(operation: &str, target: &str, response: reqwest::Response) -> R2Error {
    let status = response.status();
    let detail = response.text().await.unwrap_or_default();
    R2Error(format!(
        "{operation} `{target}` returned {status}: {detail}"
    ))
}

/// The text of the first `<name>` element of an XML body.
fn xml_element(xml: &str, name: &str) -> Option<String> {
    let open = format!("<{name}>");
    let close = format!("</{name}>");
    let after = &xml[xml.find(&open)? + open.len()..];
    Some(xml_unescape(&after[..after.find(&close)?]))
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

/// The number of `<Error>` elements in a `DeleteObjects` response, or `None` when
/// the batch fully succeeded. In quiet mode a clean delete reports nothing at all,
/// so any `<Error>` present means some keys survived.
fn parse_delete_errors(xml: &str) -> Option<usize> {
    let count = xml.matches("<Error>").count();
    (count > 0).then_some(count)
}

/// Escape an object key for inclusion in a `DeleteObjects` request body. `&` is
/// escaped first so the ampersands introduced by the later replacements are not
/// double-escaped. The inverse of [`xml_unescape`].
fn xml_escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
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
    let mut mac = HmacSha256::new_from_slice(key).map_err(|e| R2Error(format!("hmac key: {e}")))?;
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

#[cfg(test)]
#[path = "r2.stub.test.rs"]
mod stub_tests;
