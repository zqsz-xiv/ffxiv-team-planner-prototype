import { MNK_BUFF_LABELS } from "../labels/mnk";
import { Label } from "../labels/common";
import { Coordinator } from "../sim/coordinator";
import { GameEvent } from "../sim/timer";
import { Optional } from "../utils";
import {
    STATE_TAGS,
    BuffExpireEvent,
    StateElement,
    PlayerStats,
    PlayerConfig,
} from "./common";
import { GenericPlayerState } from "./player";

export enum Form {
    Opo = "Opo-Opo",
    Raptor = "Raptor",
    Coeurl = "Coeurl",
}

export function formToLabel(form: Form): Label {
    switch (form) {
        case Form.Opo:
            return MNK_BUFF_LABELS.Opo;
        case Form.Raptor:
            return MNK_BUFF_LABELS.Raptor;
        default:
            return MNK_BUFF_LABELS.Coeurl;
    }
}

export enum Nadi {
    Lunar = "Lunar",
    Solar = "Solar",
}

const FORM_LABEL_MAP = new Map([
    [MNK_BUFF_LABELS.Opo.short, Form.Opo],
    [MNK_BUFF_LABELS.Raptor.short, Form.Raptor],
    [MNK_BUFF_LABELS.Coeurl.short, Form.Coeurl],
]);

export class MnkState extends GenericPlayerState {
    chakra: StateElement<number>;
    beastChakra: Form[];
    nadi: Nadi[];

    constructor(
        stats: PlayerStats,
        config: PlayerConfig,
        globalCoordinator: Coordinator,
    ) {
        super(stats, config, globalCoordinator);
        this.chakra = new StateElement({
            displayText: "Chakra",
            currentValue: 0,
            maxValue: 5,
        });
        this.beastChakra = [];
        this.nadi = [];
    }

    override clearClassState() {
        this.chakra.value = 0;
        this.beastChakra = [];
        this.nadi = [];
    }

    get currentForm(): Optional<Form> {
        const timers = this.globalCoordinator.find(
            this.playerId,
            [STATE_TAGS.buffExpire],
            (event) =>
                FORM_LABEL_MAP.has((event as BuffExpireEvent).label.short),
        );
        if (timers.length > 0) {
            console.assert(
                timers.length === 1,
                "cannot have more than 1 form buff at once",
            );
            const label = (timers[0].event as BuffExpireEvent).label;
            return FORM_LABEL_MAP.get(label.short);
        }
        return undefined;
    }

    public override reprGaugeFields(): Record<string, string> {
        const superGauge = super.reprGaugeFields();
        const chakraCount = this.chakra.value;
        Object.assign(superGauge, {
            chakra: "x".repeat(chakraCount) + "o".repeat(5 - chakraCount),
            beastChakra: this.beastChakra.join(" + "),
            nadi: this.nadi.join(" + "),
        });
        return superGauge;
    }

    protected override processClassEvent(_event: GameEvent) {}
}
