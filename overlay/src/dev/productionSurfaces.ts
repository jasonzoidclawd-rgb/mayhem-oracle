/** Development diagnostics are never a production render authorization. */
export function developmentSurfaceVisible(devBuild: boolean): boolean {
  return devBuild === true;
}
