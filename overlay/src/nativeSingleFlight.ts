export const NATIVE_LOGICAL_DEADLINE_MS = 1_500;

export type NativeSingleFlightResult<T> =
  | { status: "ready"; value: T }
  | { status: "unavailable"; reason: "in-flight" | "logical-timeout" | "rejected" }
  | { status: "stale" };

export interface NativeSingleFlightOptions<T> {
  invoke: () => Promise<T>;
  generation: () => string;
  deadlineMs?: number;
}

export class NativeSingleFlight<T> {
  private physicalOwner: symbol | null = null;

  run(options: NativeSingleFlightOptions<T>): Promise<NativeSingleFlightResult<T>> {
    if (this.physicalOwner !== null) {
      return Promise.resolve({ status: "unavailable", reason: "in-flight" });
    }

    const owner = Symbol("native-flight");
    const generationAtStart = options.generation();
    const deadlineMs = options.deadlineMs ?? NATIVE_LOGICAL_DEADLINE_MS;
    this.physicalOwner = owner;

    // Physical ownership belongs to the native promise until it actually
    // settles. A logical deadline cannot cancel native work, and freeing this
    // slot at timeout would allow overlapping invocations of the same command.
    const nativePromise = Promise.resolve().then(options.invoke);

    return new Promise<NativeSingleFlightResult<T>>((resolve) => {
      let logicalSettled = false;
      const settleLogical = (result: NativeSingleFlightResult<T>) => {
        if (logicalSettled) return;
        logicalSettled = true;
        clearTimeout(timer);
        resolve(result);
      };
      const currentResult = (result: NativeSingleFlightResult<T>) => (
        options.generation() === generationAtStart ? result : { status: "stale" as const }
      );
      const timer = setTimeout(() => {
        settleLogical(currentResult({ status: "unavailable", reason: "logical-timeout" }));
      }, deadlineMs);

      nativePromise.then(
        (value) => settleLogical(currentResult({ status: "ready", value })),
        () => settleLogical(currentResult({ status: "unavailable", reason: "rejected" })),
      ).finally(() => {
        if (this.physicalOwner === owner) this.physicalOwner = null;
      });
    });
  }
}
