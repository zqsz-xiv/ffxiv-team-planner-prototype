import { Label } from "../labels/common";
import { Seconds, PlayerId, Optional, isOptionalSome } from "../utils";
import { Coordinator } from "../sim/coordinator";
import { GameEvent, timer_info } from "../sim/timer";
import { ActionResult, isResultError } from "../actions/common";
import {
    GENERAL_ACTION_TAGS,
    STATE_TAGS,
    StateElement,
    HP,
    MP,
    MpGainEvent,
    ComboTrigger,
    Buff,
    BuffExpireEvent,
    BuffGainEvent,
    HardCastEvent,
    PlayerConfig,
    PlayerStats,
} from "./common";

export type CastConfirmEvent = GameEvent & {
    label: Label;
    onConfirm: (state: GenericPlayerState) => ActionResult;
};

export abstract class GenericPlayerState {
    playerId: PlayerId; // Uniquely identifies each player state to track timers
    comboTriggers: ComboTrigger[];
    buffs: Map<string, Buff>; // Map of Label.short to stacks; expiration is tracked by the timer system.
    stats: PlayerStats;
    mp: StateElement<MP>;
    hp: StateElement<HP>;
    globalCoordinator: Coordinator; // tracks all timers
    config: PlayerConfig;

    constructor(
        stats: PlayerStats,
        config: PlayerConfig,
        globalCoordinator: Coordinator,
    ) {
        this.playerId = globalCoordinator.newPlayerId();
        this.globalCoordinator = globalCoordinator;
        this.config = config;
        this.comboTriggers = [];
        this.buffs = new Map();
        this.stats = stats;
        this.mp = new StateElement({
            displayText: "MP",
            currentValue: 10000,
            maxValue: 10000,
        });
        // Register recurring timers for animation lock, actor ticks, etc.
        this.globalCoordinator.addTimer(
            this.playerId,
            [STATE_TAGS.actorTick, STATE_TAGS.mpRegen],
            config.initialActorTickOfs,
        );
        this.globalCoordinator.addTimer(
            this.playerId,
            [STATE_TAGS.lucidTick, STATE_TAGS.mpRegen],
            0.0, // TODO
        );
        // TODO account for team bonuses
        // TODO modify formula to account for tanks
        // https://www.akhmorning.com/allagan-studies/how-to-be-a-math-wizard/shadowbringers/parameters/#main-attributes
        const jobModHp = 105; // TODO this is only for BLM;
        const maxHp =
            Math.floor((3000 * jobModHp) / 100) +
            Math.floor((stats.vit - 390) * 22.1);
        this.hp = new StateElement({
            displayText: "HP",
            currentValue: maxHp,
            maxValue: maxHp,
        });
    }

    public clear() {
        // the coordinator must have been reset prior to this
        this.comboTriggers = [];
        this.buffs = new Map();
        this.globalCoordinator.addTimer(
            this.playerId,
            [STATE_TAGS.actorTick, STATE_TAGS.mpRegen],
            this.config.initialActorTickOfs,
        );
        this.globalCoordinator.addTimer(
            this.playerId,
            [STATE_TAGS.lucidTick, STATE_TAGS.mpRegen],
            0.0, // TODO
        );
        this.mp.value = this.mp.maxValue!;
        this.hp.value = this.hp.maxValue!;
        this.clearClassState();
    }

    abstract clearClassState(): void;

    get buffList(): Buff[] {
        const buffList = [];
        for (const buff of this.buffs.values()) {
            // clone the buff so stacks are snapshotted
            buffList.push(buff.clone());
        }
        return buffList;
    }

    get encounterTime(): Seconds {
        return this.globalCoordinator.currentTime;
    }

    getTimerRemaining(tags: string): Seconds;
    getTimerRemaining(tags: string[]): Seconds;
    getTimerRemaining(tags: string[] | string): Seconds {
        return (
            this.getTimerRemainingOptional(
                typeof tags === "string" ? [tags] : tags,
            ) ?? 0
        );
    }

    getTimerRemainingOptional(tags: string[]): Optional<Seconds> {
        const timers = this.globalCoordinator.find(this.playerId, tags);
        if (timers.length > 0) {
            // this assertion may change if we decide to model ogcds that occur in the future, though
            // we should have the invariant that ogcds further ahead in the timeline are not yet processed
            console.assert(
                timers.length === 1,
                "cannot be in more than 1 animation lock at once",
            );
            return timers[0].remaining;
        } else {
            return undefined;
        }
    }

    protected cancelTimer(tags: string): void;
    protected cancelTimer(tags: string[]): void;
    protected cancelTimer(tags: string[] | string) {
        this.globalCoordinator.cancel(
            this.playerId,
            typeof tags === "string" ? [tags] : tags,
        );
    }

