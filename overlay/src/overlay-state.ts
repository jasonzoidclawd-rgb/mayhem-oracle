export function shouldAcceptOcrResult(args: {
  startedRunId: number;
  currentRunId: number;
  ocrActive: boolean;
  leagueFocused: boolean;
}): boolean {
  return (
    args.startedRunId === args.currentRunId &&
    args.ocrActive &&
    args.leagueFocused
  );
}
