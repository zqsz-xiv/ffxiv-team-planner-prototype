import { castTimeFormula } from "../formulas";
import { Label, GENERAL_ACTION_LABELS } from "../labels/common";
import * as GeneralLabels from "../labels/common";
import { TimerInfo, timer_info } from "../sim/timer";
import {
    MP,
    MPCost,
    DamageApplicationEvent,
    HardCastEvent,
    GENERAL_ACTION_TAGS,
    STATE_TAGS,
} from "../state/common";
import { CastConfirmEvent, GenericPlayerState } from "../state/player";
import {
    unimplemented,
    Seconds,
    Result,
    Optional,
    isOptionalSome,
} from "../utils";

export interface ActionError {
    message: string;
}

export type ActionResult = Result<TimerInfo[], ActionError>;

export function isResultError(result: ActionResult): result is ActionError {
    return "message" in result;
}

/**
 * Class representing actions undertaken by the user/player. This is independent of the consequences
 * of the action as seen by the internal simulation.
 *
 * This should not be accessed by other modules -- they should instead use GeneralAction<T>, which
 * acts as a discriminated union on the `kind` property.
 */
interface PlayerAction<T extends GenericPlayerState> {
    label: Label;

    /**
     * Function to validate whether the action can be attempted, returning an ActionError on failure.
     */
    validateAttempt: (state: T) => Optional<ActionError>;

    /**
     * Function that performs arbitrary in-place state changes when the cast of the action
     * is confirmed. This is called regardless of whether or not the spell was hardcasted.
     *
     * Returns a list of events to enqueue, or an error. Technically, the function is allowed to
     * independently enqueue arbitrary events, but this structure is a little cleaner.
     */
    onAttempt: (state: T) => ActionResult;
}

function emptyValidate<T extends GenericPlayerState>(
    _state: T,
): Optional<ActionError> {
    return unimplemented();
}

function emptyOnAttempt<T extends GenericPlayerState>(_state: T): ActionResult {
    return [];
}

export interface Gcd<T extends GenericPlayerState> extends PlayerAction<T> {
    recastTimeFn: (state: T) => Seconds;
    mpCostFn: (state: T) => MPCost;
}

interface DamageInfo {
    potency: number;
    applicationDelay: number;
}

export type Spell<T extends GenericPlayerState> = Gcd<T> & {
    kind: "spell";
    castTimeFn: (state: T) => Seconds;
    damageInfoFn?: (state: T) => DamageInfo;
};

export type CastTimeArg<T extends GenericPlayerState> =
    | ((state: T) => Seconds)
    | Seconds;
export type MpCostArg<T extends GenericPlayerState> =
    | ((state: T) => MPCost)
    | MPCost;
export type DamageInfoArg<T extends GenericPlayerState> =
    | ((state: T) => DamageInfo)
    | DamageInfo;

// because of runtime type erasure, we cannot parametrize over the return value of the fn
function defaultOrNumberToFn<T extends GenericPlayerState>(
    defaultValue: number,
    arg?: ((state: T) => number) | number,
): (state: T) => number {
    if (arg === undefined) {
        return (_state) => defaultValue;
    } else if (typeof arg === "number") {
        return (_state) => arg;
    } else {
        return arg;
    }
}

