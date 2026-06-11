import { normalizeRemoteUrl } from "./validate";
import type {
  BootstrapStatus,
  DeploymentExposure,
  DeploymentMode,
  RemotePreflightResult,
  SessionState,
} from "./types";

interface PreflightOptions {
  remoteUrl: string;
  fetchImpl?: typeof fetch;
  localServerVersion?: string | null;
  timeoutMs?: number;
}

interface HealthPayload {
  status?: unknown;
  version?: unknown;
  deploymentMode?: unknown;
  deploymentExposure?: unknown;
  authReady?: unknown;
  bootstrapStatus?: unknown;
  bootstrapInviteActive?: unknown;
}

interface ParsedHealthPayload {
  status: string;
  version: string | null;
  deploymentMode: DeploymentMode;
  deploymentExposure: DeploymentExposure | null;
  authReady: boolean | null;
  bootstrapStatus: BootstrapStatus | null;
  bootstrapInviteActive: boolean | null;
}

export async function preflightRemoteConnection(options: PreflightOptions): Promise<RemotePreflightResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 8_000;

  let normalized;
  try {
    normalized = normalizeRemoteUrl(options.remoteUrl);
  } catch (error) {
    return buildFailure({
      remoteUrl: options.remoteUrl,
      insecureTransport: false,
      reason: "invalid_url",
      detail: error instanceof Error ? error.message : "Enter a valid remote URL.",
    });
  }

  try {
    const healthResponse = await fetchJson(fetchImpl, new URL("/api/health", normalized.origin), timeoutMs);
    const health = healthResponse.status === 200 ? parseHealthPayload(healthResponse.body) : null;

    if (!health) {
      return buildFailure({
        remoteUrl: normalized.normalizedUrl,
        normalizedUrl: normalized.normalizedUrl,
        origin: normalized.origin,
        insecureTransport: normalized.insecureTransport,
        reason: "not_paperclip",
        detail: "This host does not appear to expose the Paperclip health endpoint.",
        warning: normalized.warning,
      });
    }

    if (health.status !== "ok") {
      return {
        ok: false,
        normalizedUrl: normalized.normalizedUrl,
        origin: normalized.origin,
        insecureTransport: normalized.insecureTransport,
        paperclipDetected: true,
        deploymentMode: health.deploymentMode,
        deploymentExposure: health.deploymentExposure,
        authReady: health.authReady,
        bootstrapStatus: health.bootstrapStatus,
        bootstrapInviteActive: health.bootstrapInviteActive,
        sessionState: "unknown",
        version: health.version,
        reason: "unreachable",
        detail: "Paperclip responded, but the instance is not healthy yet.",
        warning: buildVersionWarning(health.version, options.localServerVersion, normalized.warning),
      };
    }

    if (health.deploymentMode === "local_trusted") {
      return {
        ok: false,
        normalizedUrl: normalized.normalizedUrl,
        origin: normalized.origin,
        insecureTransport: normalized.insecureTransport,
        paperclipDetected: true,
        deploymentMode: health.deploymentMode,
        deploymentExposure: health.deploymentExposure,
        authReady: health.authReady,
        bootstrapStatus: health.bootstrapStatus,
        bootstrapInviteActive: health.bootstrapInviteActive,
        sessionState: "unknown",
        version: health.version,
        reason: "unsupported_local_trusted",
        detail:
          "This Paperclip server is configured for loopback-only local use. Reconfigure it to upstream authenticated mode before using Desktop remote mode.",
        warning: buildVersionWarning(health.version, options.localServerVersion, normalized.warning),
      };
    }

    if (health.deploymentMode !== "authenticated") {
      return {
        ok: false,
        normalizedUrl: normalized.normalizedUrl,
        origin: normalized.origin,
        insecureTransport: normalized.insecureTransport,
        paperclipDetected: true,
        deploymentMode: health.deploymentMode,
        deploymentExposure: health.deploymentExposure,
        authReady: health.authReady,
        bootstrapStatus: health.bootstrapStatus,
        bootstrapInviteActive: health.bootstrapInviteActive,
        sessionState: "unknown",
        version: health.version,
        reason: "not_paperclip",
        detail: "The remote did not report an authenticated Paperclip deployment.",
        warning: buildVersionWarning(health.version, options.localServerVersion, normalized.warning),
      };
    }

    if (health.authReady === false) {
      return {
        ok: false,
        normalizedUrl: normalized.normalizedUrl,
        origin: normalized.origin,
        insecureTransport: normalized.insecureTransport,
        paperclipDetected: true,
        deploymentMode: health.deploymentMode,
        deploymentExposure: health.deploymentExposure,
        authReady: health.authReady,
        bootstrapStatus: health.bootstrapStatus,
        bootstrapInviteActive: health.bootstrapInviteActive,
        sessionState: "unknown",
        version: health.version,
        reason: "auth_not_ready",
        detail: "The remote reports authenticated mode, but its auth subsystem is not ready.",
        warning: buildVersionWarning(health.version, options.localServerVersion, normalized.warning),
      };
    }

    const sessionResponse = await fetchSession(fetchImpl, new URL("/api/auth/get-session", normalized.origin), timeoutMs);
    if (sessionResponse.sessionState === "unknown") {
      return {
        ok: false,
        normalizedUrl: normalized.normalizedUrl,
        origin: normalized.origin,
        insecureTransport: normalized.insecureTransport,
        paperclipDetected: true,
        deploymentMode: health.deploymentMode,
        deploymentExposure: health.deploymentExposure,
        authReady: health.authReady,
        bootstrapStatus: health.bootstrapStatus,
        bootstrapInviteActive: health.bootstrapInviteActive,
        sessionState: "unknown",
        version: health.version,
        reason: "not_paperclip",
        detail: "The remote session probe returned an unexpected response.",
        warning: buildVersionWarning(health.version, options.localServerVersion, normalized.warning),
      };
    }

    return {
      ok: true,
      normalizedUrl: normalized.normalizedUrl,
      origin: normalized.origin,
      insecureTransport: normalized.insecureTransport,
      paperclipDetected: true,
      deploymentMode: health.deploymentMode,
      deploymentExposure: health.deploymentExposure,
      authReady: health.authReady,
      bootstrapStatus: health.bootstrapStatus,
      bootstrapInviteActive: health.bootstrapInviteActive,
      sessionState: sessionResponse.sessionState,
      version: health.version,
      warning: buildVersionWarning(health.version, options.localServerVersion, normalized.warning),
    };
  } catch (error) {
    return buildFailure({
      remoteUrl: normalized.normalizedUrl,
      normalizedUrl: normalized.normalizedUrl,
      origin: normalized.origin,
      insecureTransport: normalized.insecureTransport,
      reason: classifyFetchError(error),
      detail: error instanceof Error ? error.message : "Remote preflight failed.",
      warning: normalized.warning,
    });
  }
}

