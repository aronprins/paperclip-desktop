export interface NavigationHistoryLike {
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
}

export function handleSwipeNavigation(
  direction: string,
  navigationHistory: NavigationHistoryLike,
): boolean {
  if (direction === "left") {
    if (!navigationHistory.canGoBack()) {
      return false;
    }

    navigationHistory.goBack();
    return true;
  }

  if (direction === "right") {
    if (!navigationHistory.canGoForward()) {
      return false;
    }

    navigationHistory.goForward();
    return true;
  }

  return false;
}
