import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { normalizeRemoteUrl } from "./validate";
import {
  CONNECTIONS_FILE_NAME,
  CONNECTIONS_FILE_VERSION,
  LOCAL_PROFILE_ID,
} from "./types";
import type {
  ConnectionHealth,
  ConnectionMode,
  ConnectionProfile,
  ConnectionState,
  PersistedConnectionsFile,
  RemotePreflightResult,
} from "./types";

export function getConnectionsFilePath(userDataPath: string): string {
  return path.join(userDataPath, CONNECTIONS_FILE_NAME);
}

export function createDefaultConnectionState(): ConnectionState {
  return {
    activeProfileId: null,
    alwaysShowChooser: true,
    autoConnectLastProfile: false,
    chooserMode: "local_embedded",
    localProfileName: "Local",
    localNetworkEnabled: false,
    localLastHealth: "healthy",
  };
}

export function createDefaultConnectionsFile(): PersistedConnectionsFile {
  return {
    version: CONNECTIONS_FILE_VERSION,
    state: createDefaultConnectionState(),
    remoteProfiles: [],
  };
}

export class ConnectionStore {
  readonly filePath: string;
  private cache: PersistedConnectionsFile;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.cache = readConnectionsFile(filePath);
  }

  getSnapshot(): PersistedConnectionsFile {
    return cloneData(this.cache);
  }

  listProfiles(): ConnectionProfile[] {
    return [toLocalProfile(this.cache.state), ...this.cache.remoteProfiles.map(cloneProfile)];
  }

  getProfile(profileId: string): ConnectionProfile | null {
    if (profileId === LOCAL_PROFILE_ID) {
      return toLocalProfile(this.cache.state);
    }

    const profile = this.cache.remoteProfiles.find((candidate) => candidate.id === profileId);
    return profile ? cloneProfile(profile) : null;
  }

  getStartupProfileId(): string | null {
    const { state } = this.cache;
    if (state.alwaysShowChooser || !state.autoConnectLastProfile) {
      return null;
    }

    if (state.activeProfileId === LOCAL_PROFILE_ID) {
      return LOCAL_PROFILE_ID;
    }

    return this.cache.remoteProfiles.some((profile) =>
      profile.id === state.activeProfileId
      && (!profile.remoteUrl?.startsWith("http://") || profile.allowInsecureHttp === true))
      ? state.activeProfileId
      : null;
  }

  saveRemoteProfile(input: {
    profileId?: string;
    name?: string;
    remoteUrl: string;
    allowInsecureHttp?: boolean;
    now?: string;
  }): ConnectionProfile {
    const now = input.now ?? new Date().toISOString();
    const normalized = normalizeRemoteUrl(input.remoteUrl);
    if (normalized.insecureTransport && input.allowInsecureHttp !== true) {
      throw new Error("HTTP remotes require confirming that you want to allow an insecure connection.");
    }
    const existingIndex = input.profileId
      ? this.cache.remoteProfiles.findIndex((profile) => profile.id === input.profileId)
      : -1;

    if (existingIndex >= 0) {
      const existing = this.cache.remoteProfiles[existingIndex];
      const updated: ConnectionProfile = {
        ...existing,
        name: sanitizeProfileName(input.name, normalized.origin),
        remoteUrl: normalized.normalizedUrl,
        allowInsecureHttp: normalized.insecureTransport ? true : undefined,
        updatedAt: now,
      };
      this.cache.remoteProfiles[existingIndex] = updated;
      this.persist();
      return cloneProfile(updated);
    }

    const profile: ConnectionProfile = {
      id: randomUUID(),
      name: sanitizeProfileName(input.name, normalized.origin),
      mode: "remote_existing",
      remoteUrl: normalized.normalizedUrl,
      allowInsecureHttp: normalized.insecureTransport ? true : undefined,
      createdAt: now,
      updatedAt: now,
      lastHealth: "unknown",
      lastDeploymentMode: null,
      lastSessionState: "unknown",
    };
    this.cache.remoteProfiles.push(profile);
    this.persist();
    return cloneProfile(profile);
  }

  duplicateRemoteProfile(profileId: string, now = new Date().toISOString()): ConnectionProfile {
    const existing = this.requireRemoteProfile(profileId);
    const duplicate: ConnectionProfile = {
      ...existing,
      id: randomUUID(),
      name: `${existing.name} (copy)`,
      allowInsecureHttp: existing.allowInsecureHttp,
      createdAt: now,
      updatedAt: now,
      lastConnectedAt: undefined,
    };
    this.cache.remoteProfiles.push(duplicate);
    this.persist();
    return cloneProfile(duplicate);
  }

  deleteRemoteProfile(profileId: string): void {
    const beforeLength = this.cache.remoteProfiles.length;
    this.cache.remoteProfiles = this.cache.remoteProfiles.filter((profile) => profile.id !== profileId);
    if (beforeLength === this.cache.remoteProfiles.length) {
      return;
    }

    if (this.cache.state.activeProfileId === profileId) {
      this.cache.state.activeProfileId = null;
    }
    this.persist();
  }

  setAlwaysShowChooser(value: boolean): void {
    this.cache.state.alwaysShowChooser = value;
    if (value) {
      this.cache.state.autoConnectLastProfile = false;
    }
    this.persist();
  }

  setChooserMode(mode: ConnectionMode): void {
    this.cache.state.chooserMode = mode;
    this.persist();
  }

  setLocalNetworkEnabled(value: boolean): void {
    this.cache.state.localNetworkEnabled = value;
    this.persist();
  }

  setRememberedProfile(profileId: string | null, rememberChoice: boolean): void {
    this.cache.state.activeProfileId = profileId;
    this.cache.state.autoConnectLastProfile = rememberChoice;
    this.cache.state.alwaysShowChooser = !rememberChoice;
    this.persist();
  }

  recordConnectionResult(profileId: string, result?: RemotePreflightResult, now = new Date().toISOString()): void {
    if (profileId === LOCAL_PROFILE_ID) {
      this.cache.state.activeProfileId = LOCAL_PROFILE_ID;
      this.cache.state.localLastConnectedAt = now;
      this.cache.state.localLastHealth = "healthy";
      this.persist();
      return;
    }

    const profile = this.requireRemoteProfile(profileId);
    profile.lastConnectedAt = now;
    profile.updatedAt = now;
    if (result) {
      profile.remoteUrl = result.normalizedUrl;
      profile.allowInsecureHttp = result.insecureTransport ? true : undefined;
      profile.lastHealth = deriveHealth(result);
      profile.lastDeploymentMode = result.deploymentMode;
      profile.lastSessionState = result.sessionState;
    }
    this.cache.state.activeProfileId = profileId;
    this.persist();
  }

  recordRemoteHealth(profileId: string, result: RemotePreflightResult, now = new Date().toISOString()): void {
    const profile = this.requireRemoteProfile(profileId);
    profile.updatedAt = now;
    profile.remoteUrl = result.normalizedUrl;
    profile.allowInsecureHttp = result.insecureTransport ? true : undefined;
    profile.lastHealth = deriveHealth(result);
    profile.lastDeploymentMode = result.deploymentMode;
    profile.lastSessionState = result.sessionState;
    this.persist();
  }

  syncRemoteProfileUrl(
    profileId: string,
    normalizedUrl: string,
    allowInsecureHttp = false,
    now = new Date().toISOString(),
  ): void {
    const profile = this.requireRemoteProfile(profileId);
    profile.remoteUrl = normalizedUrl;
    profile.allowInsecureHttp = allowInsecureHttp ? true : undefined;
    profile.updatedAt = now;
    this.persist();
  }

  getRecentRemoteProfiles(limit = 5): ConnectionProfile[] {
    return this.cache.remoteProfiles
      .slice()
      .sort((left, right) => {
        const leftValue = left.lastConnectedAt ?? left.updatedAt;
        const rightValue = right.lastConnectedAt ?? right.updatedAt;
        return rightValue.localeCompare(leftValue);
      })
      .slice(0, limit)
      .map(cloneProfile);
  }

  private requireRemoteProfile(profileId: string): ConnectionProfile {
    const profile = this.cache.remoteProfiles.find((candidate) => candidate.id === profileId);
    if (!profile) {
      throw new Error(`Unknown remote profile: ${profileId}`);
    }

    return profile;
  }

  private persist(): void {
    this.cache = sanitizeConnectionsFile(this.cache);
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.cache, null, 2), "utf8");
  }
}

