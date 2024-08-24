import * as React from "react";
import { useState, useEffect, RefObject } from "react";

import * as tl from "../timeline";
import { GeneralAction } from "../actions/common";
import { GlobalState } from "../state/global";
import { GenericPlayerState } from "../state/player";
import { Optional, PlayerId, unreachable } from "../utils";
import { Label } from "../labels/common";
import { getJobLabel } from "../labels/jobs";

import "../styles/timeline.css";

export type EmptySelection = {
    kind: "empty";
};

export type SingleSelection = {
    kind: "single";
    playerId: PlayerId;
    idx: number;
};

export type InclusiveRangeSelection = {
    kind: "range";
    playerId: PlayerId;
    // start is the FIRST SELECTED item, and acts as a "pivot" for future selections
    // as such, start < stop does not necessarily hold
    startIdx: number;
    stopIdx: number;
};

export type DiscreteSelection = {
    kind: "discrete";
    playerId: PlayerId;
    idxs: Set<number>;
};

// shift + click creates a range selection, ctrl/cmd + click selects discrete elements
export type ActionSelection =
    | EmptySelection
    | SingleSelection
    | InclusiveRangeSelection
    | DiscreteSelection;

/** Checks whether the specified action is within the selection. */
function isActionSelected(
    selected: ActionSelection,
    playerId: PlayerId,
    actionIdx: number,
): boolean {
    switch (selected.kind) {
        case "empty":
            return false;
        case "single":
            return selected.playerId === playerId && selected.idx === actionIdx;
        case "range": {
            const lowerIdx = Math.min(selected.startIdx, selected.stopIdx);
            const upperIdx = Math.max(selected.startIdx, selected.stopIdx);
            return (
                selected.playerId === playerId &&
                actionIdx >= lowerIdx &&
                actionIdx <= upperIdx
            );
        }
        case "discrete":
            return (
                selected.playerId === playerId && selected.idxs.has(actionIdx)
            );
        default:
            unreachable();
    }
}

type TimelineProps = {
    canvasRef: RefObject<HTMLCanvasElement>;
    globalTimeline: tl.GlobalTimeline;
    playerIds: PlayerId[];
    selected: ActionSelection;
    setSelected: (value: ActionSelection) => void;
    deleteActions: (id: PlayerId, idxs: number | number[]) => void;
    onResetTimeline: (id?: PlayerId) => void;
    onSetActivePlayer: (id: PlayerId) => void;
};

type CanvasTimelineProps = TimelineProps & {
    globalState: GlobalState;
    renderHeightPx: number;
    renderWidthPx: number;
};

type PlayerHeaderProps = {
    label: Label;
    heightPx: number;
    playerId: PlayerId;
    onSetActivePlayer: (id: PlayerId) => void;
};

// number of px per second in the timeline
export const TL_CANVAS_SCALE = 50;

export const ACTION_CANVAS_PX = 40;

