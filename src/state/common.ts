import { Label } from "../labels/common";
import { GameEvent, timer_info, TimerInfo } from "../sim/timer";
import { GenericPlayerState } from "../state/player";
import {
    unimplemented,
    PlayerId,
    Seconds,
    Serialize,
    isOptionalSome,
} from "../utils";

export type MP = number;
export type MPCost = MP;
export type HP = number;

export class PlayerStats {
    /**
     * Basic stats provided by gear, job, race, etc.
     */
    constructor(
        public vit: number,
        public sps: number,
    ) {}
    // TODO
}

export class GlobalConfig {
    constructor(public initialServerTickOfs: Seconds) {
        console.assert(initialServerTickOfs < 3.0);
    }

    static default(): GlobalConfig {
        return GlobalConfig.fromJSON({});
    }

    static fromJSON(obj: any): GlobalConfig {
        return new GlobalConfig(parseFloat(obj.initialServerTickOfs ?? 1.0));
    }
}

export class PlayerConfig implements Serialize {
    constructor(
        public initialActorTickOfs: Seconds,
        public casterTax: Seconds,
        public castConfirmWindow: Seconds,
        public fps: number,
    ) {
        console.assert(initialActorTickOfs < 3.0);
    }

    public toPlainText(): string {
        let txt = "";
        txt += `initial actor tick = ${this.initialActorTickOfs.toFixed(3)}\n`;
        txt += `caster tax = ${this.casterTax.toFixed(3)}\n`;
        txt += `cast confirm window = ${this.castConfirmWindow.toFixed(3)}\n`;
        txt += `fps = ${this.fps.toFixed(0)}\n`;
        return txt;
    }

    public toJSON(): any {
        return {
            initialActorTickOfs: this.initialActorTickOfs,
            casterTax: this.casterTax,
            castConfirmWindow: this.castConfirmWindow,
            fps: this.fps,
        };
    }

    static default(): PlayerConfig {
        return PlayerConfig.fromJSON({});
    }

    static fromJSON(obj: any): PlayerConfig {
        return new PlayerConfig(
            parseFloat(obj.initialActorTickOfs ?? 2.1),
            parseFloat(obj.casterTax ?? 0.1),
            parseFloat(obj.castConfirmWindow ?? 0.5),
            parseInt(obj.fps ?? 120),
        );
    }

    static fromPlainText(_txt: string): PlayerConfig {
        return unimplemented();
    }
}

export class StateElement<T> {
    displayText: string;
    helpText?: string;
    private currentValue: T;
    readonly maxValue?: T;

    constructor(params: {
        displayText: string;
        helpText?: string;
        currentValue: T;
        maxValue?: T;
    }) {
        this.displayText = params.displayText;
        this.helpText = params.helpText;
        this.currentValue = params.currentValue;
        this.maxValue = params.maxValue;
    }

    get value(): T {
        return this.currentValue;
    }

    set value(value: T) {
        this.currentValue = value;
    }

    resetToMax() {
        this.currentValue = this.maxValue!;
    }

    private assertNumeric(addValue: number) {
        if (typeof this.currentValue !== "number") {
            throw TypeError(
                `cannot add ${addValue} to non-numeric property ${this.displayText}`,
            );
        }
    }

    unboundedAdd(addValue: number) {
        this.assertNumeric(addValue);
        this.currentValue = ((this.currentValue as number) + addValue) as T;
    }

    saturatingAdd(addValue: number) {
        this.assertNumeric(addValue);
        this.currentValue = Math.min(
            (this.currentValue as number) + addValue,
            this.maxValue! as number,
        ) as T;
    }
}

export type SecondsState = StateElement<Seconds>;

export class Buff {
    constructor(label: Label);
    constructor(label: Label, stacks: number);
    constructor(
        public label: Label,
        public stacks?: number,
    ) {}

    clone(): Buff {
        if (isOptionalSome(this.stacks)) {
            return new Buff(this.label, this.stacks);
        } else {
            return new Buff(this.label);
        }
    }
}

export class DamageInstance {
    // TODO refactor to instead have base damage, c/dh chance, etc.
    // + active buffs so we can compute distributions
    constructor(
        public playerId: PlayerId,
        public actionName: string,
        public potency: number,
        public appliedAt: Seconds, // purely informational
        public isDot: boolean,
    ) {}
}

export class ComboTrigger {
    constructor(
        public ability: Label,
        public timeRemaining: Seconds,
    ) {}
}

export const LUCID_TICK_VALUE: MP = 550;

export const STATE_TAGS = {
    // discriminant tags
    actorTick: "ACTOR_TICK",
    lucidTick: "LUCID_TICK",
    animLockRemaining: "ANIM_LOCK",
    hardCast: "HARD_CAST",
    casterTaxRemaining: "CASTER_TAX",
    gcdRemaining: "GCD",
    buffGain: "BUFF_APPLY",
    buffExpire: "BUFF_EXPIRE",
    damageApplication: "DAMAGE_APPLY",
    castPrepares: "CAST_PREPARES",
    dotBegin: "DOT_BEGIN",
    dotExpire: "DOT_EXPIRE",
    // shared tags
    inactionable: "INACTIONABLE", // anim lock, hard cast, caster tax
    mpRegen: "MP_REGEN", // lucid or actor tick
};

export type BuffGainEvent = GameEvent & {
    initialState: Buff;
    duration: Seconds;
};

export function buffGainNow<T extends GenericPlayerState>(
    state: T,
    label: Label,
    duration: Seconds,
    stacks?: number,
): TimerInfo {
    return timer_info(
        {
            playerId: state.playerId,
            tags: [STATE_TAGS.buffGain],
            initialState:
                stacks === undefined
                    ? new Buff(label)
                    : new Buff(label, stacks),
            duration: duration,
        } as BuffGainEvent,
        0,
    );
}

export type BuffExpireEvent = GameEvent & {
    label: Label; // assumes buffs are unique
};

export type DotBeginEvent = GameEvent & {
    label: Label;
    duration: Seconds;
    potency: number;
};

export function dotBeginNow<T extends GenericPlayerState>(
    state: T,
    label: Label,
    potency: number,
    duration: Seconds,
): TimerInfo {
    return timer_info(
        {
            playerId: state.playerId,
            tags: [STATE_TAGS.dotBegin],
            label: label,
            potency: potency,
            duration: duration,
        } as DotBeginEvent,
        0,
    );
}

export type DotExpireEvent = GameEvent & {
    label: Label;
};

export type DamageApplicationEvent = GameEvent & {
    // TODO rework so playerId is the target
    actionName: string;
    potency: number;
    buffs: Buff[];
};

export type MpGainEvent = GameEvent & {
    amount: MP;
};

export type HardCastEvent = GameEvent & {
    label: Label; // label of the spell being cast
};

/**
 * Event representing an ability coming off cooldown.
 *
 * Unlike other events, this event is NOT unique per character; for abilities
 * with charges (such as BLM Sharpcast or MCH Ricochet), multiple timers may be
 * running at once.
 */
export type AbilityRefreshEvent = GameEvent & {
    label: Label;
};

export const GENERAL_ACTION_TAGS = {
    emptyWeave: "EMPTY_WEAVE",
    waitUntil: "WAIT_UNTIL",
    delayBy: "DELAY_BY",
    castConfirm: "CAST_CONFIRM", // represents fflogs "prepares" event
    mpGain: "MP_GAIN",
    abilityRefresh: "ABILITY_REFRESH",
};
