// TODO test w/ config

import { PlayerTimeline } from "./timeline";
import { PlayerConfig } from "./state/common";
import * as BlmActions from "./actions/blm";
import { Job } from "./jobs";

const defaultConfig = PlayerConfig.default();

const BLM_STANDARD_LINE = new PlayerTimeline(Job.BLM, defaultConfig, [
    // needed to generate paradox
    BlmActions.F3,
    BlmActions.Despair,
    BlmActions.B3,
    BlmActions.B4,
    BlmActions.PD,
    BlmActions.F3,
    BlmActions.F4,
    BlmActions.F4,
    BlmActions.F4,
    BlmActions.F4,
    BlmActions.PD,
    BlmActions.F4,
    BlmActions.F4,
    BlmActions.Despair,
]);

// TODO deal with default config changing
const PLAINTEXT_BLM_STANDARD_LINE = `#CONFIG
job = blm
initial actor tick = 2.100
caster tax = 0.100
cast confirm window = 0.500
fps = 120

#ACTIONS
F3
Despair
B3
B4
PD
F3
F4
F4
F4
F4
PD
F4
F4
Despair
`;

const JSON_BLM_STANDARD_LINE = {
    job: "blm",
    config: defaultConfig.toJSON(),
    actions: [
        "F3",
        "Despair",
        "B3",
        "B4",
        "PD",
        "F3",
        "F4",
        "F4",
        "F4",
        "F4",
        "PD",
        "F4",
        "F4",
        "Despair",
    ],
};

test("plaintext BLM standard line", () => {
    expect(
        PlayerTimeline.fromPlainText(PLAINTEXT_BLM_STANDARD_LINE),
    ).toStrictEqual(BLM_STANDARD_LINE);
});

test("parsed labels are case-insensitive", () => {
    expect(
        PlayerTimeline.fromPlainText(`#CONFIG
        job = blm
        #ACTIONS
        f3
        f4
        despair
        `),
    ).toStrictEqual(
        new PlayerTimeline(Job.BLM, defaultConfig, [
            BlmActions.F3,
            BlmActions.F4,
            BlmActions.Despair,
        ]),
    );
});

// parse -> serialize need not be idempotent because files are case/spacing-insensitive
test("plaintext serialize -> parse is idempotent", () => {
    expect(
        PlayerTimeline.fromPlainText(BLM_STANDARD_LINE.toPlainText()),
    ).toStrictEqual(BLM_STANDARD_LINE);
});

test("JSON BLM standard line", () => {
    expect(PlayerTimeline.fromJSON(JSON_BLM_STANDARD_LINE)).toStrictEqual(
        BLM_STANDARD_LINE,
    );
});

test("JSON serialize -> parse is idempotent", () => {
    expect(PlayerTimeline.fromJSON(BLM_STANDARD_LINE.toJSON())).toStrictEqual(
        BLM_STANDARD_LINE,
    );
});
