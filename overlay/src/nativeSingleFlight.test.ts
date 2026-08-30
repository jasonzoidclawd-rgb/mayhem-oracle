import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NATIVE_LOGICAL_DEADLINE_MS,
  NativeSingleFlight,
  type NativeSingleFlightResult,
} from "./nativeSingleFlight";
import { resolveRoundDelivery } from "./roundDelivery";

afterEach(() => {
  vi.useRealTimers();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe("native operation physical single-flight", () => {
  it("lets every later logical tick finish while one native invocation never settles", async () => {
    vi.useFakeTimers();
    const flight = new NativeSingleFlight<string>();
    const invoke = vi.fn(() => new Promise<string>(() => {}));
    const ticks: NativeSingleFlightResult<string>[] = [];
    void flight.run({ invoke, generation: () => "game-1" }).then((result) => ticks.push(result));

    await vi.advanceTimersByTimeAsync(NATIVE_LOGICAL_DEADLINE_MS);
    for (let tick = 0; tick < 3; tick += 1) {
      ticks.push(await flight.run({ invoke, generation: () => "game-1" }));
    }

    expect(ticks).toHaveLength(4);
  });

  it("keeps exactly one physical invocation and no demand queue after timeout", async () => {
    vi.useFakeTimers();
    const flight = new NativeSingleFlight<string>();
    const invoke = vi.fn(() => new Promise<string>(() => {}));
    const ticks: NativeSingleFlightResult<string>[] = [];
    void flight.run({ invoke, generation: () => "game-1" }).then((result) => ticks.push(result));

    await vi.advanceTimersByTimeAsync(NATIVE_LOGICAL_DEADLINE_MS * 10);
    for (let tick = 0; tick < 20; tick += 1) {
      ticks.push(await flight.run({ invoke, generation: () => "game-1" }));
    }

    expect(ticks).toHaveLength(21);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("discards a late completion after its generation has been superseded", async () => {
    vi.useFakeTimers();
    const native = deferred<string>();
    const flight = new NativeSingleFlight<string>();
    let generation = "game-1:champion-1:in-game";
    const resultPromise = flight.run({ invoke: () => native.promise, generation: () => generation });

    generation = "game-2:champion-2:augment-selection";
    await vi.advanceTimersByTimeAsync(NATIVE_LOGICAL_DEADLINE_MS);
    native.resolve("old-game-value");

    await expect(resultPromise).resolves.toEqual({ status: "stale" });
  });

  it("accepts a later healthy result after a timed-out flight settles", async () => {
    vi.useFakeTimers();
    const first = deferred<{ level: number; isDead: boolean }>();
    const flight = new NativeSingleFlight<{ level: number; isDead: boolean }>();
    let liveDataStatus = "ready";
    let offerPipelineArmed = true;
    const apply = (result: NativeSingleFlightResult<{ level: number; isDead: boolean }>) => {
      if (result.status === "ready") {
        liveDataStatus = "ready";
        offerPipelineArmed = resolveRoundDelivery({
          playerLevel: result.value.level,
          isDead: result.value.isDead,
          completedRounds: 0,
          offerLatched: false,
        }).scanMode !== "off";
      } else if (result.status === "unavailable") {
        liveDataStatus = "unavailable";
        offerPipelineArmed = false;
      }
    };

    const firstTick = flight.run({ invoke: () => first.promise, generation: () => "game-1" })
      .then(apply);
    await vi.advanceTimersByTimeAsync(NATIVE_LOGICAL_DEADLINE_MS);
    await firstTick;
    expect(liveDataStatus).toBe("unavailable");
    expect(offerPipelineArmed).toBe(false);

    first.resolve({ level: 3, isDead: false });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await flight.run({
      invoke: async () => ({ level: 3, isDead: false }),
      generation: () => "game-1",
    }).then(apply);
    expect(liveDataStatus).toBe("ready");
    expect(offerPipelineArmed).toBe(true);
  });
});
