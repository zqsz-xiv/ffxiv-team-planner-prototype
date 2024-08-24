import {
    Coordinator,
    SERVER_TICK_TAG,
    SERVER_TICK_INTERVAL,
} from "../sim/coordinator";
import { GameEvent, timer_info } from "../sim/timer";
import { ActionError, isResultError, GeneralAction } from "../actions/common";
import { PlayerId, Seconds, Optional, isOptionalSome } from "../utils";
import { Label } from "../labels/common";
import {
    DamageInstance,
    DamageApplicationEvent,
    DotBeginEvent,
    DotExpireEvent,
    GlobalConfig,
    STATE_TAGS,
    GENERAL_ACTION_TAGS,
} from "./common";
import { GenericPlayerState, CastConfirmEvent } from "./player";
import { GlobalTimeline } from "../timeline";

export class GlobalState {
    playerStates: Map<PlayerId, GenericPlayerState>;
    // TODO move all of these fields onto the players?
    damageEvents: DamageInstance[]; // represents events that have already occurred
    // TODO give more info than just labels
    attemptEvents: Map<PlayerId, { time: Seconds; label: Label }[]>;
    confirmEvents: Map<PlayerId, { time: Seconds; label: Label }[]>;
    activeDots: Map<PlayerId, Map<string, number>>; // maps player id to map of dot label -> tick potency
    coordinator: Coordinator;
    globalConfig: GlobalConfig;

    constructor(
        playerStates: GenericPlayerState[],
        globalConfig: GlobalConfig,
    ) {
        this.playerStates = new Map();
        this.damageEvents = [];
        this.attemptEvents = new Map();
        this.confirmEvents = new Map();
        this.activeDots = new Map();
        playerStates.forEach((state) => {
            this.playerStates.set(state.playerId, state);
            this.attemptEvents.set(state.playerId, []);
            this.confirmEvents.set(state.playerId, []);
            this.activeDots.set(state.playerId, new Map());
        });
        // TODO sync this up in a different way
        this.coordinator = playerStates[0].globalCoordinator;
        this.globalConfig = globalConfig;
        this.coordinator.registerServerTick(globalConfig.initialServerTickOfs);
    }

    public clear() {
        this.damageEvents = [];
        for (const id of this.playerStates.keys()) {
            this.attemptEvents.set(id, []);
            this.confirmEvents.set(id, []);
            this.activeDots.get(id)!.clear();
        }
        this.coordinator.reset();
        this.coordinator.registerServerTick(
            this.globalConfig.initialServerTickOfs,
        );
        // coordinator reset must have occurred already so we can re-register actor ticks
        for (const state of this.playerStates.values()) {
            state.clear();
        }
    }

    public getPlayerState(id: PlayerId): GenericPlayerState {
        return this.playerStates.get(id)!;
    }

    public get startTime(): Seconds {
        return this.coordinator.startTime;
    }

    public get encounterTime(): Seconds {
        return this.coordinator.currentTime;
    }

    public reprDamageEvents(): string[] {
        return this.damageEvents.map(
            (e) =>
                `${e.appliedAt.toFixed(3)}: ${e.actionName} for ${
                    e.potency
                } base potency`,
        );
    }

    public reprAttemptEvents(): string[] {
        // TODO sort by time
        return Array.from(this.attemptEvents.entries()).flatMap(([id, evts]) =>
            evts.flatMap((e) => [`${id}: ${e.label.short} @ ${e.time}`]),
        );
    }

    public reprConfirmEvents(): string[] {
        // TODO sort by time
        return Array.from(this.confirmEvents.entries()).flatMap(([id, evts]) =>
            evts.flatMap((e) => [`${id}: ${e.label.short} @ ${e.time}`]),
        );
    }

