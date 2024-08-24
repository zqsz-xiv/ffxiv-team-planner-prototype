import { Optional, Seconds, PlayerId } from "../utils";
import { CountdownTimer, TimerInfo, timer_info, GameEvent } from "./timer";
import { Heap } from "heap-js";

const SERVER_ACTOR_ID: PlayerId = -1;
export const SERVER_TICK_INTERVAL: Seconds = 3.0;
export const SERVER_TICK_TAG = "SERVER_TICK";

export class Coordinator {
    #nextPlayerId: PlayerId;
    currentTime: Seconds;
    readonly startTime: Seconds;
    private timers: Heap<CountdownTimer>;

    constructor();
    constructor(startTime: Seconds);
    constructor(startTime?: Seconds) {
        if (startTime === undefined) {
            startTime = 0.0;
        }
        // startTime may be negative, as for prepull abilities
        this.startTime = startTime;
        this.#nextPlayerId = 0;
        this.currentTime = startTime;
        this.timers = new Heap(
            (a: CountdownTimer, b: CountdownTimer) => a.remaining - b.remaining,
        );
    }

    newPlayerId(): PlayerId {
        return this.#nextPlayerId++;
    }

    public reset() {
        this.currentTime = this.startTime;
        this.timers.clear();
        // do NOT reset nextPlayerId
    }

    addTimer(playerId: PlayerId, tags: string[], remaining: Seconds) {
        this.addCountdownTimer(
            new CountdownTimer(
                timer_info({ playerId: playerId, tags: tags }, remaining),
            ),
        );
    }

    /**
     * Adds a timer and cancels any existing timer that contains the specified tags.
     */
    addOrResetTimer(playerId: PlayerId, tags: string[], remaining: Seconds) {
        this.cancel(playerId, tags);
        this.addTimer(playerId, tags, remaining);
    }

    addOrResetTimerWithInfo(info: TimerInfo) {
        this.cancel(info.event.playerId, info.event.tags);
        this.addTimerWithInfo(info);
    }

    addTimerWithInfo(info: TimerInfo) {
        this.addCountdownTimer(new CountdownTimer(info));
    }

    private addCountdownTimer(timer: CountdownTimer) {
        this.timers.push(timer);
    }

    registerServerTick(start: Seconds) {
        console.assert(this.find(SERVER_ACTOR_ID).length === 0);
        this.addTimer(SERVER_ACTOR_ID, [SERVER_TICK_TAG], start);
    }

    find(id: PlayerId): TimerInfo[];
    find(id: PlayerId, tags: string): TimerInfo[];
    find(
        id: PlayerId,
        tags: string,
        pred: (event: GameEvent) => boolean,
    ): TimerInfo[];
    find(id: PlayerId, tags: string[]): TimerInfo[];
    find(
        id: PlayerId,
        tags: string[],
        pred: (event: GameEvent) => boolean,
    ): TimerInfo[];
    /**
     * Get all TimerInfo objects that match the provided ID and contains all of the listed tags.
     * The returned TimerInfo may have additional tags, i.e. searching for "anim_lock" may return
     * a timer that has both "anim_lock" and "general_lock" as tags.
     */
    find(
        id: PlayerId,
        tags?: string[] | string,
        pred?: (event: GameEvent) => boolean,
    ): TimerInfo[] {
        if (tags === undefined) {
            return this.timers
                .toArray()
                .flatMap((timer) =>
                    timer.active && timer.info.playerId === id
                        ? [timer_info(timer.info, timer.remaining)]
                        : [],
                );
        }
        const predFn = pred === undefined ? (_event: GameEvent) => true : pred;
        const tagList = typeof tags === "string" ? [tags] : tags;
        return this.timers.toArray().flatMap((timer) =>
            timer.active &&
            timer.info.playerId === id &&
            // Perform tag check before the predicate in case we check special fields
            tagList.every((tag) => timer.info.tags.includes(tag)) &&
            predFn(timer.info)
                ? [timer_info(timer.info, timer.remaining)]
                : [],
        );
    }

    /**
     * Removes all timers that match playerId and tags.
     *
     * Internally, this is represented as a "soft" deletion by setting the timer's
     * `active` flag to false; this should be filtered on all elapse/find methods.
     */
    cancel(id: PlayerId, tags: string[]): void;
    cancel(
        id: PlayerId,
        tags: string[],
        pred: (event: GameEvent) => boolean,
    ): void;
    cancel(id: PlayerId, tags: string[], pred?: (event: GameEvent) => boolean) {
        const predFn = pred === undefined ? (_event: GameEvent) => true : pred;
        // for-of will consume heap, so make sure to convert toArray first
        for (const timer of this.timers.toArray()) {
            if (
                timer.info.playerId === id &&
                timer.active &&
                // Perform tag check before the predicate in case we check special fields
                tags.every((tag) => timer.info.tags.includes(tag)) &&
                predFn(timer.info)
            ) {
                // console.log(`deactivate @${this.currentTime}: ` + JSON.stringify(timer));
                timer.deactivate();
            }
        }
    }

    elapseTimers(duration: Seconds) {
        this.currentTime += duration;
        // for-of will consume heap, so make sure to convert toArray first
        for (const timer of this.timers.toArray()) {
            timer.remaining -= duration;
        }
    }

    // do not implement waitUntil function on the coordinator: state object needs to handle
    // actions on expiry of all events

    /**
     * Elapse all timers by the minimum duration among all timers remaining.
     *
     * If there are no active timers, time is not advanced; however, if there are
     * inactive timers that are yet to expire,  time may advance.
     *
     * Returns GameEvents from all objects that have expired.
     */
    elapseMinDuration(): GameEvent[] {
        if (this.timers.length === 0) {
            return [];
        }
        let minTimer = this.timers.pop()!;
        let elapsed = minTimer.remaining;
        // Pop until the first active timer is found
        // If there are no more timers, then we will return empty array anyway
        while (!minTimer.active && this.timers.length) {
            minTimer = this.timers.pop()!;
            elapsed = minTimer.remaining;
        }
        const poppedInfos = [];
        if (minTimer.active) {
            poppedInfos.push(minTimer.info);
        }
        this.elapseTimers(elapsed);
        while (this.timers.length && this.timers.top(1)[0].remaining === 0) {
            // Pop all simultaneously expired timers
            const newMinTimer = this.timers.pop()!;
            if (newMinTimer.active) {
                poppedInfos.push(newMinTimer.info);
            }
        }
        // console.log(`popping: @${this.currentTime} ` + JSON.stringify(poppedInfos));
        return poppedInfos;
    }

    /**
     * Returns the future value of currentTime if elapseMinDuration would be called.
     *
     * If there are no active timers, returns undefined.
     */
    peekNextElapseTime(): Optional<Seconds> {
        if (this.timers.length === 0) {
            return undefined;
        }
        let minTimer;
        do {
            minTimer = this.timers.peek()!;
            if (minTimer.active) {
                return minTimer.remaining + this.currentTime;
            }
            // Timers cannot be reactivated, so we are safe to pop this timer and try the next one.
            this.timers.pop();
        } while (!minTimer.active);
        return undefined;
    }

    reprTimers(): string[] {
        return this.timers
            .toArray()
            .sort((a, b) => a.remaining - b.remaining)
            .flatMap((timer) =>
                timer.active
                    ? [
                          `${JSON.stringify(
                              timer.info,
                          )} in ${timer.remaining.toFixed(3)}`,
                      ]
                    : [],
            );
    }
}
