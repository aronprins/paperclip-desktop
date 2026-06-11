import {
  autoUpdater,
  type UpdateCheckResult,
} from "electron-updater";
import {
  app,
  dialog,
  BrowserWindow,
  type MessageBoxOptions,
  type MessageBoxReturnValue,
} from "electron";
import { existsSync } from "node:fs";
import path from "node:path";
import log from "electron-log";

const updaterLogger = {
  info: (...args: unknown[]) => log.info(...args),
  warn: (...args: unknown[]) => log.warn(...args),
  error: (...args: unknown[]) => {
    if (args.some((arg) => isMissingReleaseFeedError(arg))) {
      log.warn("[updater] No published release feed is available yet; skipping update check");
      return;
    }

    log.error(...args);
  },
};

// Route autoUpdater logs through electron-log, but downgrade the expected
// GitHub 404 feed miss until a release feed actually exists.
autoUpdater.logger = updaterLogger as typeof log;
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;

let activeWindow: BrowserWindow | null = null;
let updaterInitialized = false;
let scheduledChecksStarted = false;
let checkForUpdatesPromise: Promise<UpdateCheckResult | null> | null = null;
let downloadUpdatePromise: Promise<Array<string>> | null = null;
let downloadedVersion: string | null = null;
let restartPromptVisible = false;

/**
 * Call this once from the main process after the window is ready.
 *
 * Usage in main.ts:
 *   import { initAutoUpdater } from "./updater";
 *   mainWindow.once("ready-to-show", () => initAutoUpdater(mainWindow));
 */
export function initAutoUpdater(mainWindow: BrowserWindow): void {
  activeWindow = mainWindow;

  if (!app.isPackaged) {
    log.info("[updater] Skipping update check in dev mode");
    return;
  }

  if (!hasUpdateConfig()) {
    log.info("[updater] Skipping update check because app-update.yml is missing");
    return;
  }

  ensureUpdaterInitialized();

  if (scheduledChecksStarted) {
    return;
  }

  scheduledChecksStarted = true;

  void checkForUpdatesSilently({ downloadIfAvailable: false });
  setInterval(
    () => {
      void checkForUpdatesSilently({ downloadIfAvailable: false });
    },
    4 * 60 * 60 * 1000,
  );
}