export function spell<T extends GenericPlayerState>(
    label: Label,
    recastTime: CastTimeArg<T>,
    mpCost: MpCostArg<T>,
    castTime: CastTimeArg<T>,
    damageInfo: DamageInfoArg<T>,
    jobValidateAttempt?: (state: T) => Optional<ActionError>,
    // jobIsInstant should only be called once because it may have the side effect of consuming buffs
    jobIsInstant?: (state: T) => boolean,
    jobOnConfirm?: (state: T) => ActionResult,
): Spell<T> {
    const castTimeFn: (state: T) => Seconds = defaultOrNumberToFn(
        2.5,
        castTime,
    );
    const recastTimeFn: (state: T) => Seconds = defaultOrNumberToFn(
        2.5,
        recastTime,
    );
    const mpCostFn: (state: T) => MPCost = defaultOrNumberToFn(0, mpCost);
    const damageInfoFn =
        typeof damageInfo === "function"
            ? damageInfo
            : (_state: T) => damageInfo;
    const jobValidateAttemptFn = jobValidateAttempt ?? emptyValidate;
    const jobIsInstantFn = jobIsInstant ?? ((_state) => true);
    const jobOnConfirmFn = jobOnConfirm ?? ((_state) => []);
    const validateAttempt = (state: T) => {
        // Ensure we are not animation locked or in a GCD roll
        if (!state.canDoGcd()) {
            return { message: "cannot start a new GCD right now" };
        }
        // Ensure we have sufficient mana to cast the spell
        const mpCost = mpCostFn(state);
        if (state.mp.value < mpCost) {
            return {
                message: `not enough mp to cast ${label.short} (need ${mpCost}, have ${state.mp.value}`,
            };
        }
        return jobValidateAttemptFn(state);
    };
    const onAttempt = (state: T) => {
        console.assert(!isOptionalSome(validateAttempt(state)));
        const toQueue = [
            // GCD roll
            timer_info(
                {
                    playerId: state.playerId,
                    tags: [STATE_TAGS.gcdRemaining],
                },
                recastTimeFn(state),
            ),
        ];
        const isInstantCast = jobIsInstantFn(state);
        const damageInfo = damageInfoFn(state);
        const onConfirm = (state: T) => {
            const toQueue = jobOnConfirmFn(state);
            if (isResultError(toQueue)) {
                return toQueue;
            }
            // Register damage application event
            toQueue.push(
                timer_info(
                    {
                        playerId: state.playerId,
                        tags: [STATE_TAGS.damageApplication],
                        actionName: label.short, // TODO use label instead
                        potency: damageInfo.potency,
                        buffs: state.buffList,
                    } as DamageApplicationEvent,
                    damageInfo.applicationDelay,
                ),
            );
            // Deduct mana
            // TODO turn into event
            state.mp.value = state.mp.value - mpCostFn(state);
            return toQueue;
        };
        if (isInstantCast) {
            // Immediately enqueue cast confirm
            toQueue.push(
                timer_info(
                    {
                        playerId: state.playerId,
                        tags: [GENERAL_ACTION_TAGS.castConfirm],
                        onConfirm: onConfirm,
                        label,
                    } as CastConfirmEvent,
                    0.0,
                ),
            );
        } else {
            // Wait until hardcast cast confirm window
            const castTime = castTimeFormula(
                castTimeFn(state),
                state.stats.sps,
            );
            toQueue.push(
                timer_info(
                    {
                        playerId: state.playerId,
                        tags: [GENERAL_ACTION_TAGS.castConfirm],
                        onConfirm: onConfirm,
                        label,
                    } as CastConfirmEvent,
                    castTime - state.config.castConfirmWindow,
                ),
            );
            toQueue.push(
                timer_info(
                    {
                        playerId: state.playerId,
                        tags: [STATE_TAGS.hardCast, STATE_TAGS.inactionable],
                        label: label,
                    } as HardCastEvent,
                    castTime,
                ),
            );
            // Apply caster tax
            toQueue.push(
                timer_info(
                    {
                        playerId: state.playerId,
                        tags: [
                            STATE_TAGS.casterTaxRemaining,
                            STATE_TAGS.inactionable,
                        ],
                    },
                    castTime + state.config.casterTax,
                ),
            );
        }
        return toQueue;
    };
    return {
        kind: "spell",
        label: label,
        castTimeFn: castTimeFn,
        damageInfoFn: damageInfoFn,
        validateAttempt: validateAttempt,
        onAttempt: onAttempt,
        recastTimeFn: recastTimeFn,
        mpCostFn: mpCostFn,
    };
}

// Combo system is encoded into state processing
export type Weaponskill<T extends GenericPlayerState> = Gcd<T> & {
    kind: "weaponskill";
    damageInfo?: DamageInfo;
};

