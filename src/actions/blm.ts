import { BLM_BUFF_LABELS, BLM_ACTION_LABELS } from "../labels/blm";
import { Label } from "../labels/common";
import {
    CASTER_ROLE_BUFF_LABELS,
    CASTER_ROLE_ACTION_LABELS,
} from "../labels/common";
import { timer_info } from "../sim/timer";
import { BlmState, BLM_ACTION_TAGS, EnoRefreshEvent } from "../state/blm";
import {
    buffGainNow,
    dotBeginNow,
    AbilityRefreshEvent,
    MPCost,
    MpGainEvent,
    GENERAL_ACTION_TAGS,
} from "../state/common";
import { Seconds, Optional } from "../utils";
import {
    ActionError,
    ActionResult,
    isResultError,
    GeneralAction,
    Spell,
    spell,
    Ability,
    ability,
    parseGeneralAction,
    parseGeneralActionFromJSON,
} from "./common";

type BlmSpell = Spell<BlmState>;
type BlmAbility = Ability<BlmState>;

export const blmAbilityMap: Map<string, GeneralAction<BlmState>> = new Map();

/**
 * Utility function for computing gauge state changes on damaging GCDs.
 * Umbral Soul is implemented manually.
 */
function blm_spell(
    label: Label,
    potency: number,
    applicationDelay: Seconds,
    baseMpCost: "all" | MPCost,
    optionalArgs: {
        validateAttempt?: (state: BlmState) => Optional<ActionError>;
        newAfUi?: (state: BlmState) => number;
        baseCastTime?: Seconds;
        onConfirm?: (state: BlmState) => ActionResult;
    },
): BlmSpell {
    const baseCastTime = optionalArgs.baseCastTime ?? 2.5;
    const validateAttempt =
        optionalArgs.validateAttempt ?? ((_playerState) => undefined);
    const name = label.short;
    // Consume instant cast buffs, if applicable (done before timers roll)
    // Priority of instant cast buff consumption:
    // 1. F3P/T3P (if applicable)
    // 2. Swift
    // 3. Triple
    const isInstantFn = (state: BlmState) =>
        (name === "PD" && state.afUi.value < 0) || // UI paradox
        (name === "F3" && state.tryRemoveBuff(BLM_BUFF_LABELS.FS)) || // F3P
        // bad code, but don't remove T3P here since we need it later on
        (name === "T3" && state.buffs.has(BLM_BUFF_LABELS.TC.short)) || // T3P
        state.tryRemoveBuff(CASTER_ROLE_BUFF_LABELS.Swift) ||
        state.tryDecrementBuff(BLM_BUFF_LABELS.Triple);
    // Perform gauge calculations
    // TODO check how mid-castbar adjustments like auto-ethers and lost font of magic interact with
    // despair/flare MP cost
    const mpCostFn = (state: BlmState) => {
        if (name === "T3" && state.buffs.has(BLM_BUFF_LABELS.TC.short)) {
            baseMpCost = 0;
        }
        let adjustedMpCost = baseMpCost === "all" ? state.mp.value : baseMpCost;
        const afUi = state.afUi.value;
        switch (afUi) {
            case -3:
                if (
                    name === "PD" ||
                    ICE_SPELLS.includes(name) ||
                    FIRE_SPELLS.includes(name)
                ) {
                    adjustedMpCost = 0;
                }
                break;
            case -2:
                if (ICE_SPELLS.includes(name)) adjustedMpCost *= 0.5;
                if (name === "PD" || FIRE_SPELLS.includes(name))
                    adjustedMpCost = 0;
                break;
            case -1:
                if (ICE_SPELLS.includes(name)) adjustedMpCost *= 0.75;
                if (name === "PD" || FIRE_SPELLS.includes(name))
                    adjustedMpCost = 0;
                break;
            case 0:
                break;
            default:
                // in AF
                console.assert(afUi <= 3, "congrats you invented AF" + afUi);
                if (ICE_SPELLS.includes(name)) {
                    adjustedMpCost = 0;
                }
                if (
                    FIRE_SPELLS.includes(name) &&
                    state.umbralHearts.value !== 0
                ) {
                    // Paradox is not affected by umbral hearts, so we don't need to worry about it
                    // Flare is handled because we fixed adjustedMpCost to be all remaining mana
                    adjustedMpCost /= 2;
                }
                break;
        }
        return adjustedMpCost;
    };
    const castTimeFn = (state: BlmState) => {
        const afUi = state.afUi.value;
        let adjustedCastTime = baseCastTime;
        if (afUi === -3 && FIRE_SPELLS.includes(name)) {
            adjustedCastTime *= 0.5;
        } else if (afUi === 3 && ICE_SPELLS.includes(name)) {
            adjustedCastTime *= 0.5;
        }
        // TODO check if LL is applied before or after sps adjustment
        return state.buffs.has(BLM_BUFF_LABELS.CoP.short)
            ? adjustedCastTime * 0.85
            : adjustedCastTime;
    };
    const onConfirm = (state: BlmState) => {
        const newAfUi =
            optionalArgs.newAfUi === undefined
                ? state.afUi.value
                : optionalArgs.newAfUi(state);
        // paradox generation is handled by the eno timer refresh event
        if (["B4", "Freeze"].includes(name)) {
            state.umbralHearts.value = 3;
        } else if (name === "PD") {
            state.paradox.value = false;
        } else if (name === "T3" && BLM_BUFF_LABELS.TC.short in state.buffs) {
            state.tryRemoveBuff(BLM_BUFF_LABELS.TC);
        }
        if (FIRE_SPELLS.includes(name) && name !== "Despair") {
            const umbralHearts = state.umbralHearts.value;
            if (umbralHearts > 0) {
                state.umbralHearts.value = umbralHearts - 1;
            }
        }
        const toQueue = optionalArgs.onConfirm
            ? optionalArgs.onConfirm(state)
            : [];
        if (isResultError(toQueue)) {
            return toQueue;
        }
        // TODO rng proc
        const useSharp =
            ["T3", "Scathe", "F1"].includes(name) ||
            (name === "PD" && state.afUi.value > 0);
        if (useSharp && state.tryRemoveBuff(BLM_BUFF_LABELS.Sharp)) {
            switch (name) {
                case "T3":
                    toQueue.push(buffGainNow(state, BLM_BUFF_LABELS.TC, 40));
                    break;
                case "PD":
                case "F1":
                    toQueue.push(buffGainNow(state, BLM_BUFF_LABELS.FS, 30));
                    break;
                case "Scathe":
                    // TODO double potency
                    break;
            }
        }
        if (TIMER_REFRESH_SPELLS.includes(name)) {
            // Add immediate timer refresh
            toQueue.push(
                timer_info(
                    {
                        playerId: state.playerId,
                        tags: [BLM_ACTION_TAGS.enoRefresh],
                        newAfUi: newAfUi,
                    } as EnoRefreshEvent,
                    0,
                ),
            );
        }
        return toQueue;
    };
    const newSpell = spell(
        label,
        (state) =>
            state.buffs.has(BLM_BUFF_LABELS.CoP.short) ? 0.85 * 2.5 : 2.5,
        mpCostFn,
        castTimeFn,
        {
            // TODO adjust potency for T3P, sharp, enhanced flare
            potency: potency,
            applicationDelay: applicationDelay,
        },
        validateAttempt,
        isInstantFn,
        onConfirm,
    );
    blmAbilityMap.set(label.short.toLowerCase(), newSpell);
    return newSpell;
}