    get actorTickRemaining(): Seconds {
        return this.getTimerRemaining(STATE_TAGS.actorTick);
    }

    get animLockRemaining(): Seconds {
        return this.getTimerRemaining(STATE_TAGS.animLockRemaining);
    }

    registerTimerWithEvent(event: GameEvent, duration: Seconds) {
        this.globalCoordinator.addTimerWithInfo(timer_info(event, duration));
    }

    private registerBuffExpiration(buffLabel: Label, duration: Seconds) {
        this.registerTimerWithEvent(
            {
                playerId: this.playerId,
                tags: [STATE_TAGS.buffExpire],
                label: buffLabel,
            } as BuffExpireEvent,
            duration,
        );
    }

    private registerActorTick() {
        this.globalCoordinator.addTimer(
            this.playerId,
            [STATE_TAGS.actorTick, STATE_TAGS.mpRegen],
            3.0,
        );
    }

    private registerLucidTick() {
        this.globalCoordinator.addTimer(
            this.playerId,
            [STATE_TAGS.lucidTick, STATE_TAGS.mpRegen],
            3.0,
        );
    }

    registerAnimLock(duration: Seconds) {
        this.globalCoordinator.addTimer(
            this.playerId,
            [STATE_TAGS.animLockRemaining, STATE_TAGS.inactionable],
            duration,
        );
    }

    registerCasterTax() {
        // TODO make private
        this.globalCoordinator.addTimer(
            this.playerId,
            [STATE_TAGS.casterTaxRemaining, STATE_TAGS.inactionable],
            this.config.casterTax,
        );
    }

    registerHardCast(duration: Seconds) {
        // TODO make private
        this.globalCoordinator.addTimer(
            this.playerId,
            [STATE_TAGS.hardCast, STATE_TAGS.inactionable],
            duration,
        );
    }

    get hardCastRemaining(): Seconds {
        return this.getTimerRemaining(STATE_TAGS.hardCast);
    }

    /**
     * If the player is hardcasting, returns the label of the current spell being
     * cast. Returns undefined if not in a hardcast.
     */
    get currentHardCastLabel(): Optional<Label> {
        const timers = this.globalCoordinator.find(this.playerId, [
            STATE_TAGS.hardCast,
        ]);
        if (timers.length === 0) {
            return undefined;
        }
        console.assert(
            timers.length === 1,
            "cannot have more than 1 hardcast for a player",
        );
        return (<HardCastEvent>timers[0].event).label;
    }

    /**
     * If the player is hardcasting, cancels the hard cast, cast confirm, and GCD roll timers.
     * Does nothing if not in a hardcast.
     */
    cancelCurrentHardCast() {
        // TODO generate cast cancel event for visibility
        this.globalCoordinator.cancel(this.playerId, [STATE_TAGS.hardCast]);
        this.globalCoordinator.cancel(this.playerId, [STATE_TAGS.gcdRemaining]);
        // it's fine if the cast confirm has already happened
        this.globalCoordinator.cancel(this.playerId, [
            GENERAL_ACTION_TAGS.castConfirm,
        ]);
    }

    registerGcd(duration: Seconds) {
        this.globalCoordinator.addTimer(
            this.playerId,
            [STATE_TAGS.gcdRemaining],
            duration,
        );
    }

    get inactionableRemaining(): Seconds {
        return Math.max(
            0,
            ...this.globalCoordinator
                .find(this.playerId, [STATE_TAGS.inactionable])
                .map((t) => t.remaining),
        );
    }

    get gcdRemaining(): Seconds {
        return this.getTimerRemaining(STATE_TAGS.gcdRemaining);
    }

    public canDoGcd(): boolean {
        return (
            this.globalCoordinator.find(this.playerId, [
                STATE_TAGS.inactionable,
            ]).length === 0 &&
            this.globalCoordinator.find(this.playerId, [
                STATE_TAGS.gcdRemaining,
            ]).length === 0
        );
    }

    public canDoOgcd(): boolean {
        return (
            this.globalCoordinator.find(this.playerId, [
                STATE_TAGS.inactionable,
            ]).length === 0
        );
    }

    public reprGaugeFields(): Record<string, string> {
        const allBuffTimers =
            this.globalCoordinator.find(this.playerId, STATE_TAGS.buffExpire) ??
            [];
        return {
            buffs:
                allBuffTimers
                    .sort((info) => info.remaining)
                    .map(
                        (info) =>
                            (info.event as BuffExpireEvent).label.short +
                            " for " +
                            info.remaining.toFixed(3),
                    )
                    .join("; ") || "none",
            // comboTriggers: "TODO",
            mp: this.mp.value.toFixed(0),
            hp: this.hp.value.toFixed(0),
            actorTickRemaining: this.actorTickRemaining.toFixed(3),
            animLockRemaining: this.animLockRemaining.toFixed(3),
            hardCastRemaining: this.hardCastRemaining.toFixed(3),
            gcdRemaining: this.gcdRemaining.toFixed(3),
        };
    }