function readConnectionsFile(filePath: string): PersistedConnectionsFile {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return sanitizeConnectionsFile(JSON.parse(raw));
  } catch {
    return createDefaultConnectionsFile();
  }
}

function sanitizeConnectionsFile(raw: unknown): PersistedConnectionsFile {
  if (!isObject(raw)) {
    return createDefaultConnectionsFile();
  }

  const state = sanitizeConnectionState(raw.state);
  const remoteProfiles = Array.isArray(raw.remoteProfiles)
    ? raw.remoteProfiles
        .map((profile) => sanitizeRemoteProfile(profile))
        .filter((profile): profile is ConnectionProfile => profile !== null)
    : [];

  return {
    version: CONNECTIONS_FILE_VERSION,
    state,
    remoteProfiles,
  };
}

function sanitizeConnectionState(raw: unknown): ConnectionState {
  if (!isObject(raw)) {
    return createDefaultConnectionState();
  }

  return {
    activeProfileId: typeof raw.activeProfileId === "string" ? raw.activeProfileId : null,
    alwaysShowChooser: raw.alwaysShowChooser !== false,
    autoConnectLastProfile: raw.autoConnectLastProfile === true,
    chooserMode: raw.chooserMode === "remote_existing" ? "remote_existing" : "local_embedded",
    localProfileName:
      typeof raw.localProfileName === "string" && raw.localProfileName.trim().length > 0
        ? raw.localProfileName.trim()
        : "Local",
    localNetworkEnabled: raw.localNetworkEnabled === true,
    localLastConnectedAt:
      typeof raw.localLastConnectedAt === "string" ? raw.localLastConnectedAt : undefined,
    localLastHealth: sanitizeHealth(raw.localLastHealth) ?? "healthy",
  };
}

