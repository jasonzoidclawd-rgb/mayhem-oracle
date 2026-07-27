export interface ForegroundState {
  gameWindowForeground: boolean;
  leagueClientForeground: boolean;
  riotClientForeground: boolean;
  gameRunning: boolean;
  gameWindowDetected: boolean;
  foregroundAppName: string | null;
  foregroundBundleIdentifier: string | null;
  foregroundOwnerName: string | null;
  foregroundWindowTitle: string | null;
  foregroundExecutablePath: string | null;
  foregroundWindowHandle: number | null;
  /** Irreversible native target generation; raw HWND/PID never reach Windows JS. */
  captureTargetGeneration: string | null;
  /** Bounded native rejection enum, never a raw OS error or window/process name. */
  platformFailureReason: string | null;
}

export function unknownForegroundState(): ForegroundState {
  return {
    gameWindowForeground: false,
    leagueClientForeground: false,
    riotClientForeground: false,
    gameRunning: false,
    gameWindowDetected: false,
    foregroundAppName: null,
    foregroundBundleIdentifier: null,
    foregroundOwnerName: null,
    foregroundWindowTitle: null,
    foregroundExecutablePath: null,
    foregroundWindowHandle: null,
    captureTargetGeneration: null,
    platformFailureReason: null,
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