    processEvent(event: GameEvent) {
        if (event.playerId !== -1) {
            if (event.tags.includes(GENERAL_ACTION_TAGS.castConfirm)) {
                this.confirmEvents.get(event.playerId)!.push({
                    time: this.encounterTime,
                    label: (event as CastConfirmEvent).label,
                });
            }
            this.playerStates.get(event.playerId)!.processEvent(event);
        }
        if (event.tags.includes(SERVER_TICK_TAG)) {
            // TODO figure out what happens if a dot is reapplied at the same time as a server tick
            for (const [playerId, dots] of this.activeDots.entries()) {
                for (const [dotName, tickPotency] of dots.entries()) {
                    this.damageEvents.push(
                        new DamageInstance(
                            playerId,
                            dotName,
                            tickPotency,
                            this.encounterTime,
                            true,
                        ),
                    );
                }
            }
            // Queue next server tick
            this.coordinator.registerServerTick(SERVER_TICK_INTERVAL);
        } else if (event.tags.includes(STATE_TAGS.dotBegin)) {
            const dotBegin = event as DotBeginEvent;
            // Assume all dots are unique per player
            this.activeDots
                .get(dotBegin.playerId)!
                .set(dotBegin.label.short, dotBegin.potency);
            // Set expiration timer and overwrite existing
            this.coordinator.addOrResetTimerWithInfo(
                timer_info(
                    {
                        playerId: dotBegin.playerId,
                        tags: [STATE_TAGS.dotExpire],
                        label: dotBegin.label,
                    } as DotExpireEvent,
                    dotBegin.duration,
                ),
            );
        } else if (event.tags.includes(STATE_TAGS.dotExpire)) {
            this.activeDots
                .get(event.playerId)!
                .delete((event as DotExpireEvent).label.short);
        } else if (event.tags.includes(STATE_TAGS.damageApplication)) {
            const damageApplication = event as DamageApplicationEvent;
            this.damageEvents.push(
                new DamageInstance(
                    damageApplication.playerId,
                    damageApplication.actionName,
                    damageApplication.potency,
                    this.encounterTime,
                    false,
                ),
            );
        }
    }

    /**
     * Return which player should be simulated next.
     * isActionGcd maps every player that needs simulating to a boolean of whether their next
     * action is a GCD (in which case they must wait for the GCD roll to act) or some other action
     * (in which case they must wait for the animation lock to conclude).
     *
     * If multiple players are tied, the first encountered player among them is returned.
     */
    private findNextToSim(isActionGcd: Map<PlayerId, boolean>): PlayerId {
        console.assert(isActionGcd.size > 0, "no players to sim");
        const remaining = Array.from(isActionGcd.entries()).map(
            ([id, isGcd]) => [
                id,
                isGcd
                    ? this.playerStates.get(id)!.gcdRemaining
                    : this.playerStates.get(id)!.inactionableRemaining,
            ],
        );
        remaining.sort((o1, o2) => o1[1] - o2[1]);
        return remaining[0][0];
    }

    /**
     * Elapse time until the GCD lockout of the player, if any, is over.
     * Does nothing if the player is not currently in GCD lock.
     */
    private simToNextGcd(id: PlayerId) {
        while (!this.playerStates.get(id)!.canDoGcd()) {
            for (const expired of this.coordinator.elapseMinDuration()) {
                this.processEvent(expired);
            }
        }
    }

    /**
     * Elapse time until the current animation lock of the player, hard cast, or other
     * action-preventing status is gone.
     * Does nothing if the player is currently actionable.
     */
    private simToNextActionable(id: PlayerId) {
        while (!this.playerStates.get(id)!.canDoOgcd()) {
            for (const expired of this.coordinator.elapseMinDuration()) {
                this.processEvent(expired);
            }
        }
    }

    /**
     * Elapse time until the specified timestamp has been reached.
     */
    public simToTime(ts: Seconds) {
        console.assert(this.encounterTime <= ts);
        // process events on the exact timestamp as well
        while (this.encounterTime <= ts) {
            const peek = this.coordinator.peekNextElapseTime();
            if (peek === undefined) {
                // no more events to process: safe to elapse
                this.coordinator.elapseTimers(ts - this.encounterTime);
                return;
            }
            for (const expired of this.coordinator.elapseMinDuration()) {
                this.processEvent(expired);
            }
        }
    }

