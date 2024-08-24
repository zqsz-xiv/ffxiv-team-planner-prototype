import { Seconds, PlayerId } from "../utils";

// extend this interface if you need to provide more contextual information
// TODO add an extra layer of indirection to return remaining w/o exposing active
export interface GameEvent {
    playerId: PlayerId;
    tags: string[];
}

export interface TimerInfo {
    event: GameEvent;
    remaining: Seconds;
}

export function timer_info(event: GameEvent, remaining: Seconds): TimerInfo {
    return {
        event: event,
        remaining: remaining,
    };
}

export class CountdownTimer {
    info: GameEvent;
    remaining: Seconds;
    active: boolean;

    constructor(info: TimerInfo) {
        console.assert(
            !Number.isNaN(info.remaining) && info.remaining >= 0,
            "CountdownTimer must have non-negative time remaining; got " +
                info.remaining,
        );
        this.info = info.event;
        this.remaining = info.remaining;
        this.active = true;
    }

    deactivate() {
        this.active = false;
    }
}
