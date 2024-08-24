import { useState, useRef, useEffect } from "react";

import Hotbar from "./Hotbar";
import Gauge from "./Gauge";
import {
    ActionSelection,
    CanvasTimeline,
    TextTimeline,
    TL_CANVAS_SCALE,
} from "./Timeline";
import Debug from "./Debug";

import { Coordinator } from "../sim/coordinator";
import { GlobalConfig, PlayerConfig, PlayerStats } from "../state/common";
import { GlobalState } from "../state/global";
import { GenericPlayerState } from "../state/player";
import { BlmState } from "../state/blm";
import { MnkState } from "../state/mnk";
import { GeneralAction, delayBy } from "../actions/common";
import { blmAbilityMap } from "../actions/blm";
import { mnkAbilityMap } from "../actions/mnk";
import { parseAction, PlayerTimeline, GlobalTimeline } from "../timeline";
import { PlayerId } from "../utils";
import { Job } from "../jobs";

interface AppState {
    state: GlobalState;
    activePlayer: PlayerId;
    timeline: GlobalTimeline;
    errors: { player: PlayerId; index: number; message: string }[];
    renderWidthPx: number;
}

// currently, hard code only 2 players (MNK + BLM)
const stats: PlayerStats = { vit: 3464, sps: 824 };
const config: PlayerConfig = PlayerConfig.default();
const newPlayerState = (job: Job, coordinator: Coordinator) => {
    switch (job) {
        case Job.BLM:
            return new BlmState(stats, config, coordinator);
        case Job.MNK:
            return new MnkState(stats, config, coordinator);
        default:
            throw new Error("invalid job: " + job);
    }
};
const newState = (timeline: GlobalTimeline) => {
    const coordinator = new Coordinator(-10);
    return new GlobalState(
        timeline.players.map((tl) => newPlayerState(tl.job, coordinator)),
        GlobalConfig.default(),
    );
};

const newTimeline = () =>
    new GlobalTimeline([
        new PlayerTimeline<MnkState>(
            Job.MNK,
            config,
        ) as PlayerTimeline<GenericPlayerState>,
        new PlayerTimeline<BlmState>(
            Job.BLM,
            config,
        ) as PlayerTimeline<GenericPlayerState>,
    ]);

const storedTl = localStorage.getItem("currentTimeline");
const tl = storedTl
    ? GlobalTimeline.fromJSON(JSON.parse(storedTl))
    : newTimeline();
const errors: { player: PlayerId; index: number; message: string }[] = [];
const _state = newState(tl);
for (const [id, e] of _state.simTimeline(tl)) {
    errors.push({ player: id, index: e.index, message: e.error.message });
}
const initialState: AppState = {
    state: _state,
    activePlayer: parseInt(localStorage.getItem("activePlayer") ?? "0"),
    timeline: tl,
    errors: errors,
    renderWidthPx: Math.max(
        (_state.encounterTime - _state.startTime) * TL_CANVAS_SCALE,
        window.innerWidth,
    ),
};