// Health payloads are tiny; cap the buffered body so a hostile remote can't OOM
// the main process by trickling a multi-GB "application/json" response.
const MAX_PREFLIGHT_BODY_BYTES = 256 * 1024;

interface BoundedJson {
  status: number;
  json: unknown;
  jsonError: boolean;
}

async function fetchJson(
  fetchImpl: typeof fetch,
  url: URL,
  timeoutMs: number,
): Promise<{ status: number; body: unknown }> {
  const result = await fetchBoundedJson(fetchImpl, url, timeoutMs);
  // A malformed/oversized JSON body is not a transport failure — surface it as a
  // non-Paperclip response (parseHealthPayload(null) → "not_paperclip") rather
  // than letting it throw and be misclassified as "unreachable".
  return { status: result.status, body: result.jsonError ? null : result.json };
}

async function fetchSession(
  fetchImpl: typeof fetch,
  url: URL,
  timeoutMs: number,
): Promise<{ sessionState: SessionState }> {
  const result = await fetchBoundedJson(fetchImpl, url, timeoutMs);
  if (result.jsonError) {
    return { sessionState: "unknown" };
  }

  const body = result.json;

  if (result.status === 401) {
    return isPaperclipAuthRequiredPayload(body)
      ? { sessionState: "signed_out" }
      : { sessionState: "unknown" };
  }

  if (result.status !== 200) {
    return { sessionState: "unknown" };
  }

  if (isPaperclipSessionPayload(body)) {
    return { sessionState: "signed_in" };
  }

  return { sessionState: "unknown" };
}