export async function checkForUpdatesFromMenu(preferredWindow?: BrowserWindow | null): Promise<void> {
  activeWindow = preferredWindow ?? BrowserWindow.getFocusedWindow() ?? activeWindow;

  if (!app.isPackaged) {
    await showDialog({
      type: "info",
      title: "Check for Updates",
      message: "Update checks are only available in packaged builds.",
    });
    return;
  }

  if (!hasUpdateConfig()) {
    await showDialog({
      type: "info",
      title: "Check for Updates",
      message: "Update checks are unavailable in this local app build.",
      detail: "This unpacked build does not include app-update.yml. Test updates from a release-style packaged build instead.",
    });
    return;
  }

  ensureUpdaterInitialized();

  if (downloadedVersion) {
    await promptToRestart(downloadedVersion);
    return;
  }

  if (checkForUpdatesPromise) {
    await showDialog({
      type: "info",
      title: "Check for Updates",
      message: "An update check is already in progress.",
    });
    return;
  }

  if (downloadUpdatePromise) {
    await showDialog({
      type: "info",
      title: "Update Downloading",
      message: "An update is already downloading.",
      detail: "You will be prompted to restart when the download finishes.",
    });
    return;
  }

  try {
    const result = await runUpdateCheck();

    if (!result || !result.isUpdateAvailable) {
      await showDialog({
        type: "info",
        title: "You're Up to Date",
        message: `Paperclip v${app.getVersion()} is already the latest version.`,
      });
      return;
    }

    const { response } = await showDialog({
      type: "info",
      title: "Update Available",
      message: `Paperclip v${result.updateInfo.version} is available.`,
      detail: "Download the update now? You'll be prompted to restart after the download completes.",
      buttons: ["Download", "Later"],
      defaultId: 0,
      cancelId: 1,
    });

    if (response !== 0) {
      return;
    }

    await downloadUpdate();
  } catch (err) {
    if (isMissingReleaseFeedError(err)) {
      await showDialog({
        type: "info",
        title: "You're Up to Date",
        message: `Paperclip v${app.getVersion()} is already the latest version.`,
      });
      return;
    }

    log.error("[updater] Manual update check failed:", err);
    await showDialog({
      type: "error",
      title: "Update Check Failed",
      message: "Paperclip could not check for updates.",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

type UpdateStatus = "checking" | "available" | "up-to-date" | "downloading" | "downloaded" | "error";

function ensureUpdaterInitialized(): void {
  if (updaterInitialized) {
    return;
  }

  updaterInitialized = true;

  autoUpdater.on("checking-for-update", () => {
    log.info("[updater] Checking for updates...");
    sendStatus("checking");
  });

  autoUpdater.on("update-available", (info) => {
    log.info(`[updater] Update available: v${info.version}`);
    sendStatus("available", info.version);
  });

  autoUpdater.on("update-not-available", () => {
    log.info("[updater] App is up to date");
    sendStatus("up-to-date");
  });

  autoUpdater.on("download-progress", (progress) => {
    sendStatus("downloading", undefined, Math.round(progress.percent));
  });

  autoUpdater.on("update-downloaded", (info) => {
    downloadedVersion = info.version;
    downloadUpdatePromise = null;
    log.info(`[updater] Update downloaded: v${info.version}`);
    sendStatus("downloaded", info.version);
    void promptToRestart(info.version);
  });

  autoUpdater.on("error", (err) => {
    if (isMissingReleaseFeedError(err)) {
      sendStatus("up-to-date");
      return;
    }

    log.error("[updater] Error:", err);
    sendStatus("error");
  });
}

function sendStatus(status: UpdateStatus, version?: string, percent?: number): void {
  if (!activeWindow || activeWindow.isDestroyed()) {
    return;
  }

  activeWindow.webContents.send("update-status", { status, version, percent });
}

function resolveDialogWindow(): BrowserWindow | undefined {
  if (activeWindow && !activeWindow.isDestroyed()) {
    return activeWindow;
  }

  const focusedWindow = BrowserWindow.getFocusedWindow();
  if (focusedWindow && !focusedWindow.isDestroyed()) {
    return focusedWindow;
  }

  return undefined;
}

function hasUpdateConfig(): boolean {
  return existsSync(path.join(process.resourcesPath, "app-update.yml"));
}

async function showDialog(options: MessageBoxOptions): Promise<MessageBoxReturnValue> {
  const dialogWindow = resolveDialogWindow();
  if (dialogWindow) {
    return dialog.showMessageBox(dialogWindow, options);
  }

  return dialog.showMessageBox(options);
}

async function runUpdateCheck(): Promise<UpdateCheckResult | null> {
  if (checkForUpdatesPromise) {
    return checkForUpdatesPromise;
  }

  checkForUpdatesPromise = autoUpdater.checkForUpdates();

  try {
    return await checkForUpdatesPromise;
  } finally {
    checkForUpdatesPromise = null;
  }
}

async function downloadUpdate(): Promise<void> {
  if (downloadUpdatePromise) {
    await downloadUpdatePromise;
    return;
  }

  downloadUpdatePromise = autoUpdater.downloadUpdate();

  try {
    await downloadUpdatePromise;
  } finally {
    downloadUpdatePromise = null;
  }
}

async function checkForUpdatesSilently(options: { downloadIfAvailable: boolean }): Promise<void> {
  try {
    const result = await runUpdateCheck();
    if (options.downloadIfAvailable && result?.isUpdateAvailable && !downloadedVersion) {
      await downloadUpdate();
    }
  } catch (err) {
    if (isMissingReleaseFeedError(err)) {
      sendStatus("up-to-date");
      return;
    }

    log.error("[updater] Update check failed:", err);
    sendStatus("error");
  }
}

async function promptToRestart(version: string): Promise<void> {
  if (restartPromptVisible) {
    return;
  }

  restartPromptVisible = true;

  try {
    const { response } = await showDialog({
      type: "info",
      title: "Update Ready",
      message: `Paperclip v${version} has been downloaded.`,
      detail: "Restart now to apply the update?",
      buttons: ["Restart", "Later"],
      defaultId: 0,
      cancelId: 1,
    });

    if (response === 0) {
      autoUpdater.quitAndInstall();
    }
  } finally {
    restartPromptVisible = false;
  }
}

function isMissingReleaseFeedError(err: unknown): boolean {
  if (typeof err === "string") {
    return err.includes("releases.atom") && err.includes("404");
  }

  if (!err || typeof err !== "object") {
    return false;
  }

  const maybeHttpError = err as { statusCode?: number; message?: string; stack?: string };
  return (
    maybeHttpError.statusCode === 404 &&
    (
      (typeof maybeHttpError.message === "string" && maybeHttpError.message.includes("releases.atom")) ||
      (typeof maybeHttpError.stack === "string" && maybeHttpError.stack.includes("releases.atom"))
    )
  );
}
