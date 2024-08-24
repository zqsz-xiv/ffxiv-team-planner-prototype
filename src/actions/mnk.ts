import { MNK_BUFF_LABELS, MNK_ACTION_LABELS } from "../labels/mnk";
import { Label } from "../labels/common";
import { timer_info } from "../sim/timer";
import { MnkState, Form, formToLabel } from "../state/mnk";
import {
    Buff,
    BuffGainEvent,
    buffGainNow,
    dotBeginNow,
    // AbilityRefreshEvent,
    STATE_TAGS,
} from "../state/common";
import { Seconds } from "../utils";
import {
    ActionResult,
    isResultError,
    GeneralAction,
    Weaponskill,
    weaponskill,
    // Ability,
    // ability,
    parseGeneralAction,
    parseGeneralActionFromJSON,
} from "./common";

type MnkSkill = Weaponskill<MnkState>;
// type MnkAbility = Ability<MnkState>;

export const mnkAbilityMap: Map<string, GeneralAction<MnkState>> = new Map();

function mnk_skill(
    label: Label,
    potency: number,
    applicationDelay: Seconds,
    optionalArgs: {
        requiredForm?: Form;
        newForm?: Form;
        onConfirm?: (state: MnkState) => ActionResult;
    },
): MnkSkill {
    const recast = 2.0;
    const requiredForm = optionalArgs.requiredForm;
    const validateAttempt = (state: MnkState) => {
        if (
            requiredForm &&
            (!state.currentForm || state.currentForm != requiredForm)
        ) {
            const expFormStr = formToLabel(requiredForm).long_en;
            const currFormStr = state.currentForm
                ? formToLabel(state.currentForm).long_en
                : "no form";
            return {
                message: `must be in ${expFormStr} to cast ${label.long_en} (was in ${currFormStr})`,
            };
        }
        return undefined;
    };
    // TODO check if form/buff effects are applied on hit, or on cast
    const onAttempt = (state: MnkState) => {
        const toQueue = optionalArgs.onConfirm
            ? optionalArgs.onConfirm(state)
            : [];
        if (isResultError(toQueue)) {
            return toQueue;
        }
        if (optionalArgs.newForm) {
            // TODO do this more elegantly
            state.tryRemoveBuff(MNK_BUFF_LABELS.Opo);
            state.tryRemoveBuff(MNK_BUFF_LABELS.Raptor);
            state.tryRemoveBuff(MNK_BUFF_LABELS.Coeurl);
            // Set new form
            toQueue.push(
                timer_info(
                    {
                        playerId: state.playerId,
                        tags: [STATE_TAGS.buffGain],
                        initialState: new Buff(
                            formToLabel(optionalArgs.newForm),
                        ),
                        duration: 30,
                    } as BuffGainEvent,
                    0,
                ),
            );
        }
        return toQueue;
    };
    const newSkill = weaponskill(
        label,
        recast,
        {
            potency: potency,
            applicationDelay: applicationDelay,
        },
        validateAttempt,
        onAttempt,
    );
    mnkAbilityMap.set(label.short.toLowerCase(), newSkill);
    return newSkill;
}

// const PLACEHOLDER_ANIM_LOCK = 0.7;
const PLACEHOLDER_APPLICATION_DELAY = 0.1; // TODO look up from the balance

export const Boot: MnkSkill = mnk_skill(
    MNK_ACTION_LABELS.Boot,
    // TODO add form potency
    210,
    PLACEHOLDER_APPLICATION_DELAY,
    {
        newForm: Form.Raptor,
    },
);

export const TrueStrike: MnkSkill = mnk_skill(
    MNK_ACTION_LABELS.TrueStrike,
    300,
    PLACEHOLDER_APPLICATION_DELAY,
    {
        requiredForm: Form.Raptor,
        newForm: Form.Coeurl,
    },
);

export const Snap: MnkSkill = mnk_skill(
    MNK_ACTION_LABELS.Snap,
    // TODO add positional detection
    310,
    PLACEHOLDER_APPLICATION_DELAY,
    {
        requiredForm: Form.Coeurl,
        newForm: Form.Opo,
    },
);

// export const Meditation

export const Twin: MnkSkill = mnk_skill(
    MNK_ACTION_LABELS.Twin,
    280,
    PLACEHOLDER_APPLICATION_DELAY,
    {
        requiredForm: Form.Raptor,
        newForm: Form.Coeurl,
        onConfirm: (state) => [buffGainNow(state, MNK_BUFF_LABELS.Disc, 15)],
    },
);

export const Demolish: MnkSkill = mnk_skill(
    MNK_ACTION_LABELS.Demo,
    130,
    PLACEHOLDER_APPLICATION_DELAY,
    {
        requiredForm: Form.Coeurl,
        newForm: Form.Opo,
        onConfirm: (state) => [
            dotBeginNow(state, MNK_ACTION_LABELS.Demo, 70, 18),
        ],
    },
);

// export const Thunderclap
// export const Mantra

export const DK: MnkSkill = mnk_skill(
    MNK_ACTION_LABELS.DK,
    320,
    PLACEHOLDER_APPLICATION_DELAY,
    {
        newForm: Form.Raptor,
        onConfirm: (state) => [buffGainNow(state, MNK_BUFF_LABELS.Lead, 30)],
    },
);

export function parse(s: string): GeneralAction<MnkState> {
    return mnkAbilityMap.get(s.toLowerCase()) ?? parseGeneralAction(s);
}

export function parseJSON(obj: unknown): GeneralAction<MnkState> {
    if (typeof obj === "string" && mnkAbilityMap.has(obj.toLowerCase())) {
        return mnkAbilityMap.get(obj.toLowerCase())!;
    }
    return parseGeneralActionFromJSON(obj);
}
