import path from "node:path";

export const DESKTOP_USER_DATA_DIR_ENV = "PAPERCLIP_DESKTOP_USER_DATA_DIR";
export const PAPERCLIP_HOME_ENV = "PAPERCLIP_HOME";
export const REQUIRE_ISOLATED_DATA_ENV = "PAPERCLIP_DESKTOP_REQUIRE_ISOLATED_DATA";

export interface AppPathController {
  getPath(name: "appData" | "home" | "userData"): string;
  setPath(name: "userData", value: string): void;
}

export interface RuntimePathEnv {
  [DESKTOP_USER_DATA_DIR_ENV]?: string;
  [PAPERCLIP_HOME_ENV]?: string;
  [REQUIRE_ISOLATED_DATA_ENV]?: string;
}

export interface IsolatedRuntimePathInput {
  env: RuntimePathEnv;
  userDataPath: string;
  paperclipHome: string;
  homePath: string;
  platform: NodeJS.Platform;
}

export function applyDesktopUserDataOverride(app: AppPathController, env: RuntimePathEnv = process.env): string | null {
  const override = readAbsolutePathEnv(env, DESKTOP_USER_DATA_DIR_ENV);
  if (!override) {
    return null;
  }

  app.setPath("userData", override);
  return override;
}

export function resolvePaperclipHomePath(input: {
  env?: RuntimePathEnv;
  homePath: string;
  userDataPath: string;
  pathExists?: (target: string) => boolean;
}): string {
  const env = input.env ?? process.env;
  const override = readAbsolutePathEnv(env, PAPERCLIP_HOME_ENV);
  if (override) {
    return override;
  }

  const defaultHome = path.join(input.homePath, ".paperclip");
  const defaultInstance = path.join(defaultHome, "instances", "default", "db");
  const pathExists = input.pathExists ?? (() => false);
  if (input.homePath && pathExists(defaultInstance)) {
    return defaultHome;
  }

  return input.userDataPath;
}

export function assertIsolatedRuntimePaths(input: IsolatedRuntimePathInput): void {
  if (!requiresIsolatedData(input.env)) {
    return;
  }

  const userDataOverride = readAbsolutePathEnv(input.env, DESKTOP_USER_DATA_DIR_ENV);
  const paperclipHomeOverride = readAbsolutePathEnv(input.env, PAPERCLIP_HOME_ENV);
  if (!userDataOverride || !paperclipHomeOverride) {
    throw new Error(
      `${REQUIRE_ISOLATED_DATA_ENV}=1 requires both ${DESKTOP_USER_DATA_DIR_ENV} and ${PAPERCLIP_HOME_ENV} to be absolute paths.`,
    );
  }

  const normalizedUserData = normalizePath(input.userDataPath);
  const normalizedPaperclipHome = normalizePath(input.paperclipHome);
  if (normalizedUserData !== normalizePath(userDataOverride)) {
    throw new Error(
      `${REQUIRE_ISOLATED_DATA_ENV}=1 expected userData to be ${userDataOverride}, got ${input.userDataPath}`,
    );
  }
  if (normalizedPaperclipHome !== normalizePath(paperclipHomeOverride)) {
    throw new Error(
      `${REQUIRE_ISOLATED_DATA_ENV}=1 expected ${PAPERCLIP_HOME_ENV} to be ${paperclipHomeOverride}, got ${input.paperclipHome}`,
    );
  }

  const productionPaths = productionPaperclipDataPaths(input.platform, input.homePath).map(normalizePath);

  for (const productionPath of productionPaths) {
    if (normalizedUserData === productionPath || normalizedPaperclipHome === productionPath) {
      throw new Error(
        `${REQUIRE_ISOLATED_DATA_ENV}=1 refused to use production Paperclip data path: ${productionPath}`,
      );
    }
  }
}

export function productionPaperclipDataPaths(platform: NodeJS.Platform, homePath: string): string[] {
  if (!homePath) {
    return [];
  }

  if (platform === "darwin") {
    return [
      path.join(homePath, "Library", "Application Support", "Paperclip"),
      path.join(homePath, ".paperclip"),
    ];
  }

  if (platform === "win32") {
    return [
      path.join(homePath, "AppData", "Roaming", "Paperclip"),
      path.join(homePath, ".paperclip"),
    ];
  }

  return [
    path.join(homePath, ".config", "Paperclip"),
    path.join(homePath, ".paperclip"),
  ];
}

export function requiresIsolatedData(env: RuntimePathEnv = process.env): boolean {
  return env[REQUIRE_ISOLATED_DATA_ENV] === "1";
}

function readAbsolutePathEnv(env: RuntimePathEnv, name: keyof RuntimePathEnv): string | null {
  const value = env[name]?.trim();
  if (!value) {
    return null;
  }

  if (!path.isAbsolute(value)) {
    throw new Error(`${name} must be an absolute path.`);
  }

  return path.resolve(value);
}

function normalizePath(target: string): string {
  return path.resolve(target);
}