function sanitizeRemoteProfile(raw: unknown): ConnectionProfile | null {
  if (!isObject(raw) || raw.mode !== "remote_existing" || typeof raw.id !== "string") {
    return null;
  }

  if (typeof raw.remoteUrl !== "string") {
    return null;
  }

  try {
    const normalized = normalizeRemoteUrl(raw.remoteUrl);
    const createdAt = typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString();
    const updatedAt = typeof raw.updatedAt === "string" ? raw.updatedAt : createdAt;
    return {
      id: raw.id,
      name: sanitizeProfileName(typeof raw.name === "string" ? raw.name : undefined, normalized.origin),
      mode: "remote_existing",
      remoteUrl: normalized.normalizedUrl,
      allowInsecureHttp:
        normalized.insecureTransport && raw.allowInsecureHttp === true ? true : undefined,
      createdAt,
      updatedAt,
      lastConnectedAt: typeof raw.lastConnectedAt === "string" ? raw.lastConnectedAt : undefined,
      lastHealth: sanitizeHealth(raw.lastHealth) ?? "unknown",
      lastDeploymentMode:
        raw.lastDeploymentMode === "authenticated" || raw.lastDeploymentMode === "local_trusted"
          ? raw.lastDeploymentMode
          : null,
      lastSessionState:
        raw.lastSessionState === "signed_in" ||
        raw.lastSessionState === "signed_out" ||
        raw.lastSessionState === "unknown"
          ? raw.lastSessionState
          : "unknown",
    };
  } catch {
    return null;
  }
}

function sanitizeProfileName(name: string | undefined, origin: string): string {
  const trimmed = name?.trim();
  if (trimmed) {
    return trimmed;
  }

  return new URL(origin).hostname;
}

function sanitizeHealth(value: unknown): ConnectionHealth | null {
  switch (value) {
    case "healthy":
    case "auth_required":
    case "unsupported":
    case "unreachable":
    case "unknown":
      return value;
    default:
      return null;
  }
}

function deriveHealth(result: RemotePreflightResult): ConnectionHealth {
  if (result.ok && result.sessionState === "signed_in") {
    return "healthy";
  }

  if (result.ok && result.sessionState === "signed_out") {
    return "auth_required";
  }

  if (result.reason === "unsupported_local_trusted" || result.reason === "auth_not_ready") {
    return "unsupported";
  }

  if (result.reason === "tls_error" || result.reason === "unreachable") {
    return "unreachable";
  }

  return "unknown";
}

function toLocalProfile(state: ConnectionState): ConnectionProfile {
  return {
    id: LOCAL_PROFILE_ID,
    name: state.localProfileName,
    mode: "local_embedded",
    createdAt: new Date(0).toISOString(),
    updatedAt: state.localLastConnectedAt ?? new Date(0).toISOString(),
    lastConnectedAt: state.localLastConnectedAt,
    lastHealth: state.localLastHealth ?? "healthy",
  };
}

function cloneData(data: PersistedConnectionsFile): PersistedConnectionsFile {
  return {
    version: data.version,
    state: { ...data.state },
    remoteProfiles: data.remoteProfiles.map(cloneProfile),
  };
}

function cloneProfile(profile: ConnectionProfile): ConnectionProfile {
  return { ...profile };
}

function isObject(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
