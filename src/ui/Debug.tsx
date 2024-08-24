import { GlobalState } from "../state/global";
import { PlayerId } from "../utils";

type Etype = {
    player: PlayerId;
    index: number;
    message: string;
};

export default function Debug({
    state,
    errors,
}: {
    state: GlobalState;
    errors: Etype[];
}) {
    return (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
            <div>
                <EventStrings
                    header={"Damage History"}
                    events={state.reprDamageEvents()}
                />
                <EventStrings
                    header={"Attempted Actions"}
                    events={state.reprAttemptEvents()}
                />
                <EventStrings
                    header={"Confirmed Casts"}
                    events={state.reprConfirmEvents()}
                />
            </div>
            <div style={{ width: "50%" }}>
                <Errors errors={errors} />
                <TimerQueue timers={state.coordinator.reprTimers()} />
            </div>
        </div>
    );
}

function EventStrings({
    header,
    events,
}: {
    header: string;
    events: string[];
}) {
    return (
        <>
            <h2>{header}</h2>
            <ul>
                {events.map((line, i) => (
                    <li key={i}>{line}</li>
                ))}
            </ul>
        </>
    );
}

function TimerQueue({ timers }: { timers: string[] }) {
    return (
        <div>
            <h2>Queued Events</h2>
            <ol id="event-queue-parent">
                {timers.map((line, i) => (
                    <li key={i}>
                        <pre style={{ whiteSpace: "pre-wrap" }}>{line}</pre>
                    </li>
                ))}
            </ol>
        </div>
    );
}

function Errors({ errors }: { errors: Etype[] }) {
    return (
        <>
            <h2>Errors</h2>
            <ul>
                {errors.map((e, i) => (
                    <li key={i}>
                        <pre>
                            {e.player}@{e.index}: {e.message}
                        </pre>
                    </li>
                ))}
            </ul>
        </>
    );
}
