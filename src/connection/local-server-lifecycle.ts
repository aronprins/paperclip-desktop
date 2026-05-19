export interface ProcessLike {
  pid?: number | null;
}

function processPid(processLike: ProcessLike | null | undefined): number | null {
  return typeof processLike?.pid === "number" && processLike.pid > 0
    ? processLike.pid
    : null;
}

export function isSameProcess(
  left: ProcessLike | null | undefined,
  right: ProcessLike | null | undefined,
): boolean {
  const leftPid = processPid(left);
  const rightPid = processPid(right);
  return leftPid !== null && leftPid === rightPid;
}

export function shouldHandleTrackedServerExit(
  tracked: ProcessLike | null | undefined,
  exited: ProcessLike | null | undefined,
): boolean {
  return isSameProcess(tracked, exited);
}

export function shouldKillSupersededServer(
  previous: ProcessLike | null | undefined,
  next: ProcessLike | null | undefined,
): boolean {
  return processPid(previous) !== null && processPid(next) !== null && !isSameProcess(previous, next);
}

export function shouldRestorePreviousTrackedServer(
  previous: ProcessLike | null | undefined,
  attempted: ProcessLike | null | undefined,
  tracked: ProcessLike | null | undefined,
): boolean {
  return processPid(previous) !== null
    && isSameProcess(tracked, attempted)
    && !isSameProcess(previous, attempted);
}

export function shouldStopAttemptedServer(
  attempted: ProcessLike | null | undefined,
  tracked: ProcessLike | null | undefined,
): boolean {
  return isSameProcess(tracked, attempted);
}

export function shouldStopPreviousLocalServerForExposureChange(input: {
  previousMode: string | null | undefined;
  currentExposeOnLocalNetwork: boolean | null | undefined;
  nextExposeOnLocalNetwork: boolean;
}): boolean {
  return input.previousMode === "local_embedded"
    && (input.currentExposeOnLocalNetwork === true) !== input.nextExposeOnLocalNetwork;
}