function blm_ability(
    label: Label,
    animLock: Seconds,
    stateFn: (state: BlmState) => ActionResult,
    cd: Seconds,
    requiresEno?: boolean,
    maxCharges?: number,
): BlmAbility {
    const validateAttempt = (state: BlmState) => {
        const cds = state.globalCoordinator.find(
            state.playerId,
            GENERAL_ACTION_TAGS.abilityRefresh,
            (event) => (event as AbilityRefreshEvent).label === label,
        );
        if (cds.length >= (maxCharges ?? 1)) {
            return {
                message: `${
                    label.long_en
                } is on CD for ${cds[0].remaining.toFixed(3)}s`,
            };
        }
        if (requiresEno && state.afUi.value === 0) {
            return {
                message: `cannot use ${label.long_en} while not in AF/UI`,
            };
        }
        return undefined;
    };
    const newAbility = ability(
        label,
        animLock,
        undefined, // damageInfo
        validateAttempt,
        (state: BlmState) => {
            state.registerAnimLock(animLock);
            const events = stateFn(state);
            if (!isResultError(events)) {
                events.push(
                    timer_info(
                        {
                            playerId: state.playerId,
                            tags: [GENERAL_ACTION_TAGS.abilityRefresh],
                            label: label,
                        } as AbilityRefreshEvent,
                        cd,
                    ),
                );
            }
            return events;
        },
    );
    blmAbilityMap.set(label.short.toLowerCase(), newAbility);
    return newAbility;
}

const PLACEHOLDER_ANIM_LOCK = 0.7;

// Application delays copied from BitS source code
export const B1: BlmSpell = blm_spell(BLM_ACTION_LABELS.B1, 180, 0.86, 400, {
    validateAttempt: (playerState) => {
        if (playerState.paradox.value) {
            return { message: "cannot cast B1 while Paradox is available" };
        }
        return undefined;
    },
    newAfUi: (playerState) => {
        const afUi = playerState.afUi.value;
        return afUi === 0 ? -1 : afUi < 0 ? Math.max(afUi - 1, -3) : 0;
    },
});

