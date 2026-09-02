// R2 (S3-compatible) access for the audio clip store, signed with AWS SigV4.
//
// The audio objects live in a PRIVATE R2 bucket (zero-egress, not publicly listable).
// Only four operations are needed, so — exactly like the backend's
// `crates/backend/src/r2.rs`, which this mirrors — we sign requests directly with
// SigV4 over `node:crypto` rather than pull in the AWS SDK:
//
//   - `putObject`      — the INGEST/PUBLISH side: a curator uploads a source clip
//                        (`sources/<clip-id>`) or a normalized rendition
//                        (`normalized/<clip-id>/<profile-id>.wav`); needs the
//                        write-scoped PUBLISH credentials.
//   - `headObject`     — the PUBLISH side again: cheaply answer "is this object
//                        already there, and how big is it" before re-uploading.
//   - `getObject`      — the BUILD side: `scripts/stage-audio-image.mjs` downloads
//                        each object it bakes and verifies it against
//                        `objects.lock.json`; needs only the read-scoped PRESIGN
//                        credentials.
//   - `presignGetUrl`  — a short-lived anonymous GET URL, for the cases where the
//                        bytes must be fetched by something that cannot sign (a
//                        Docker `ADD`, a browser); no credential enters an image
//                        layer because the URL itself carries the signature.
//
// R2 is path-style (`{endpoint}/{bucket}/{key}`) and signs region `auto`.

import { createHash, createHmac } from "node:crypto";

const SERVICE = "s3";
const REGION = "auto"; // R2 ignores the region but SigV4 must sign a consistent one.

const sha256Hex = (bytes) => createHash("sha256").update(bytes).digest("hex");
const hmac = (key, data) => createHmac("sha256", key).update(data).digest();

/**
 * URI-encode per SigV4's rules (RFC 3986 unreserved set kept verbatim, everything
 * else percent-encoded). With `encodeSlash === false`, `/` is preserved so a
 * multi-segment object key keeps its separators in the canonical URI.
 */
function uriEncode(str, encodeSlash = true) {
  let out = "";
  for (const b of Buffer.from(str, "utf8")) {
    if (
      (b >= 0x41 && b <= 0x5a) || // A-Z
      (b >= 0x61 && b <= 0x7a) || // a-z
      (b >= 0x30 && b <= 0x39) || // 0-9
      b === 0x2d || // -
      b === 0x2e || // .
      b === 0x5f || // _
      b === 0x7e // ~
    ) {
      out += String.fromCharCode(b);
    } else if (b === 0x2f && !encodeSlash) {
      out += "/";
    } else {
      out += "%" + b.toString(16).toUpperCase().padStart(2, "0");
    }
  }
  return out;
}

/** SigV4 timestamps: `{ amzDate: YYYYMMDDTHHMMSSZ, scopeDate: YYYYMMDD }` (UTC). */
function amzDates(now = new Date()) {
  const amzDate = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  return { amzDate, scopeDate: amzDate.slice(0, 8) };
}

/** The SigV4 signing-key chain: HMAC(date) → region → service → aws4_request. */
function signingKey(secret, scopeDate) {
  const kDate = hmac(`AWS4${secret}`, scopeDate);
  const kRegion = hmac(kDate, REGION);
  const kService = hmac(kRegion, SERVICE);
  return hmac(kService, "aws4_request");
}

/** Host of an endpoint origin (e.g. `acct.r2.cloudflarestorage.com`). */
function hostOf(endpoint) {
  return new URL(endpoint).host;
}

/** sha256 of the empty payload — the body hash every GET/HEAD signs. */
const EMPTY_SHA256 = sha256Hex(Buffer.alloc(0));

/**
 * Sign one header-signed request against `{endpoint}/{bucket}/{key}` and return the
 * `{ url, headers }` to hand to `fetch`. The signed header set is always
 * `host;x-amz-content-sha256;x-amz-date`, so the same signer serves PUT (payload
 * hashed) and GET/HEAD (empty payload).
 */