export function CanvasTimeline({
    canvasRef,
    globalState,
    globalTimeline,
    playerIds,
    selected,
    setSelected,
    deleteActions,
    onResetTimeline: _onResetTimeline,
    onSetActivePlayer,
    renderHeightPx,
    renderWidthPx,
}: CanvasTimelineProps) {
    const sensList = [
        globalState,
        globalTimeline,
        playerIds,
        renderHeightPx,
        renderWidthPx,
    ];
    // TODO eventually make this em in case we need to support mobile users
    const playerHeight = renderHeightPx / playerIds.length;

    const [pointerStyle, setPointerStyle] = useState("default");

    /**
     * Compute the bounding boxes for each action that has been simulated.
     *
     * Returns a 2D array indexed on players in the state order (not PlayerId),
     * with a list of coordinates corresponding to each action in the timeline as values.
     */
    function getActionCoords(): {
        startX: number;
        startY: number;
        widthPx: number;
        heightPx: number;
        label: Label;
        time: number;
    }[][] {
        // TODO represent this more efficiently
        // can probably just binary search over attempt/confirm events
        return Array.from(globalState.attemptEvents.values()).map(
            (actions, i) =>
                actions.map((action) => {
                    return {
                        startX:
                            (action.time - globalState.startTime) *
                            ACTION_CANVAS_PX,
                        startY: playerHeight * (i + 0.5),
                        widthPx: ACTION_CANVAS_PX,
                        heightPx: ACTION_CANVAS_PX,
                        label: action.label,
                        time: action.time,
                    };
                }),
        );
    }

    function findActionFromMouse(
        e: React.MouseEvent,
    ): Optional<{ playerIdx: number; actionIdx: number }> {
        const actionCoords = getActionCoords();
        // y_i,start = playerHeight * (i + 0.5)
        // y_i,end = y_i,start + ACTION_CANVAS_PX
        // this may be changed later for ogcds and such
        const x = e.nativeEvent.offsetX;
        const y = e.nativeEvent.offsetY;
        const maybePlayerIndex = Math.floor(y / playerHeight - 0.5);
        const maybeStartY = playerHeight * (maybePlayerIndex + 0.5);
        if (
            y > maybeStartY &&
            y < maybeStartY + ACTION_CANVAS_PX &&
            maybePlayerIndex < globalState.attemptEvents.size
        ) {
            // we can't do any math tricks (bar binary searching) to determine which action
            // in the timeline is selected, since they may have varying length
            const actions = actionCoords[maybePlayerIndex];
            for (let i = 0; i < actions.length; i++) {
                const dims = actions[i];
                if (x > dims.startX && x < dims.startX + dims.widthPx) {
                    return { playerIdx: maybePlayerIndex, actionIdx: i };
                }
            }
        }
        return undefined;
    }

    function onMouseMove(e: React.MouseEvent) {
        // If the mouse pointer is over an action, change the pointer style
        const nextPointerStyle =
            findActionFromMouse(e) !== undefined ? "pointer" : "default";
        if (nextPointerStyle !== pointerStyle) {
            setPointerStyle(nextPointerStyle);
        }
    }

    function onClick(e: React.MouseEvent) {
        // Change the selected element as needed
        // check how google sheets does it as a reference
        const newSelected = findActionFromMouse(e);
        if (newSelected === undefined) {
            // Deselect existing
            setSelected({ kind: "empty" });
            return;
        }
        const { playerIdx, actionIdx } = newSelected;
        const newId = playerIds[playerIdx];
        const isRangeSelect = e.shiftKey;
        const isMultiSelect = false; // TODO
        // let isMultiSelect = e.ctrlKey || e.metaKey;
        if (!isRangeSelect && !isMultiSelect) {
            if (isActionSelected(selected, newId, actionIdx)) {
                setSelected({ kind: "empty" });
            } else {
                setSelected({
                    kind: "single",
                    playerId: newId,
                    idx: actionIdx,
                });
            }
        } else if (isRangeSelect) {
            if (selected.kind === "range") {
                if (
                    newId === selected.playerId &&
                    actionIdx === selected.startIdx
                ) {
                    setSelected({ kind: "empty" });
                } else {
                    setSelected({
                        kind: "range",
                        playerId: newId,
                        startIdx: selected.startIdx,
                        stopIdx: actionIdx,
                    });
                }
            } else if (selected.kind === "single") {
                if (isActionSelected(selected, newId, actionIdx)) {
                    setSelected({ kind: "empty" });
                } else {
                    setSelected({
                        kind: "range",
                        playerId: newId,
                        startIdx: selected.idx,
                        stopIdx: actionIdx,
                    });
                }
            } else {
                if (isActionSelected(selected, newId, actionIdx)) {
                    setSelected({ kind: "empty" });
                } else {
                    setSelected({
                        kind: "single",
                        playerId: newId,
                        idx: actionIdx,
                    });
                }
            }
        }
    }

    function onKeyDown(e: React.KeyboardEvent) {
        // Handle deletion of selected events
        // Let undo/redo get handled by global event handlers
        if (selected.kind !== "empty") {
            if (e.key === "Backspace" || e.key === "Delete") {
                if (selected.kind === "single") {
                    deleteActions(selected.playerId, selected.idx);
                } else if (selected.kind === "range") {
                    const lowerIdx = Math.min(
                        selected.startIdx,
                        selected.stopIdx,
                    );
                    const upperIdx = Math.max(
                        selected.startIdx,
                        selected.stopIdx,
                    );
                    deleteActions(
                        selected.playerId,
                        Array.from(
                            { length: upperIdx - lowerIdx + 1 },
                            (_, i) => lowerIdx + i,
                        ),
                    );
                } else if (selected.kind === "discrete") {
                    deleteActions(selected.playerId, Array.from(selected.idxs));
                }
                setSelected({ kind: "empty" });
                e.preventDefault();
            }
        }
    }

    useEffect(() => {
        // Canvas drawing logic
        const ctx = canvasRef.current?.getContext("2d");
        if (ctx) {
            // TODO don't redraw everything?
            // TODO handle resize if actions exceed end of timeline
            ctx.clearRect(0, 0, renderWidthPx, renderHeightPx);
            const actionCoords = getActionCoords();
            // TODO if the cursor is not at the last simulated action,
            // generate a "snapshotstate" event on the global state (we need to sim
            // the whole timeline every time to figure out when a later action should occur)
            actionCoords.forEach((actions, playerIdx) => {
                actions.forEach((dims, actionIdx) => {
                    // TODO save all these images globally
                    const img = new Image(0, 0);
                    img.src = dims.label.img_href;
                    img.onload = () => {
                        if (ctx) {
                            ctx.font = "11px";
                            ctx.drawImage(
                                img,
                                dims.startX,
                                dims.startY,
                                dims.widthPx,
                                dims.heightPx,
                            );
                            ctx.fillText(
                                "@" + dims.time.toFixed(3),
                                dims.startX,
                                dims.startY + 55,
                            );
                            // If the action is selected, frame it
                            if (
                                isActionSelected(
                                    selected,
                                    playerIds.indexOf(playerIdx),
                                    actionIdx,
                                )
                            ) {
                                const selectPadding = 1;
                                ctx.lineWidth = 3;
                                ctx.strokeStyle = "black";
                                ctx.beginPath();
                                ctx.roundRect(
                                    dims.startX - selectPadding,
                                    dims.startY - selectPadding,
                                    dims.widthPx + 2 * selectPadding,
                                    dims.heightPx + 2 * selectPadding,
                                    3,
                                );
                                ctx.stroke();
                            }
                        }
                    };
                });
            });
            console.log(`did draw ${renderWidthPx} x ${renderHeightPx}`);
        }
    }, sensList);
    // TODO add text/tab-traversible fallbacks
    return (
        <div style={{ display: "flex" }}>
            <div style={{ border: "solid", width: renderWidthPx / 5 }}>
                {globalTimeline.players.map((tl, i) => (
                    <PlayerHeaderTile
                        key={i}
                        label={getJobLabel(tl.job)}
                        heightPx={playerHeight}
                        playerId={playerIds[i]}
                        onSetActivePlayer={onSetActivePlayer}
                    />
                ))}
            </div>
            <div style={{ overflow: "scroll clip" }}>
                <canvas
                    ref={canvasRef}
                    height={renderHeightPx}
                    width={renderWidthPx}
                    onMouseMove={onMouseMove}
                    onClick={onClick}
                    onKeyDown={onKeyDown}
                    style={{
                        cursor: pointerStyle,
                    }}
                    tabIndex={-1}
                ></canvas>
                {/* TODO set tabIndex based on the last selected UI element*/}
            </div>
        </div>
    );
}