export const F1: BlmSpell = blm_spell(BLM_ACTION_LABELS.F1, 180, 0.624, 800, {
    validateAttempt: (playerState) => {
        if (playerState.paradox.value) {
            return { message: "cannot cast F1 while Paradox is available" };
        }
        return undefined;
    },
    newAfUi: (playerState) => {
        const afUi = playerState.afUi.value;
        return afUi === 0 ? 1 : afUi > 0 ? Math.min(afUi + 1, 3) : 0;
    },
});

export const TP: BlmAbility = blm_ability(
    BLM_ACTION_LABELS.TP,
    PLACEHOLDER_ANIM_LOCK,
    (state) => {
        let afUi = state.afUi.value;
        if (afUi > 0) {
            afUi = -1;
        } else if (afUi < 0) {
            afUi = 1;
        }
        return [
            timer_info(
                {
                    playerId: state.playerId,
                    tags: [BLM_ACTION_TAGS.enoRefresh],
                    newAfUi: afUi,
                } as EnoRefreshEvent,
                0.0,
            ),
        ];
    },
    5,
);

export const Scathe: BlmSpell = blm_spell(
    BLM_ACTION_LABELS.Scathe,
    100,
    0.668,
    800,
    {},
);
// const HB2 : Spell
export const HF2: BlmSpell = blm_spell(
    BLM_ACTION_LABELS.HF2,
    140,
    1.154,
    1500,
    {
        newAfUi: (_playerState) => 3,
        baseCastTime: 3,
        onConfirm: (state) => [buffGainNow(state, BLM_BUFF_LABELS.EF, 999)],
    },
);
// const T4 : Spell
// const MW : Ability

export const MF: BlmAbility = blm_ability(
    BLM_ACTION_LABELS.MF,
    PLACEHOLDER_ANIM_LOCK,
    // Don't modify mana directly -- instead, enqueue a mana gain event
    (state) => [
        timer_info(
            {
                playerId: state.playerId,
                tags: [GENERAL_ACTION_TAGS.mpGain],
                amount: 3000,
            } as MpGainEvent,
            0.88, // from BitS source (test with MF -> spam despair at 0 mana)
        ),
    ],
    120,
);

export const F3: BlmSpell = blm_spell(BLM_ACTION_LABELS.F3, 260, 1.292, 2000, {
    newAfUi: (_playerState) => 3,
    baseCastTime: 3.5,
});

export const B3: BlmSpell = blm_spell(BLM_ACTION_LABELS.B3, 260, 0.89, 800, {
    newAfUi: (_playerState) => -3,
    baseCastTime: 3.5,
});

// const Freeze : Spell

export const T3: BlmSpell = blm_spell(BLM_ACTION_LABELS.T3, 50, 1.025, 400, {
    onConfirm: (state: BlmState) => [
        dotBeginNow(state, BLM_ACTION_LABELS.T3, 35, 30),
    ],
});

// const T4 : Spell
// const AM : Ability
// const Flare : Spell
export const LL: BlmAbility = blm_ability(
    BLM_ACTION_LABELS.LL,
    PLACEHOLDER_ANIM_LOCK,
    // TODO separate circle of power from ley lines
    (state) => [buffGainNow(state, BLM_BUFF_LABELS.CoP, 30)],
    120,
);

export const Sharp: BlmAbility = blm_ability(
    BLM_ACTION_LABELS.Sharp,
    PLACEHOLDER_ANIM_LOCK,
    (state) => [buffGainNow(state, BLM_BUFF_LABELS.Sharp, 30)],
    30,
    false,
    2,
);

export const B4: BlmSpell = blm_spell(BLM_ACTION_LABELS.B4, 310, 1.156, 800, {
    validateAttempt: (state) => {
        if (state.afUi.value > -1) {
            return { message: "cannot cast B4 while not in UI" };
        }
        return undefined;
    },
});

export const F4: BlmSpell = blm_spell(BLM_ACTION_LABELS.F4, 310, 1.159, 800, {
    validateAttempt: (state) => {
        if (state.afUi.value < 1) {
            return { message: "cannot cast F4 while not in AF" };
        }
        return undefined;
    },
    baseCastTime: 2.8,
});

// const BtL : BlmAbility
export const Triple: BlmAbility = blm_ability(
    BLM_ACTION_LABELS.Triple,
    PLACEHOLDER_ANIM_LOCK,
    (state) => [buffGainNow(state, BLM_BUFF_LABELS.Triple, 15, 3)],
    60,
    false,
    2,
);

