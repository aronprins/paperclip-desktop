export interface NormalizedRemoteUrl {
  input: string;
  normalizedUrl: string;
  origin: string;
  insecureTransport: boolean;
  warning?: string;
}

const PRIVATE_HOST_SUFFIXES = [".internal", ".local", ".lan", ".home", ".ts.net"];

export function normalizeRemoteUrl(input: string): NormalizedRemoteUrl {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Enter a valid remote URL.");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Enter a valid remote URL.");
  }

  const isHttp = parsed.protocol === "http:";
  const isHttps = parsed.protocol === "https:";
  if (!isHttp && !isHttps) {
    throw new Error("Remote URLs must use HTTP or HTTPS.");
  }

  if (parsed.username || parsed.password) {
    throw new Error("Remote URLs cannot include username or password.");
  }

  parsed.pathname = "/";
  parsed.search = "";
  parsed.hash = "";

  const normalizedUrl = parsed.toString();
  return {
    input: trimmed,
    normalizedUrl,
    origin: parsed.origin,
    insecureTransport: isHttp,
    warning: isHttp ? buildInsecureHttpWarning(parsed.hostname) : undefined,
  };
}

export function isPrivateHostname(hostname: string): boolean {
  const lower = normalizeHostname(hostname);

  if (lower === "localhost" || lower === "::1" || lower.endsWith(".localhost")) {
    return true;
  }

  if (PRIVATE_HOST_SUFFIXES.some((suffix) => lower.endsWith(suffix))) {
    return true;
  }

  if (isPrivateIpv4(lower) || isPrivateIpv6(lower)) {
    return true;
  }

  return false;
}
function isPrivateIpv4(hostname: string): boolean {
  const match = hostname.match(/^(\d{1,3})(?:\.(\d{1,3})){3}$/);
  if (!match) {
    return false;
  }

  const parts = hostname.split(".").map((part) => Number(part));
  if (parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return false;
  }

  const [a, b] = parts;
  return (
    a === 0 || // 0.0.0.0 routes to loopback on macOS/Linux
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

function isPrivateIpv6(hostname: string): boolean {
  let lower = normalizeHostname(hostname);
  // Only an IPv6 literal can be private here. Without this guard, hostnames like
  // "fcbarcelona.com" (startsWith "fc") would be misclassified as private.
  if (!lower.includes(":")) {
    return false;
  }
  // Unwrap IPv4-mapped IPv6 (::ffff:192.168.0.1) so the embedded v4 is classified.
  const mapped = lower.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) {
    return isPrivateIpv4(mapped[1]);
  }
  return (
    lower === "::1" ||
    lower.startsWith("fc") ||
    lower.startsWith("fd") ||
    lower.startsWith("fe80:")
  );
}

function normalizeHostname(hostname: string): string {
  const lower = hostname.toLowerCase();
  if (lower.startsWith("[") && lower.endsWith("]")) {
    return lower.slice(1, -1);
  }

  return lower;
}

function buildInsecureHttpWarning(hostname: string): string {
  const baseWarning =
    "Warning: this remote uses HTTP without TLS. Network traffic can be read or modified by anyone on the path.";

  if (isPrivateHostname(hostname)) {
    return `${baseWarning} Only continue if you trust the local or private network carrying this connection.`;
  }

  return `${baseWarning} This host is not on a recognized private network, so the risk is higher.`;
}