export function weaponskill<T extends GenericPlayerState>(
    label: Label,
    recastTime?: CastTimeArg<T>,
    damageInfo?: DamageInfo,
    jobValidateAttemptFn?: (state: T) => Optional<ActionError>,
    jobOnAttemptFn?: (state: T) => ActionResult,
): Weaponskill<T> {
    const validateAttempt = (state: T) => {
        // Ensure we are not animation locked or in a GCD roll
        if (!state.canDoGcd()) {
            return { message: "cannot start a new GCD right now" };
        }
        return (jobValidateAttemptFn ?? emptyValidate)(state);
    };
    let recastTimeFn: (state: T) => Seconds;
    if (recastTime === undefined) {
        recastTimeFn = (_state) => 2.5;
    } else if (typeof recastTime === "number") {
        recastTimeFn = (_state) => recastTime;
    } else {
        recastTimeFn = recastTime;
    }
    const onAttempt = (state: T) => {
        const toQueue = (jobOnAttemptFn ?? emptyOnAttempt)(state);
        if (isResultError(toQueue)) {
            return toQueue;
        }
        toQueue.push(
            // GCD roll
            timer_info(
                {
                    playerId: state.playerId,
                    tags: [STATE_TAGS.gcdRemaining],
                },
                recastTimeFn(state),
            ),
        );
        if (damageInfo) {
            toQueue.push(
                timer_info(
                    {
                        playerId: state.playerId,
                        tags: [STATE_TAGS.damageApplication],
                        actionName: label.short, // TODO use label instead
                        potency: damageInfo.potency,
                        buffs: state.buffList,
                    } as DamageApplicationEvent,
                    damageInfo.applicationDelay,
                ),
            );
        }
        return toQueue;
    };
    return {
        kind: "weaponskill",
        label: label,
        damageInfo: damageInfo,
        validateAttempt: validateAttempt,
        onAttempt: onAttempt,
        recastTimeFn: recastTimeFn,
        mpCostFn: (_state) => 0,
    };
}

export type Ability<T extends GenericPlayerState> = PlayerAction<T> & {
    kind: "ability";
    animLock: Seconds;
    damageInfo?: DamageInfo;
};

export function ability<T extends GenericPlayerState>(
    label: Label,
    animLock: Seconds,
    damageInfo?: DamageInfo,
    validateAttempt?: (state: T) => Optional<ActionError>,
    onAttempt?: (state: T) => ActionResult,
): Ability<T> {
    return {
        kind: "ability",
        label: label,
        animLock: animLock,
        damageInfo: damageInfo,
        validateAttempt: validateAttempt ?? emptyValidate,
        onAttempt: onAttempt ?? emptyOnAttempt,
    };
}

export type EmptyWeave<T extends GenericPlayerState> = PlayerAction<T> & {
    kind: "emptyWeave";
};

export function emptyWeave<T extends GenericPlayerState>(): EmptyWeave<T> {
    return {
        kind: "emptyWeave",
        label: GENERAL_ACTION_LABELS.EmptyWeave,
        validateAttempt: emptyValidate,
        onAttempt: (state: T) => [
            timer_info(
                {
                    playerId: state.playerId,
                    tags: [
                        GENERAL_ACTION_TAGS.emptyWeave,
                        STATE_TAGS.inactionable,
                    ],
                },
                0.7,
            ),
        ],
    };
}

export type WaitUntilTime<T extends GenericPlayerState> = PlayerAction<T> & {
    kind: "waitUntilTime";
    targetTime: Seconds;
};

export function waitUntil<T extends GenericPlayerState>(
    targetTime: Seconds,
): WaitUntilTime<T> {
    return {
        kind: "waitUntilTime",
        label: GeneralLabels.makeLabelWaitUntil(targetTime),
        targetTime: targetTime,
        validateAttempt: (state: T) => {
            if (state.encounterTime > targetTime) {
                return {
                    message: "cannot wait for a timestamp that already passed",
                };
            }
            return undefined;
        },
        onAttempt: (state: T) => [
            timer_info(
                {
                    playerId: state.playerId,
                    tags: [
                        GENERAL_ACTION_TAGS.waitUntil,
                        STATE_TAGS.inactionable,
                    ],
                },
                targetTime - state.encounterTime,
            ),
        ],
    };
}

