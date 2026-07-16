export interface ForegroundState {
  gameWindowForeground: boolean;
  riotClientForeground: boolean;
  gameRunning: boolean;
  gameWindowDetected: boolean;
  foregroundAppName: string | null;
  foregroundBundleIdentifier: string | null;
  foregroundOwnerName: string | null;
  foregroundWindowTitle: string | null;
}

export function unknownForegroundState(): ForegroundState {
  return {
    gameWindowForeground: false,
    riotClientForeground: false,
    gameRunning: false,
    gameWindowDetected: false,
    foregroundAppName: null,
    foregroundBundleIdentifier: null,
    foregroundOwnerName: null,
    foregroundWindowTitle: null,
  };
}

/** The single gate for pixels that describe the current in-game surface. */
export function gameOverlayVisible({
  gameWindowForeground,
  previewMode,
}: {
  gameWindowForeground: boolean;
  previewMode: boolean;
}): boolean {
  return gameWindowForeground || previewMode;
}
