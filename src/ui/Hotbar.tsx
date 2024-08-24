import { useState } from "react";

import { Label } from "../labels/common";
import { GeneralAction } from "../actions/common";
import { GenericPlayerState } from "../state/player";
import "../styles/hotbar.css";

type OnAddAction = (actionShort: string) => void;
type HotbarProps = {
    actions: GeneralAction<GenericPlayerState>[];
    onAddAction: OnAddAction;
    onAddDelay: (delay: number) => void;
};

export default function Hotbar({
    actions,
    onAddAction,
    onAddDelay,
}: HotbarProps) {
    return (
        <>
            <h2>Job Actions</h2>
            <div id="action-container">
                {actions.map((action, i) => (
                    <JobActionButton
                        key={i}
                        label={action.label}
                        onAddAction={onAddAction}
                    />
                ))}
            </div>
            <h3>General Actions</h3>
            <AddDelayButton onAddDelay={onAddDelay} />
        </>
    );
}

function JobActionButton({
    label,
    onAddAction,
}: {
    label: Label;
    onAddAction: OnAddAction;
}) {
    // TODO blm in the shell uses an SVG overlaid on the skill icon to show
    // cooldown progress
    // when the skill is on CD, apply the skillInactive class to it to darken it
    return (
        <div className="actionButton" title={label.long_en}>
            <img
                src={label.img_href}
                onClick={(_e) => onAddAction(label.short)}
                alt={label.long_en}
                style={{ height: "100%", width: "100%", objectFit: "contain" }}
            />
        </div>
    );
}

function AddDelayButton({
    onAddDelay,
}: {
    onAddDelay: (delay: number) => void;
}) {
    const [delay, setDelay] = useState(NaN);
    return (
        <span>
            Delay for
            <input
                type="number"
                id="delay-value"
                min="0.001"
                max="120"
                step="0.001"
                onChange={(e) => setDelay(e.target.valueAsNumber)}
            ></input>
            seconds
            <button onClick={(_e) => onAddDelay(delay)}>GO</button>
        </span>
    );
}
