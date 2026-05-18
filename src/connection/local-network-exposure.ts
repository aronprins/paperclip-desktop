import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const LOCAL_NETWORK_AUTH_SECRET_FILE_NAME = "paperclip-lan-auth-secret";

export interface LocalNetworkExposureConfig {
  env: Record<string, string>;
  primaryUrl: string;
  allowedHostnames: string[];
  addresses: string[];
}

type NetworkInterfaceMap = ReturnType<typeof os.networkInterfaces>;

export function listLocalNetworkIpv4Addresses(
  interfaces: NetworkInterfaceMap = os.networkInterfaces(),
): string[] {
  const addresses: string[] = [];

  for (const entries of Object.values(interfaces)) {
    if (!entries) continue;

    for (const entry of entries) {
      if (entry.internal || entry.family !== "IPv4" || !isUsableIpv4Address(entry.address)) {
        continue;
      }
      addresses.push(entry.address);
    }
  }

  return Array.from(new Set(addresses));
}

export function readOrCreateLocalNetworkAuthSecret(userDataPath: string): string {
  const secretPath = path.join(userDataPath, LOCAL_NETWORK_AUTH_SECRET_FILE_NAME);
  try {
    const existing = fs.readFileSync(secretPath, "utf8").trim();
    if (isStrongAuthSecret(existing)) {
      secureSecretFile(secretPath);
      return existing;
    }
  } catch {
    // create below
  }

  const secret = randomBytes(32).toString("base64url");
  fs.mkdirSync(path.dirname(secretPath), { recursive: true });
  fs.writeFileSync(secretPath, `${secret}\n`, { encoding: "utf8", mode: 0o600 });
  secureSecretFile(secretPath);
  return secret;
}

export function buildLocalNetworkExposureConfig(input: {
  port: number;
  authSecret: string;
  hostname?: string;
  interfaces?: NetworkInterfaceMap;
}): LocalNetworkExposureConfig {
  const addresses = listLocalNetworkIpv4Addresses(input.interfaces);
  if (addresses.length === 0) {
    throw new Error("No active IPv4 local network address was found.");
  }

  const hostname = normalizeHostname(input.hostname ?? os.hostname());
  const allowedHostnames = uniqueStrings([
    ...addresses,
    ...(isSafeLocalHostname(hostname) ? [hostname] : []),
    "localhost",
    "127.0.0.1",
  ]);

  const authPublicBaseUrl = `http://${addresses[0]}:${input.port}`;
  const authSecret = input.authSecret.trim();

  if (!isStrongAuthSecret(authSecret)) {
    throw new Error("Local network mode requires an auth secret.");
  }

  return {
    primaryUrl: authPublicBaseUrl,
    addresses,
    allowedHostnames,
    env: {
      PAPERCLIP_DEPLOYMENT_MODE: "authenticated",
      PAPERCLIP_DEPLOYMENT_EXPOSURE: "private",
      PAPERCLIP_BIND: "lan",
      PAPERCLIP_ALLOWED_HOSTNAMES: allowedHostnames.join(","),
      PAPERCLIP_AUTH_PUBLIC_BASE_URL: authPublicBaseUrl,
      PAPERCLIP_PUBLIC_URL: authPublicBaseUrl,
      BETTER_AUTH_SECRET: authSecret,
    },
  };
}

function isUsableIpv4Address(address: string): boolean {
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  const [a, b] = parts;
  return (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isStrongAuthSecret(value: string): boolean {
  return value.length >= 32;
}

function secureSecretFile(secretPath: string): void {
  try {
    fs.chmodSync(secretPath, 0o600);
  } catch {
    // best effort on platforms that do not support chmod
  }
}

function normalizeHostname(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function isLoopbackHostname(value: string): boolean {
  return value === "localhost" || value === "127.0.0.1" || value === "::1";
}

function isSafeLocalHostname(value: string): boolean {
  if (!value || isLoopbackHostname(value)) {
    return false;
  }

  return (
    !value.includes(".") ||
    value.endsWith(".local") ||
    value.endsWith(".lan") ||
    value.endsWith(".home") ||
    value.endsWith(".internal")
  );
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}