export const Despair: BlmSpell = blm_spell(
    BLM_ACTION_LABELS.Despair,
    340,
    0.556,
    "all",
    {
        validateAttempt: (state) => {
            if (state.afUi.value < 1) {
                return { message: "cannot cast Despair while not in AF" };
            }
            if (state.mp.value < 800) {
                return { message: "cannot cast Despair with <800 MP" };
            }
            return undefined;
        },
        baseCastTime: 3.0,
    },
);

// Umbral Soul
export const US: BlmSpell = spell(
    BLM_ACTION_LABELS.US,
    // TODO fix cast/recast for umbral soul under ley lines
    2.5,
    0,
    0,
    { potency: 0, applicationDelay: 0 }, // TODO figure out how to make optional
    // validation
    (state: BlmState) => {
        if (state.afUi.value > -1) {
            return { message: "cannot cast Umbral Soul while not in UI" };
        }
        return undefined;
    },
    // is instant?
    (_state: BlmState) => true,
    // on confirm
    (state: BlmState) => {
        state.umbralHearts.saturatingAdd(1);
        return [
            timer_info(
                {
                    playerId: state.playerId,
                    tags: [BLM_ACTION_TAGS.enoRefresh],
                    newAfUi: Math.max(-3, state.afUi.value - 1),
                } as EnoRefreshEvent,
                0.0,
            ),
        ];
    },
);
blmAbilityMap.set(BLM_ACTION_LABELS.US.short.toLowerCase(), US);

// export const Foul : BlmSpell
export const Xeno: BlmSpell = blm_spell(BLM_ACTION_LABELS.Xeno, 880, 0.63, 0, {
    validateAttempt: (state) => {
        if (state.afUi.value === 0) {
            return { message: "cannot cast Xenoglossy while not in AF/UI" };
        }
        if (state.polyStacks.value < 1) {
            return {
                message: "cannot cast Xenoglossy without polyglot stacks",
            };
        }
        return undefined;
    },
    onConfirm: (state) => {
        state.polyStacks.value = state.polyStacks.value - 1;
        return [];
    },
});

export const Amp: BlmAbility = blm_ability(
    BLM_ACTION_LABELS.Amp,
    PLACEHOLDER_ANIM_LOCK,
    (state) => {
        state.polyStacks.saturatingAdd(1);
        return [];
    },
    120,
    true,
);

export const PD: BlmSpell = blm_spell(BLM_ACTION_LABELS.PD, 500, 0.624, 1600, {
    validateAttempt: (state) => {
        if (!state.paradox.value) {
            return {
                message: "cannot cast Paradox without marker",
            };
        }
        return undefined;
    },
    newAfUi: (state) => {
        const afUi = state.afUi.value;
        if (afUi < 0) {
            return Math.max(-3, afUi - 1);
        }
        if (afUi > 0) {
            return Math.min(3, afUi + 1);
        }
        return afUi;
    },
});

const ICE_SPELLS = ["B1", "HB2", "Freeze", "B3", "B4"];
const FIRE_SPELLS = ["F1", "HF2", "F3", "F4", "Despair", "Flare"];
const TIMER_REFRESH_SPELLS = [
    "B1",
    "F1",
    "HF2",
    "HB2",
    "B3",
    "F3",
    "Flare",
    "Despair",
    "US",
    "PD",
];
// these spells require you to be in AF/UI to cast, so dropping eno mid-cast would cancel them
export const CANCELED_BY_ENO_DROP = ["B4", "F4", "Freeze", "Flare", "Despair"];

// TODO generalize as role actions
export const Addle: BlmAbility = blm_ability(
    CASTER_ROLE_ACTION_LABELS.Addle,
    PLACEHOLDER_ANIM_LOCK,
    (_state) => [],
    90,
);

export const Swift: BlmAbility = blm_ability(
    CASTER_ROLE_ACTION_LABELS.Swift,
    PLACEHOLDER_ANIM_LOCK,
    (state) => [buffGainNow(state, CASTER_ROLE_BUFF_LABELS.Swift, 10)],
    60,
);

export const Lucid: BlmAbility = blm_ability(
    CASTER_ROLE_ACTION_LABELS.Lucid,
    PLACEHOLDER_ANIM_LOCK,
    (state) => [buffGainNow(state, CASTER_ROLE_BUFF_LABELS.Lucid, 21)],
    60,
);

// export const Surecast: BlmAbility
// export const Tincture: BlmAbility
// export const Sprint: BlmAbility

export function parse(s: string): GeneralAction<BlmState> {
    // TODO parse long labels as well
    return blmAbilityMap.get(s.toLowerCase()) ?? parseGeneralAction(s);
}

export function parseJSON(obj: unknown): GeneralAction<BlmState> {
    if (typeof obj === "string" && blmAbilityMap.has(obj.toLowerCase())) {
        return blmAbilityMap.get(obj.toLowerCase())!;
    }
    return parseGeneralActionFromJSON(obj);
}