// Keeps the abort timer armed until the body is fully consumed (fetch resolves at
// headers-complete, so reading the body must stay under the same deadline) and
// enforces a hard size cap while reading.
async function fetchBoundedJson(fetchImpl: typeof fetch, url: URL, timeoutMs: number): Promise<BoundedJson> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { accept: "application/json" },
      redirect: "manual",
      signal: controller.signal,
    });

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) {
      await response.body?.cancel().catch(() => undefined);
      return { status: response.status, json: null, jsonError: false };
    }

    let text: string;
    try {
      text = await readBodyWithLimit(response, MAX_PREFLIGHT_BODY_BYTES);
    } catch {
      return { status: response.status, json: null, jsonError: true };
    }

    try {
      return { status: response.status, json: JSON.parse(text), jsonError: false };
    } catch {
      return { status: response.status, json: null, jsonError: true };
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function readBodyWithLimit(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) {
      throw new Error("Response body exceeds size limit");
    }
    return text;
  }

  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error(`Response body exceeds ${maxBytes} bytes`);
      }
      chunks.push(Buffer.from(value));
    }
  }

  return Buffer.concat(chunks).toString("utf8");
}

function parseHealthPayload(body: unknown): ParsedHealthPayload | null {
  if (!isObject(body)) {
    return null;
  }

  const deploymentMode =
    body.deploymentMode === "authenticated" || body.deploymentMode === "local_trusted"
      ? body.deploymentMode
      : null;
  const deploymentExposure =
    body.deploymentExposure === "private" || body.deploymentExposure === "public"
      ? body.deploymentExposure
      : null;
  const authReady = typeof body.authReady === "boolean" ? body.authReady : null;
  const bootstrapStatus =
    body.bootstrapStatus === "ready" || body.bootstrapStatus === "bootstrap_pending"
      ? body.bootstrapStatus
      : null;
  const bootstrapInviteActive =
    typeof body.bootstrapInviteActive === "boolean" ? body.bootstrapInviteActive : null;
  const status = typeof body.status === "string" ? body.status : null;
  const version = typeof body.version === "string" ? body.version : null;
  const hasFullHealthShape = deploymentExposure !== null && authReady !== null;
  const hasRedactedAuthenticatedShape =
    status === "ok" &&
    deploymentMode === "authenticated" &&
    bootstrapStatus !== null &&
    bootstrapInviteActive !== null &&
    deploymentExposure === null &&
    authReady === null;

  if (!status || !deploymentMode || (!hasFullHealthShape && !hasRedactedAuthenticatedShape)) {
    return null;
  }

  return {
    status,
    version,
    deploymentMode,
    deploymentExposure,
    authReady,
    bootstrapStatus,
    bootstrapInviteActive,
  };
}

function isPaperclipAuthRequiredPayload(body: unknown): boolean {
  return isObject(body) && body.error === "Board authentication required";
}

function isPaperclipSessionPayload(body: unknown): boolean {
  if (!isObject(body) || !isObject(body.session)) {
    return false;
  }

  return (
    typeof body.session.id === "string" &&
    body.session.id.startsWith("paperclip:") &&
    typeof body.session.userId === "string" &&
    body.session.userId.length > 0
  );
}

function buildFailure(input: {
  remoteUrl: string;
  normalizedUrl?: string;
  origin?: string;
  insecureTransport?: boolean;
  reason: RemotePreflightResult["reason"];
  detail: string;
  warning?: string;
}): RemotePreflightResult {
  return {
    ok: false,
    normalizedUrl: input.normalizedUrl ?? input.remoteUrl.trim(),
    origin: input.origin ?? "",
    insecureTransport: input.insecureTransport === true,
    paperclipDetected: false,
    deploymentMode: null,
    deploymentExposure: null,
    authReady: null,
    bootstrapStatus: null,
    bootstrapInviteActive: null,
    sessionState: "unknown",
    version: null,
    reason: input.reason,
    detail: input.detail,
    warning: input.warning,
  };
}

function classifyFetchError(error: unknown): RemotePreflightResult["reason"] {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (
      message.includes("self-signed") ||
      message.includes("certificate") ||
      message.includes("unable to verify") ||
      message.includes("tls")
    ) {
      return "tls_error";
    }

    if (message.includes("abort") || message.includes("timed out")) {
      return "unreachable";
    }
  }

  return "unreachable";
}

function buildVersionWarning(
  remoteVersion: string | null,
  localServerVersion: string | null | undefined,
  existingWarning?: string,
): string | undefined {
  const warnings = [existingWarning].filter(Boolean) as string[];

  if (remoteVersion && localServerVersion && remoteVersion !== localServerVersion) {
    warnings.push(
      `Remote Paperclip version ${remoteVersion} differs from the bundled desktop server version ${localServerVersion}.`,
    );
  }

  return warnings.length > 0 ? warnings.join(" ") : undefined;
}

function isObject(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