    public addAndSimAction<T extends GenericPlayerState>(
        id: PlayerId,
        action: GeneralAction<T>,
    ): Optional<ActionError> {
        // This flag is not perfect, in case we overlap multiple delays/waits/actionables
        let simToActionableAfter = false;
        // Enqueue and perform action
        switch (action.kind) {
            case "spell":
            case "weaponskill":
                // Wait until previous anim lock/GCD is finished
                this.simToNextGcd(id);
                break;
            case "ability":
                // For general actions + oGCDs, wait until previous animation lock
                // or hard cast has completed
                this.simToNextActionable(id);
                break;
            case "timeDelay":
                // TODO use a separate timer tag
                this.simToNextActionable(id);
                simToActionableAfter = true;
                break;
            default:
                throw new Error("action not yet supported: " + action.kind);
        }
        const playerState = this.playerStates.get(id)! as T;
        const validate = action.validateAttempt(playerState);
        if (isOptionalSome(validate)) {
            return validate;
        }
        const result = action.onAttempt(playerState);
        console.log(
            `@${this.encounterTime} finishing attempt of ${action.label.short}`,
            result,
        );
        if (isResultError(result)) {
            return result;
        } else {
            // Update attempt history
            this.attemptEvents
                .get(id)!
                .push({ time: this.encounterTime, label: action.label });
            // Enqueue new events
            for (const info of result) {
                this.coordinator.addTimerWithInfo(info);
            }
        }
        if (simToActionableAfter) {
            this.simToNextActionable(id);
        }
        return undefined;
    }

    /**
     * Simulate every action in the timeline until all player timelines are fully
     * traversed or an error is encountered.
     *
     * Returns a map of player IDs to a list of errors encountered by that player.
     */
    public simTimeline(
        timeline: GlobalTimeline,
    ): Map<PlayerId, { index: number; error: ActionError }> {
        const playerIds = Array.from(this.playerStates.keys());
        const errors = new Map();
        // Track the index of the next action to examine for each player timeline
        const tlIndices = new Map();
        // Stop if we have errored or traversed the whole timeline
        const done = new Map();
        const tls = new Map();
        for (let i = 0; i < playerIds.length; i++) {
            const id = playerIds[i];
            tlIndices.set(id, 0);
            done.set(id, timeline.players[i].actions.length == 0);
            tls.set(playerIds[i], timeline.players[i]);
        }
        while (!Array.from(done.values()).every(Boolean)) {
            const id = this.findNextToSim(
                new Map(
                    playerIds.flatMap((id) =>
                        done.get(id)
                            ? []
                            : [
                                  [
                                      id,
                                      ["spell", "weaponskill"].includes(
                                          tls.get(id).actions[tlIndices.get(id)]
                                              .kind,
                                      ),
                                  ],
                              ],
                    ),
                ),
            );
            const timeline = tls.get(id)!;
            console.assert(
                !done.get(id),
                `${id} was done and should not have been chosen`,
            );
            const i = tlIndices.get(id)!;
            console.assert(
                i < timeline.actions.length,
                `${id} consumed all actions and should not have been chosen`,
            );
            const action = timeline.actions[i];
            const maybeError = this.addAndSimAction(id, action);
            if (isOptionalSome(maybeError)) {
                console.error(maybeError);
                errors.set(id, { index: i, error: maybeError });
                // TODO when an error is encountered, roll gcd/anim lock and attempt to enqueue
                // the next action ASAP instead of exiting early
                done.set(id, true);
                continue;
            }
            tlIndices.set(id, i + 1);
            if (i + 1 >= timeline.actions.length) {
                done.set(id, true);
            }
        }
        return errors;
    }
}
