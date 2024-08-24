import { CANCELED_BY_ENO_DROP } from "../actions/blm";
import { Coordinator } from "../sim/coordinator";
import { GameEvent, timer_info } from "../sim/timer";
import { Seconds, Optional, isOptionalSome } from "../utils";
import { MP, StateElement, PlayerStats, PlayerConfig } from "./common";
import { GenericPlayerState } from "./player";

export const BLM_STATE_TAGS = {
    enoExpire: "ENO_EXPIRE",
    polyGain: "POLY_GAIN",
};

export const BLM_ACTION_TAGS = {
    enoRefresh: "ENO_REFRESH", // TODO handle case when eno would expire on the same ms as refresh?
};

export type EnoRefreshEvent = GameEvent & {
    newAfUi: number;
};

export const POLY_TIMER_DURATION: Seconds = 30.0;
export const ENO_TIMER_DURATION: Seconds = 15.0;

export class BlmState extends GenericPlayerState {
    afUi: StateElement<number>; // +3 = AF3, 0 = dropped, -3 = UI3
    umbralHearts: StateElement<number>;
    paradox: StateElement<boolean>;
    polyStacks: StateElement<number>;

    constructor(
        stats: PlayerStats,
        config: PlayerConfig,
        globalCoordinator: Coordinator,
    ) {
        super(stats, config, globalCoordinator);
        this.afUi = new StateElement({
            displayText: "Astral Fire/Umbral Ice",
            currentValue: 0,
        });
        this.umbralHearts = new StateElement({
            displayText: "Umbral Hearts",
            currentValue: 0,
            maxValue: 3,
        });
        this.paradox = new StateElement({
            displayText: "Paradox marker",
            currentValue: false,
        });
        this.polyStacks = new StateElement<Seconds>({
            displayText: "Polyglot stacks",
            currentValue: 0,
            maxValue: 2,
        });
    }

    override clearClassState() {
        this.afUi.value = 0;
        this.umbralHearts.value = 0;
        this.paradox.value = false;
        this.polyStacks.value = 0;
    }

    public override reprGaugeFields(): Record<string, string> {
        const superGauge = super.reprGaugeFields();
        const afUi = this.afUi.value;
        let aspectString;
        if (afUi > 0) {
            aspectString = "AF" + afUi;
        } else if (afUi < 0) {
            aspectString = "UI" + -afUi;
        } else {
            aspectString = "none";
        }
        Object.assign(superGauge, {
            afUi: aspectString,
            umbralHearts:
                afUi !== 0 ? this.umbralHearts.value.toString() : "n/a",
            paradox: this.paradox.value ? "y" : "n",
            enoTimerRemaining: this.enoTimeRemaining?.toFixed(3) ?? "n/a",
            polyTimerRemaining: this.polyTimeRemaining?.toFixed(3) ?? "n/a",
            polyStacks: this.polyStacks.value.toString(),
        });
        return superGauge;
    }

    public get enoTimeRemaining(): Optional<Seconds> {
        return this.getTimerRemainingOptional([BLM_STATE_TAGS.enoExpire]);
    }

    public get polyTimeRemaining(): Optional<Seconds> {
        return this.getTimerRemainingOptional([BLM_STATE_TAGS.polyGain]);
    }

    protected override processClassEvent(event: GameEvent) {
        const tags = event.tags;
        if (tags.includes(BLM_STATE_TAGS.enoExpire)) {
            // Enochian should be dropped
            this.afUi.value = 0;
            this.umbralHearts.value = 0;
            // Cancel polyglot timer
            this.cancelTimer(BLM_STATE_TAGS.polyGain);
            // Cancel hardcasts of F4, B4, etc.
            const currentCastLabel = this.currentHardCastLabel;
            if (
                isOptionalSome(currentCastLabel) &&
                CANCELED_BY_ENO_DROP.includes(currentCastLabel.short)
            ) {
                this.cancelCurrentHardCast();
            }
        } else if (tags.includes(BLM_STATE_TAGS.polyGain)) {
            // Generate a new polyglot stack
            this.polyStacks.saturatingAdd(1);
            // Reset polyglot timer
            this.globalCoordinator.addTimer(
                this.playerId,
                [BLM_STATE_TAGS.polyGain],
                POLY_TIMER_DURATION,
            );
        } else if (tags.includes(BLM_ACTION_TAGS.enoRefresh)) {
            const refreshInfo = event as EnoRefreshEvent;
            // Reset enochian drop timer
            this.globalCoordinator.addOrResetTimer(
                this.playerId,
                [BLM_STATE_TAGS.enoExpire],
                ENO_TIMER_DURATION,
            );
            // Compute paradox marker generation
            const oldAfUi = this.afUi.value;
            const newAfUi = refreshInfo.newAfUi;
            if (
                (newAfUi > 0 &&
                    oldAfUi === -3 &&
                    this.umbralHearts.value === 3) ||
                (newAfUi < 0 && oldAfUi === 3)
            ) {
                this.paradox.value = true;
            }
            this.afUi.value = newAfUi;
            // If we were not already in AF/UI, start Polyglot timer
            if (oldAfUi === 0) {
                this.globalCoordinator.addOrResetTimerWithInfo(
                    timer_info(
                        {
                            playerId: this.playerId,
                            tags: [BLM_STATE_TAGS.polyGain],
                        },
                        POLY_TIMER_DURATION,
                    ),
                );
            }
        }
        // TODO remove enhanced flare buff if we leave fire
    }

    override getMpTickValue(): MP {
        const afUi = this.afUi.value;
        switch (afUi) {
            case 0: // neutral stance, standard 200 mana
                return 200;
            case -1:
                return 3200;
            case -2:
                return 4700;
            case -3:
                return 6200;
            default: // in AF, no mana for you
                return 0;
        }
    }
}