function signRequest({
  method,
  endpoint,
  accessKeyId,
  secretAccessKey,
  bucket,
  key,
  payloadHash,
}) {
  const host = hostOf(endpoint);
  const { amzDate, scopeDate } = amzDates();
  const canonicalUri = `/${uriEncode(bucket, false)}/${uriEncode(key, false)}`;

  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const canonicalRequest = `${method}\n${canonicalUri}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

  const scope = `${scopeDate}/${REGION}/${SERVICE}/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256Hex(Buffer.from(canonicalRequest))}`;
  const signature = hmac(
    signingKey(secretAccessKey, scopeDate),
    stringToSign,
  ).toString("hex");

  return {
    url: `${endpoint.replace(/\/+$/, "")}${canonicalUri}`,
    headers: {
      // undici derives Host from the URL (matching what we signed) even if it
      // ignores an explicit Host header, so the signature stays valid either way.
      "x-amz-date": amzDate,
      "x-amz-content-sha256": payloadHash,
      Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}

/**
 * Upload one object: `PUT {endpoint}/{bucket}/{key}` with `body`, signed SigV4
 * single-chunk payload-signed. Throws on a non-2xx response.
 */
export async function putObject({
  endpoint,
  accessKeyId,
  secretAccessKey,
  bucket,
  key,
  body,
  contentType = "application/octet-stream",
}) {
  const { url, headers } = signRequest({
    method: "PUT",
    endpoint,
    accessKeyId,
    secretAccessKey,
    bucket,
    key,
    payloadHash: sha256Hex(body),
  });
  const res = await fetch(url, {
    method: "PUT",
    headers: { ...headers, "Content-Type": contentType },
    body,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `R2 PUT ${key} -> HTTP ${res.status} ${res.statusText}: ${detail}`,
    );
  }
}

/**
 * Download one object: `GET {endpoint}/{bucket}/{key}`, signed SigV4. Returns the
 * body as a `Buffer`. A missing object throws an error that names the bucket and key
 * and says what to do about it, because that is the failure a build hits when a clip
 * was never ingested.
 */
export async function getObject({
  endpoint,
  accessKeyId,
  secretAccessKey,
  bucket,
  key,
}) {
  const { url, headers } = signRequest({
    method: "GET",
    endpoint,
    accessKeyId,
    secretAccessKey,
    bucket,
    key,
    payloadHash: EMPTY_SHA256,
  });
  const res = await fetch(url, { method: "GET", headers });
  if (res.status === 404) {
    throw new Error(
      `R2 GET ${key} -> not found in bucket ${bucket} (HTTP 404): the object was never published — ingest the clip before building`,
    );
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `R2 GET ${key} -> HTTP ${res.status} ${res.statusText}: ${detail}`,
    );
  }
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Probe one object: `HEAD {endpoint}/{bucket}/{key}`, signed SigV4. Returns
 * `{ bytes, etag }` when it exists and `null` when it does not, so a publish step can
 * skip an object already in the store. `bytes` is `null` if the response carried no
 * `content-length`; `etag` has its quotes stripped.
 */
export async function headObject({
  endpoint,
  accessKeyId,
  secretAccessKey,
  bucket,
  key,
}) {
  const { url, headers } = signRequest({
    method: "HEAD",
    endpoint,
    accessKeyId,
    secretAccessKey,
    bucket,
    key,
    payloadHash: EMPTY_SHA256,
  });
  const res = await fetch(url, { method: "HEAD", headers });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`R2 HEAD ${key} -> HTTP ${res.status} ${res.statusText}`);
  }
  const len = res.headers.get("content-length");
  return {
    bytes: len === null ? null : Number.parseInt(len, 10),
    etag: (res.headers.get("etag") ?? "").replace(/^"|"$/g, ""),
  };
}

/**
 * Presign a `GET {endpoint}/{bucket}/{key}` URL valid for `expiresIn` seconds
 * (query-string SigV4, `UNSIGNED-PAYLOAD`). The returned URL needs no credential to
 * fetch, so it is safe to hand to Docker's `ADD`. Max lifetime is 7 days; a build
 * only needs minutes, so the default is one hour.
 */
export function presignGetUrl({
  endpoint,
  accessKeyId,
  secretAccessKey,
  bucket,
  key,
  expiresIn = 3600,
}) {
  const host = hostOf(endpoint);
  const { amzDate, scopeDate } = amzDates();
  const scope = `${scopeDate}/${REGION}/${SERVICE}/aws4_request`;

  const params = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${accessKeyId}/${scope}`],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(expiresIn)],
    ["X-Amz-SignedHeaders", "host"],
  ];
  const canonicalQuery = params
    .map(([k, v]) => [uriEncode(k, true), uriEncode(v, true)])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const canonicalUri = `/${uriEncode(bucket, false)}/${uriEncode(key, false)}`;
  const canonicalRequest = `GET\n${canonicalUri}\n${canonicalQuery}\nhost:${host}\n\nhost\nUNSIGNED-PAYLOAD`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256Hex(Buffer.from(canonicalRequest))}`;
  const signature = hmac(
    signingKey(secretAccessKey, scopeDate),
    stringToSign,
  ).toString("hex");

  return `${endpoint.replace(/\/+$/, "")}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

/**
 * Resolve R2 connection config for a role from the environment. `role` is
 * `"publish"` (write) or `"presign"` (read); each has its own bucket-scoped key
 * pair so a read-only credential can live on CI and dev machines while the writer
 * stays local. The endpoint origin comes from `CLOUDFLARE_AUDIO_R2_S3_URL` (its
 * host, ignoring any bucket path) or is derived from `CLOUDFLARE_ACCOUNT_ID`.
 */
export function r2ConfigFromEnv(role) {
  const env = process.env;
  const prefix =
    role === "publish"
      ? "CLOUDFLARE_AUDIO_R2_PUBLISH"
      : "CLOUDFLARE_AUDIO_R2_PRESIGN";

  const accessKeyId = env[`${prefix}_ACCESS_KEY_ID`];
  const secretAccessKey = env[`${prefix}_SECRET_ACCESS_KEY`];
  const bucket = env.CLOUDFLARE_AUDIO_R2_BUCKET;

  let endpoint;
  if (env.CLOUDFLARE_AUDIO_R2_S3_URL) {
    const u = new URL(env.CLOUDFLARE_AUDIO_R2_S3_URL);
    endpoint = `${u.protocol}//${u.host}`;
  } else if (env.CLOUDFLARE_ACCOUNT_ID) {
    endpoint = `https://${env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  }

  const missing = [];
  if (!accessKeyId) missing.push(`${prefix}_ACCESS_KEY_ID`);
  if (!secretAccessKey) missing.push(`${prefix}_SECRET_ACCESS_KEY`);
  if (!bucket) missing.push("CLOUDFLARE_AUDIO_R2_BUCKET");
  if (!endpoint)
    missing.push("CLOUDFLARE_AUDIO_R2_S3_URL or CLOUDFLARE_ACCOUNT_ID");
  if (missing.length > 0) {
    throw new Error(`missing R2 ${role} env: ${missing.join(", ")}`);
  }

  return { endpoint, accessKeyId, secretAccessKey, bucket };
}