export default function App() {
    const [appState, setAppState] = useState(initialState);
    const [windowWidth, setWindowWidth] = useState(window.innerWidth);
    const [selected, setSelected] = useState<ActionSelection>({
        kind: "empty",
    });

    // Avoid redrawing the complete canvas on every re-render
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const onResize = () => setWindowWidth(window.innerWidth);
        window.addEventListener("resize", onResize);
        return () => {
            window.removeEventListener("resize", onResize);
        };
    });

    // Global state
    // 1. Event queue (debug only)
    // 2. Error messages
    // 3. Complete damage history (debug only)
    // 4. Boss/encounter timeline + cursor

    // Selected player UI
    // 1. Timeline
    // 2a. Actions + cast/animation locks
    // 2b. Actor tick timer
    // 2c. Damage applications
    // 3. Gauge, resources, and buffs
    // 4. Hotbar
    // 5a. Job + role actions
    // 5b. General actions (delay/wait)

    // TODO if simulating to an exact time would take us past the cursor, add a fake
    // delay event and simulate to its end

    function getPlayerIds() {
        return Array.from(appState.state.playerStates.keys());
    }

    function getActiveState() {
        return appState.state.getPlayerState(appState.activePlayer)!;
    }

    function getActivePlayerTl() {
        const idx = getPlayerIds().indexOf(appState.activePlayer);
        console.assert(idx !== -1);
        return appState.timeline.players[idx];
    }

    function onResetTimeline(player?: PlayerId) {
        if (player === undefined) {
            appState.timeline.players.forEach((p) => p.reset());
        } else {
            const idx = getPlayerIds().indexOf(player);
            appState.timeline.players[idx].reset();
        }
        localStorage.setItem(
            "currentTimeline",
            JSON.stringify(appState.timeline),
        );
        // clear canvas
        if (canvasRef.current) {
            const canvas = canvasRef.current;
            const ctx = canvas.getContext("2d")!;
            const { width, height } = canvas.getBoundingClientRect();
            ctx.clearRect(0, 0, width, height);
        }
        const state = newState(appState.timeline);
        setAppState({
            state: state,
            activePlayer: appState.activePlayer,
            timeline: appState.timeline,
            errors: [],
            renderWidthPx: Math.max(
                (state.encounterTime - state.startTime) * TL_CANVAS_SCALE,
                windowWidth,
            ),
        });
        validateWholeTimeline();
    }

    function appendAction(action: GeneralAction<GenericPlayerState>) {
        console.log("add action " + action.label.long_en);
        getActivePlayerTl().append(action);
        // Update stored value
        localStorage.setItem(
            "currentTimeline",
            JSON.stringify(appState.timeline),
        );
        validateWholeTimeline();
    }

    function onAddAction(actionShort: string) {
        const tl = getActivePlayerTl();
        const newAction = parseAction(tl.job, actionShort);
        appendAction(newAction);
    }

    function deleteActions(id: PlayerId, idxs: number | number[]) {
        const tl = appState.timeline.players[getPlayerIds().indexOf(id)];
        tl.deleteAt(idxs);
        localStorage.setItem(
            "currentTimeline",
            JSON.stringify(appState.timeline),
        );
        validateWholeTimeline();
    }

    function onAddDelay(delay: number) {
        if (!Number.isNaN(delay)) {
            appendAction(delayBy(delay));
        }
    }

    function onSetActivePlayer(player: PlayerId) {
        localStorage.setItem("activePlayer", JSON.stringify(player));
        setAppState({
            ...appState,
            activePlayer: player,
        });
    }

    function validateWholeTimeline() {
        // Validates the timeline starting from the first element.
        // Reports the _first_ encountered error for each player.
        // Reset the sim state to 0 so we don't requeue timers.
        // We cannot make a new state instance because it is passed to child props
        // by reference.
        appState.state.clear();
        const errs: { player: PlayerId; index: number; message: string }[] = [];
        for (const [id, e] of appState.state.simTimeline(appState.timeline)) {
            errs.push({ player: id, index: e.index, message: e.error.message });
        }
        setAppState({
            ...appState,
            errors: errs,
            renderWidthPx: Math.max(
                appState.state.encounterTime * TL_CANVAS_SCALE,
                windowWidth,
            ),
        });
    }

    function getActions() {
        let actions;
        switch (getActivePlayerTl().job) {
            case Job.BLM:
                actions = Array.from(blmAbilityMap.values());
                break;
            case Job.MNK:
                actions = Array.from(mnkAbilityMap.values());
                break;
            default:
                throw new Error("invalid job: " + actions);
        }
        return actions as GeneralAction<GenericPlayerState>[];
    }

    // For debugging
    (window as any).getAppState = () => appState;

    return (
        <div style={{ height: "100%" }}>
            <div style={{ width: "100%" }}>
                {/* TODO dynamically set height based on rendered elements*/}
                <CanvasTimeline
                    canvasRef={canvasRef}
                    // TODO decouple state + timeline since child prop won't see
                    // these fields be reassigned?
                    globalState={appState.state}
                    globalTimeline={appState.timeline}
                    selected={selected}
                    setSelected={(v: ActionSelection) => setSelected(v)}
                    deleteActions={deleteActions}
                    onResetTimeline={onResetTimeline}
                    playerIds={getPlayerIds()}
                    onSetActivePlayer={onSetActivePlayer}
                    renderHeightPx={200 * appState.timeline.players.length}
                    renderWidthPx={appState.renderWidthPx}
                />
            </div>
            <div style={{ display: "flex", width: "100%" }}>
                <div style={{ width: "20%" }}>
                    <Hotbar
                        actions={getActions()}
                        onAddAction={onAddAction}
                        onAddDelay={onAddDelay}
                    />
                </div>
                <div style={{ width: "18%" }}>
                    <Gauge fields={getActiveState().reprGaugeFields()} />
                </div>
                <div style={{ width: "auto" }}>
                    <TextTimeline
                        canvasRef={canvasRef}
                        globalTimeline={appState.timeline}
                        selected={selected}
                        setSelected={(v: ActionSelection) => setSelected(v)}
                        deleteActions={deleteActions}
                        onResetTimeline={onResetTimeline}
                        playerIds={getPlayerIds()}
                        onSetActivePlayer={onSetActivePlayer}
                    />
                </div>
                <div style={{ width: "40%" }}>
                    <Debug state={appState.state} errors={appState.errors} />
                </div>
            </div>
        </div>
    );
}