    /**
     * Attempts to remove a buff with the specified label. Returns true if the buff was removed,
     * false if not (this occurs if the buff was not applied in the first place).
     */
    tryRemoveBuff(label: Label) {
        if (this.buffs.has(label.short)) {
            // Cancel the expiry event
            this.globalCoordinator.cancel(
                this.playerId,
                [STATE_TAGS.buffExpire],
                (event) => (<BuffExpireEvent>event).label === label,
            );
            this.buffs.delete(label.short);
            return true;
        }
        return false;
    }

    /**
     * Attempts to decrement the count of a stacking buff, removing it if it hits 0. Returns true if
     * the buff was decremented/removed, false if not (this occurs if the buff was not applied in the first place).
     *
     * If the buff is not stacking, then it is removed as normal.
     */
    tryDecrementBuff(label: Label) {
        if (this.buffs.has(label.short)) {
            let shouldRemove = false;
            const buff = this.buffs.get(label.short)!;
            if (isOptionalSome(buff.stacks)) {
                buff.stacks -= 1;
                if (buff.stacks == 0) {
                    shouldRemove = true;
                }
            } else {
                shouldRemove = true;
            }
            if (shouldRemove) {
                // Cancel the expiry event and drop the buff
                this.globalCoordinator.cancel(
                    this.playerId,
                    [STATE_TAGS.buffExpire],
                    (event) => (<BuffExpireEvent>event).label === label,
                );
                this.buffs.delete(label.short);
            }
            return true;
        }
        return false;
    }

    /**
     * When a timer expires with this player's playerId, this function will be called to process
     * the side effects of that timer.
     *
     * If multiple timers expire simultaneously, the coordinator will make multiple calls to
     * this method.
     */
    processEvent(event: GameEvent) {
        const tags = event.tags;
        console.assert(
            event.playerId === this.playerId,
            `playerId ${this.playerId} tried to process ${JSON.stringify(
                event,
            )}`,
        );
        if (tags.includes(STATE_TAGS.damageApplication)) {
            // TODO rework damage application events so playerId represents the target of the damage
        } else if (tags.includes(STATE_TAGS.actorTick)) {
            // Process actor tick for MP + health regen
            this.mp.saturatingAdd(this.getMpTickValue());
            this.hp.saturatingAdd(this.getHpTickValue());
            // Reset actor tick
            this.registerActorTick();
        } else if (tags.includes(STATE_TAGS.lucidTick)) {
            // Process lucid tick MP regen if the buff is active
            // TODO check if buff is on before increasing MP
            // this.mp.saturatingAdd(LUCID_TICK_VALUE);
            this.registerLucidTick();
        } else if (tags.includes(STATE_TAGS.buffGain)) {
            // Process buff application and overwrite existing
            const buffGainEvent = event as BuffGainEvent;
            // Cancel existing applications of the buff
            // The only "buff" in the game that I can think of that does not overwrite
            // when reapplied is BLU's Winged Reprobation stacks, which increment every
            // time the spell is cast. RDM's Embolden buff is misleading, as the magic-damage
            // buff applied to the RDM is separate from the all-damage buff applied to allies.
            const label = buffGainEvent.initialState.label;
            this.tryRemoveBuff(label);
            this.buffs.set(label.short, buffGainEvent.initialState);
            // Register expiration
            this.registerBuffExpiration(label, buffGainEvent.duration);
        } else if (tags.includes(STATE_TAGS.buffExpire)) {
            // Process buff expirations (distinct from clicking off a buff)
            const buffExpireEvent = event as BuffExpireEvent;
            this.buffs.delete(buffExpireEvent.label.short);
        } else if (tags.includes(GENERAL_ACTION_TAGS.delayBy)) {
            // no-op
        } else if (tags.includes(GENERAL_ACTION_TAGS.castConfirm)) {
            const castConfirmEvent = event as CastConfirmEvent;
            const castResult = castConfirmEvent.onConfirm(this);
            if (isResultError(castResult)) {
                // TODO error handling
            } else {
                for (const timer of castResult) {
                    this.globalCoordinator.addTimerWithInfo(timer);
                }
            }
        } else if (tags.includes(GENERAL_ACTION_TAGS.mpGain)) {
            const mpGainEvent = event as MpGainEvent;
            this.mp.saturatingAdd(mpGainEvent.amount);
        }
        // TODO process combo expiration
        // Perform additional actions specific to classes
        // This is not mutually exclusive with the generic expiry events
        this.processClassEvent(event);
    }

    protected abstract processClassEvent(event: GameEvent): void;

    protected getMpTickValue(): MP {
        return 200;
    }

    protected getHpTickValue(): HP {
        return 0; // TODO
    }
}
