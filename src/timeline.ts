import { Job, stringToJob } from "./jobs";
import {
    GeneralAction,
    serializePlainText,
    serializeJSON,
} from "./actions/common";
import { GenericPlayerState } from "./state/player";
import * as BlmActions from "./actions/blm";
import * as MnkActions from "./actions/mnk";
import { PlayerConfig } from "./state/common";
import { unimplemented, Optional, isOptionalSome, Serialize } from "./utils";

const SECTION_MARKER = "#";
const CONFIG_HEADER = "CONFIG";
const ACTIONS_HEADER = "ACTIONS";

type ParsePlainText = (s: string) => GeneralAction<GenericPlayerState>;
type ParseJSON = (o: any) => GeneralAction<GenericPlayerState>;

export function parseAction(
    job: Job,
    s: string,
): GeneralAction<GenericPlayerState> {
    let parseFn: ParsePlainText;
    switch (job) {
        case "blm":
            parseFn = BlmActions.parse as ParsePlainText;
            break;
        case "mnk":
            parseFn = MnkActions.parse as ParsePlainText;
            break;
        default:
            throw new Error("invalid job: " + job);
    }
    return parseFn(s);
}

/**
 * A serializable list of actions taken by a player.
 *
 * A timeline may or may not be valid; simulating it may produce errors. However,
 * simulating the same timeline twice must produce the same player-visible output.
 *
 * Because typescript erases types at runtime, we cannot easily have associated types to
 * set the job string from the parametrized type.
 */
export class PlayerTimeline<T extends GenericPlayerState> implements Serialize {
    job: Job;
    config: PlayerConfig;
    actions: GeneralAction<T>[];
    // TODO save player stats

    constructor(job: Job);
    constructor(job: Job, config: PlayerConfig);
    constructor(job: Job, config: PlayerConfig, actions: GeneralAction<T>[]);
    constructor(job: Job, config?: PlayerConfig, actions?: GeneralAction<T>[]) {
        this.job = job;
        this.config = config ?? PlayerConfig.default();
        this.actions = actions ?? [];
    }

    // === INFO ===
    public get actionCount(): number {
        return this.actions.length;
    }

    // === MUTATION ===
    public append(action: GeneralAction<T>) {
        this.actions.push(action);
    }

    public deleteAt(idxs: number | number[]) {
        const idxsArr = typeof idxs === "number" ? [idxs] : idxs;
        this.actions = this.actions.filter((_, i) => !idxsArr.includes(i));
    }

    public reset() {
        this.actions = [];
    }

    public insert(idx: number, action: GeneralAction<T>) {
        this.actions.splice(idx, 1, action);
    }

    // === SERIALIZATION/DESERIALIZATION ===
    public toPlainText(): string {
        // Allegedly, += to a string is the recommended way to build a large string.
        let txt = `${SECTION_MARKER}${CONFIG_HEADER}\n`;
        txt += `job = ${this.job}\n`;
        txt += this.config.toPlainText();
        txt += "\n";
        txt += `${SECTION_MARKER}${ACTIONS_HEADER}\n`;
        for (const action of this.actions) {
            txt += `${serializePlainText(action)}\n`;
        }
        txt += "\n";
        return txt;
    }

    /**
     * Serializes the timeline in plain text, and generates a download URL
     * to a file containing the serialized timeline.
     *
     * Returns the URL of the created file.
     */
    public toPlainTextFile(): URL {
        // https://stackoverflow.com/questions/21012580/
        // textFile ?? window.URL.revokeObjectURL(textFile)
        // textFile = window.URL.createObjectURL(this.toPlainText())
        return unimplemented();
    }

    public toJSON(): any {
        return {
            job: this.job,
            config: this.config,
            actions: this.actions.map((action) => serializeJSON(action)),
        };
    }

    static fromPlainText(txt: string): PlayerTimeline<GenericPlayerState> {
        const readConfigFields: Record<string, string> = {};
        const actions = [];
        const lines = txt.split("\n");
        // TODO enumify parser state
        let isReadingConfig = false;
        let job: Optional<Job>;
        for (let line of lines) {
            line = line.trim();
            if (line.length === 0) {
                continue;
            }
            if (line === `${SECTION_MARKER}${CONFIG_HEADER}`) {
                isReadingConfig = true;
                continue;
            } else if (line === `${SECTION_MARKER}${ACTIONS_HEADER}`) {
                isReadingConfig = false;
                continue;
            }
            if (isReadingConfig) {
                // TODO properly handle this, since right now we serialize the keys
                // as something other than the field names
                // TODO check uniqueness
                let [key, value] = line.split("=");
                key = key ? key.trim() : "";
                value = value ? value.trim() : "";
                if (key.toLowerCase() === "job") {
                    job = stringToJob(value.toLowerCase());
                } else {
                    readConfigFields[key] = value;
                }
            } else {
                // parse an action
                actions.push(parseAction(job!, line));
            }
        }
        console.assert(isOptionalSome(job), "job must be specified");
        return new PlayerTimeline(
            job!,
            PlayerConfig.fromJSON(readConfigFields),
            actions,
        );
    }

    static fromJSON(obj: any): PlayerTimeline<GenericPlayerState> {
        if (!obj.job || !(typeof obj.job === "string")) {
            throw new Error("must specify job as string");
        }
        const job = stringToJob(obj.job as string);
        const config = PlayerConfig.fromJSON(obj.config ?? {});
        const actionElems = obj.actions ?? [];
        let parseJSON: Optional<ParseJSON>;
        switch (job) {
            case "blm":
                parseJSON = BlmActions.parseJSON as ParseJSON;
                break;
            case "mnk":
                parseJSON = MnkActions.parseJSON as ParseJSON;
                break;
            default:
                throw new Error("invalid job: " + job);
        }
        const actions = actionElems.map(parseJSON!);
        return new PlayerTimeline(job, config, actions);
    }
}

export class GlobalTimeline implements Serialize {
    players: PlayerTimeline<GenericPlayerState>[];

    constructor();
    constructor(players: PlayerTimeline<GenericPlayerState>[]);
    constructor(players?: PlayerTimeline<GenericPlayerState>[]) {
        this.players = players ?? [];
    }

    public toPlainText(): string {
        unimplemented();
    }

    public toJSON(): any {
        return {
            players: this.players.map((tl) => tl.toJSON()),
        };
    }

    static fromJSON(obj: any): GlobalTimeline {
        return new GlobalTimeline(
            ((obj.players ?? []) as Array<any>).map((o) =>
                PlayerTimeline.fromJSON(o),
            ),
        );
    }
}