function PlayerHeaderTile({
    label,
    heightPx,
    playerId,
    onSetActivePlayer,
}: PlayerHeaderProps) {
    return (
        <div
            className="timeline-header"
            style={{ height: heightPx }}
            onClick={(_e) => onSetActivePlayer(playerId)}
        >
            <img src={label.img_href} />
            <p>{label.long_en}</p>
        </div>
    );
}

export function TextTimeline({
    globalTimeline,
    playerIds,
    selected,
    setSelected,
    deleteActions,
    onResetTimeline,
    onSetActivePlayer,
}: TimelineProps) {
    return (
        <>
            <h2>Rotations</h2>
            {/* TODO add confirmation dialogue */}
            <button id="resetTimelines" onClick={(_e) => onResetTimeline()}>
                Reset all player timelines
            </button>
            <div
                style={{
                    columns: globalTimeline.players.length,
                    height: "100%",
                }}
            >
                {globalTimeline.players.map((player, i) => (
                    <PlayerActionText
                        actions={player.actions}
                        playerId={playerIds[i]}
                        key={i}
                        selected={selected}
                        setSelected={setSelected}
                        deleteActions={deleteActions}
                        onSetActivePlayer={onSetActivePlayer}
                        onResetTimeline={onResetTimeline}
                    />
                ))}
            </div>
        </>
    );
}

function PlayerActionText({
    actions,
    playerId,
    selected: _selected,
    setSelected: _setSelected,
    deleteActions: _deleteActions,
    onSetActivePlayer,
    onResetTimeline,
}: {
    actions: GeneralAction<GenericPlayerState>[];
    playerId: PlayerId;
    selected: ActionSelection;
    setSelected: (value: ActionSelection) => void;
    deleteActions: (id: PlayerId, idxs: number | number[]) => void;
    onSetActivePlayer: (id: PlayerId) => void;
    onResetTimeline: (id?: PlayerId) => void;
}) {
    return (
        <div style={{ height: "100%" }}>
            <button onClick={(_e) => onSetActivePlayer(playerId)}>
                Set as active
            </button>
            <button onClick={(_e) => onResetTimeline(playerId)}>
                Reset player timeline
            </button>
            <select
                multiple
                className="rotationParent"
                style={{ width: "80%", height: "90%", gridRow: "2 / -1" }}
            >
                {actions.map((action, i) => (
                    <option key={i}>{action.label.long_en}</option>
                ))}
            </select>
        </div>
    );
}