export type TimeDelay<T extends GenericPlayerState> = PlayerAction<T> & {
    kind: "timeDelay";
    duration: Seconds;
};

export function delayBy<T extends GenericPlayerState>(
    duration: Seconds,
): TimeDelay<T> {
    return {
        kind: "timeDelay",
        label: GeneralLabels.makeLabelDelayBy(duration),
        duration: duration,
        validateAttempt: (_state: T) => {
            if (duration <= 0.0) {
                return {
                    message: `cannot delay for negative duration ${duration}`,
                };
            }
            return undefined;
        },
        onAttempt: (state: T) => [
            timer_info(
                {
                    playerId: state.playerId,
                    tags: [
                        GENERAL_ACTION_TAGS.delayBy,
                        STATE_TAGS.inactionable,
                    ],
                },
                duration,
            ),
        ],
    };
}

export type WaitForMpValue<T extends GenericPlayerState> = PlayerAction<T> & {
    kind: "waitForMpValue";
    targetValue: MP;
};

export function waitUntilMp<T extends GenericPlayerState>(
    targetValue: MP,
): WaitForMpValue<T> {
    return {
        kind: "waitForMpValue",
        label: GeneralLabels.makeLabelWaitForMp(targetValue),
        targetValue: targetValue,
        validateAttempt: emptyValidate,
        onAttempt: (_state: T) => unimplemented(),
    };
}

export type GeneralAction<T extends GenericPlayerState> =
    | Spell<T>
    | Weaponskill<T>
    | Ability<T>
    | EmptyWeave<T>
    | WaitUntilTime<T>
    | TimeDelay<T>
    | WaitForMpValue<T>;

export function serializePlainText<T extends GenericPlayerState>(
    action: GeneralAction<T>,
): string {
    return action.label.short;
}

// Return an object that can be JSON-serialized
export function serializeJSON<T extends GenericPlayerState>(
    action: GeneralAction<T>,
): unknown {
    switch (action.kind) {
        case "spell":
        case "weaponskill":
        case "ability":
            // TODO figure out how to encode target (DP, heals, etc.)?
            return action.label.short;
        case "emptyWeave":
            return action.label.short;
        case "waitUntilTime":
            return {
                delayUntil: action.targetTime.toFixed(3),
            };
        case "timeDelay":
            return {
                delayFor: action.duration.toFixed(3),
            };
        case "waitForMpValue":
            return {
                waitUntilMp: action.targetValue.toFixed(3),
            };
        default:
            unimplemented();
    }
}

export function parseGeneralAction<T extends GenericPlayerState>(
    s: string,
): GeneralAction<T> {
    s = s.trim();
    const toks = s.split(" ");
    console.assert(toks.length > 0);
    const command = toks[0].toLowerCase();
    function assertArgc(n: number) {
        console.assert(
            toks.length - 1 === n,
            `action ${command} expected ${n} arguments, got ${toks.length - 1}`,
        );
    }
    switch (command) {
        case "emptyWeave":
            return emptyWeave();
        case "delay":
            console.assert(toks.length > 1);
            switch (toks[1]) {
                case "until":
                    console.assert(toks.length > 2);
                    if (toks[2] === "mp") {
                        assertArgc(4);
                        return waitUntilMp(parseInt(toks[3]));
                    } else {
                        assertArgc(3);
                        return waitUntil(parseFloat(toks[2]));
                    }
                case "for":
                    assertArgc(3);
                    return delayBy(parseFloat(toks[2]));
            }
            break;
    }
    throw new Error("cannot parse action " + s);
}

export function parseGeneralActionFromJSON<T extends GenericPlayerState>(
    obj: any,
): GeneralAction<T> {
    if (obj === "emptyweave") {
        return emptyWeave();
    }
    if ("delayUntil" in obj) {
        return waitUntil(parseFloat(obj.delayUntil));
    }
    if ("delayFor" in obj) {
        return delayBy(parseFloat(obj.delayFor));
    }
    if ("waitUntilMp" in obj) {
        return waitUntilMp(parseInt(obj.waitUntilMp));
    }
    throw new Error("cannot parse action " + JSON.stringify(obj));
}
