import { Coordinator } from "./coordinator";
import { timer_info } from "./timer";

// TODO test with negative start time

test("empty elapseMinDuration returns immediately", () => {
    const coordinator = new Coordinator(0);
    expect(coordinator.elapseMinDuration()).toStrictEqual([]);
    expect(coordinator.currentTime).toBe(0.0);
    // a canceled event has no effect
    coordinator.addTimerWithInfo(
        timer_info({ playerId: 0, tags: ["cancelme"] }, 1.0),
    );
    coordinator.cancel(0, ["cancelme"]);
    expect(coordinator.currentTime).toBe(0.0);
});

test("timers pop in order", () => {
    const coordinator = new Coordinator(0);
    const events = [
        { playerId: 0, tags: ["first timer"] },
        { playerId: 1, tags: ["second timer"] },
        { playerId: 1, tags: ["third timer"] },
    ];
    coordinator.addTimerWithInfo(timer_info(events[0], 1.0));
    coordinator.addTimerWithInfo(timer_info(events[1], 2.0));
    coordinator.addTimerWithInfo(timer_info(events[2], 2.3));
    expect(coordinator.elapseMinDuration()).toStrictEqual([events[0]]);
    expect(coordinator.currentTime).toBe(1.0);
    expect(coordinator.elapseMinDuration()).toStrictEqual([events[1]]);
    expect(coordinator.currentTime).toBe(2.0);
    expect(coordinator.elapseMinDuration()).toStrictEqual([events[2]]);
    expect(coordinator.currentTime).toBe(2.3);
    // once there are no more events, do nothing
    expect(coordinator.elapseMinDuration()).toStrictEqual([]);
    expect(coordinator.currentTime).toBe(2.3);
});

test("find subset of tags", () => {
    const coordinator = new Coordinator(0);
    const infos = [
        { playerId: 0, tags: ["a", "b"] },
        { playerId: 0, tags: ["a", "c"] },
        { playerId: 0, tags: ["a"] },
        { playerId: 1, tags: ["a"] },
    ].map((e) => timer_info(e, 1.0));
    for (const e of infos) {
        coordinator.addTimerWithInfo(e);
    }
    expect(coordinator.find(0, "a")).toStrictEqual(infos.slice(0, 3));
    expect(coordinator.find(0, ["a", "b"])).toStrictEqual([infos[0]]);
    // cancel an event and ensure it can no longer be found
    coordinator.cancel(0, ["a", "b"]);
    expect(coordinator.find(0, "a")).toStrictEqual([infos[1], infos[2]]);
    coordinator.cancel(0, ["a"]);
    expect(coordinator.find(0, "a")).toStrictEqual([]);
    expect(coordinator.find(1, "a")).toStrictEqual([infos[3]]);
});

test("peek elapse time", () => {
    const coordinator = new Coordinator(1); // different starting time
    const events = [
        { playerId: 0, tags: ["first timer"] },
        { playerId: 1, tags: ["second timer"] },
        { playerId: 1, tags: ["third timer"] },
    ];
    coordinator.addTimerWithInfo(timer_info(events[0], 1.0));
    coordinator.addTimerWithInfo(timer_info(events[1], 2.0));
    coordinator.addTimerWithInfo(timer_info(events[2], 2.3));
    expect(coordinator.peekNextElapseTime()).toBe(2.0);
    coordinator.elapseMinDuration();
    expect(coordinator.peekNextElapseTime()).toBe(3.0);
    coordinator.cancel(1, ["second timer"]);
    expect(coordinator.peekNextElapseTime()).toBe(3.3);
    coordinator.elapseMinDuration();
    expect(coordinator.peekNextElapseTime()).toBe(undefined);
});

test("canceled timers are skipped", () => {
    const coordinator = new Coordinator(0);
    coordinator.addTimer(0, ["cancel_1"], 1.0);
    coordinator.addTimer(0, ["cancel_2"], 2.0);
    coordinator.addTimer(0, ["no_cancel"], 3.0);
    coordinator.addTimer(0, ["cancel_3"], 4.0);
    coordinator.cancel(0, ["cancel_1"]);
    coordinator.cancel(0, ["cancel_2"]);
    expect(coordinator.elapseMinDuration()).toStrictEqual([
        { playerId: 0, tags: ["no_cancel"] },
    ]);
    expect(coordinator.currentTime).toBe(3.0);
    coordinator.cancel(0, ["cancel_3"]);
    // Currently, elapsing when all remaining timers are canceled will still advance time
    expect(coordinator.elapseMinDuration()).toStrictEqual([]);
    expect(coordinator.currentTime).toBe(4.0);
});

test("reset existing timer", () => {
    const coordinator = new Coordinator(0);
    coordinator.addTimer(0, ["resettable"], 1.0);
    coordinator.addTimer(0, ["resettable"], 2.0);
    coordinator.addTimer(1, ["resettable"], 3.0);
    coordinator.elapseMinDuration();
    expect(coordinator.currentTime).toBe(1.0);
    coordinator.addOrResetTimer(0, ["resettable"], 3.0); // absolute time = 4.0
    // Unrelated playerId is unaffected
    expect(coordinator.elapseMinDuration()).toStrictEqual([
        { playerId: 1, tags: ["resettable"] },
    ]);
    expect(coordinator.currentTime).toBe(3.0);
    expect(coordinator.elapseMinDuration()).toStrictEqual([
        { playerId: 0, tags: ["resettable"] },
    ]);
    expect(coordinator.currentTime).toBe(4.0);
});
