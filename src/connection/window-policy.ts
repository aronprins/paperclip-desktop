import type { ConnectionMode } from "./types";

export interface WindowPolicy {
  mode: ConnectionMode;
  startUrl: string;
  allowedOrigin: string;
  partition: string;
  preloadPath?: string;
}

export function isNavigationAllowed(targetUrl: string, allowedOrigin: string): boolean {
  try {
    const parsed = new URL(targetUrl);
    if (hasEmbeddedCredentials(parsed)) {
      return false;
    }

    return parsed.origin === allowedOrigin;
  } catch {
    return false;
  }
}

export function shouldOpenExternally(targetUrl: string, allowedOrigin: string): boolean {
  try {
    const parsed = new URL(targetUrl);
    if (hasEmbeddedCredentials(parsed)) {
      return false;
    }

    if (parsed.origin === allowedOrigin) {
      return false;
    }

    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export type NewWindowPolicyAction = "navigate-in-app" | "open-externally" | "deny";

export function newWindowPolicyAction(targetUrl: string, allowedOrigin: string): NewWindowPolicyAction {
  try {
    const parsed = new URL(targetUrl);
    if (hasEmbeddedCredentials(parsed)) {
      return "deny";
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "deny";
    }

    if (parsed.origin === allowedOrigin) {
      return "navigate-in-app";
    }

    return "open-externally";
  } catch {
    return "deny";
  }
}

function hasEmbeddedCredentials(parsed: URL): boolean {
  return parsed.username !== "" || parsed.password !== "";
}

export function remotePartitionForProfile(profileId: string): string {
  return `persist:paperclip-remote-${profileId}`;
}

export function localPartition(): string {
  return "persist:paperclip-local";
}
