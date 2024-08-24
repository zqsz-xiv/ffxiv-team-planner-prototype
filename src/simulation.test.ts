import { Coordinator } from "./sim/coordinator";
import { Buff, PlayerStats, PlayerConfig, GlobalConfig } from "./state/common";
import { GlobalState } from "./state/global";
import { GenericPlayerState } from "./state/player";
import { BlmState } from "./state/blm";
import { ActionError, GeneralAction, delayBy } from "./actions/common";
import { BLM_BUFF_LABELS } from "./labels/blm";
import * as BlmActions from "./actions/blm";
import { GlobalTimeline, PlayerTimeline } from "./timeline";
import { Optional, isOptionalSome } from "./utils";
import { Job } from "./jobs";

// things to test:
// - general actions (delay, wait for mp, etc.)
// - mp generation w/ differing actor ticks
// - a normal opener w/ sharp at -20
// - precasting a spell w/ damage application before t=0 should error

// - casting a spell with insufficient resources (MP or gauge state)
//    - paradox and xeno should get consumed
// - casting an ogcd that's on cooldown
// - starting a fight with resources

type SimError = Optional<{ index: number; error: ActionError }>;

function simActions(actions: GeneralAction<BlmState>[]): {
    state: GlobalState;
    simError: SimError;
} {
    const coordinator = new Coordinator();
    const stats: PlayerStats = { vit: 3464, sps: 824 };
    const playerState = new BlmState(
        stats,
        PlayerConfig.default(),
        coordinator,
    );
    const state = new GlobalState([playerState], GlobalConfig.default());
    const timeline = new GlobalTimeline([
        new PlayerTimeline(
            Job.BLM,
            PlayerConfig.default(),
            actions,
        ) as PlayerTimeline<GenericPlayerState>,
    ]);
    const errs = state.simTimeline(timeline).get(playerState.playerId);
    return { state: state, simError: errs };
}

beforeEach(() => {
    jest.spyOn(global.console, "error").mockImplementation();
    jest.spyOn(global.console, "assert").mockImplementation(
        (cond: boolean, msg?: string) => {
            if (!cond) {
                throw new Error("console.assert failed:" + (msg ?? ""));
            }
        },
    );
});

afterEach(() => {
    jest.clearAllMocks();
});

function checkError(simError: SimError, index: number, messageMatch: RegExp) {
    expect(simError?.error.message).toMatch(messageMatch);
    expect(simError?.index).toBe(index);
    expect(console.error).toBeCalledTimes(1);
}

function checkNoError(simError: SimError) {
    expect(isOptionalSome(simError)).toBe(false);
    expect(console.error).toBeCalledTimes(0);
}

// GENERIC STATE BEHAVIOR TESTS

test("using a stacks ability too many times waits for the next stack", () => {
    // Error should be reported at index 2, since using 2 back to back Sharpcasts is fine
    const { state: _state, simError } = simActions([
        BlmActions.Sharp,
        BlmActions.Sharp,
        BlmActions.Sharp,
        BlmActions.Sharp,
        BlmActions.Sharp,
    ]);
    checkError(simError, 2, /Sharpcast/);
});

test("using an ability waits too many times error", () => {
    const { state: _state, simError } = simActions([
        BlmActions.TP,
        BlmActions.TP,
    ]);
    checkError(simError, 1, /Transpose/);
});

test("reusing a buff overwrites it", () => {
    const { state, simError } = simActions([
        BlmActions.Sharp,
        BlmActions.Sharp,
    ]);
    checkNoError(simError);
    const playerState = state.playerStates.values().next().value;
    expect(playerState.buffList).toContainEqual(
        new Buff(BLM_BUFF_LABELS.Sharp),
    );
});

test("simulating two players interleaves actions", () => {
    const coordinator = new Coordinator();
    const stats: PlayerStats = { vit: 3464, sps: 824 };
    const state1 = new BlmState(stats, PlayerConfig.default(), coordinator);
    const state2 = new BlmState(stats, PlayerConfig.default(), coordinator);
    const state = new GlobalState([state1, state2], GlobalConfig.default());
    const actions1 = [
        BlmActions.Triple,
        BlmActions.F3,
        BlmActions.F4,
        BlmActions.Despair,
    ];
    const actions2 = [
        delayBy(0.01), // Delay a tiny bit so there's an explicit ordering of damage events
        BlmActions.Triple,
        BlmActions.F3,
        BlmActions.F4,
        BlmActions.Despair,
        delayBy(3), // Delay at the end so damage applications register
    ];
    const timeline = new GlobalTimeline([
        new PlayerTimeline(
            Job.BLM,
            PlayerConfig.default(),
            actions1,
        ) as PlayerTimeline<GenericPlayerState>,
        new PlayerTimeline(
            Job.MNK,
            PlayerConfig.default(),
            actions2,
        ) as PlayerTimeline<GenericPlayerState>,
    ]);
    const errMap = state.simTimeline(timeline);
    checkNoError(errMap.get(state1.playerId));
    checkNoError(errMap.get(state2.playerId));
    // All 3 abilities from each player should have applied
    expect(state.damageEvents.map((event) => event.actionName)).toStrictEqual([
        "F3",
        "F3",
        "F4",
        "F4",
        "Despair",
        "Despair",
    ]);
});

// BLM ABILITY-SPECIFIC TESTS

test("blm double transpose opener", () => {
    // TODO start at -20
    const { state: _state, simError } = simActions([
        BlmActions.Sharp,
        BlmActions.F3,
        BlmActions.T3,
        BlmActions.F4,
        BlmActions.Triple,
        BlmActions.F4,
        // tincture
        BlmActions.F4,
        BlmActions.LL,
        BlmActions.Amp,
        BlmActions.F4,
        BlmActions.Swift,
        BlmActions.Lucid,
        BlmActions.Despair,
        BlmActions.MF,
        BlmActions.Sharp,
        BlmActions.F4,
        BlmActions.Despair,
        BlmActions.TP,
        BlmActions.PD,
        BlmActions.Xeno,
        BlmActions.T3,
        // TODO add WaitForMp
        // TODO remove the micro-wait for TP to come off cd
        delayBy(0.02),
        BlmActions.TP,
        BlmActions.F3,
        BlmActions.F4,
        BlmActions.F4,
        BlmActions.F4,
        BlmActions.Despair,
        BlmActions.B3,
        BlmActions.B4,
        BlmActions.PD,
    ]);
    checkNoError(simError);
});

test("dropping enochian during F4 cancels the cast", () => {
    // At any reasonable sps and starting with slow F3, enochian is dropped during the 6th F4
    // The error won't be until the 7th attempted F4, since eno is no longer up
    const { state, simError } = simActions([
        BlmActions.F3,
        BlmActions.F4,
        BlmActions.F4,
        BlmActions.F4,
        BlmActions.F4,
        BlmActions.F4,
        BlmActions.F4,
        BlmActions.F4,
    ]);
    checkError(simError, 7, /cannot cast .* while not in AF/);
    // Damage history should only contain 5 instances of F4 + 1 F3
    expect(state.damageEvents.length).toBe(6);
});

test("umbral soul cannot be cast outside ice", () => {
    const { state, simError } = simActions([BlmActions.US]);
    checkError(simError, 0, /cannot cast .* while not in UI/);
    const playerState = state.playerStates.values().next().value;
    expect(playerState.afUi.value).toBe(0);
});

test("umbral soul refreshes the timer for 15s", () => {
    const { state, simError } = simActions([
        BlmActions.B3,
        BlmActions.US,
        // Because Umbral Soul is instant cast, the delay
        // begins from immediately after the refresh is applied
        // (in the middle of the GCD roll)
        delayBy(14),
    ]);
    checkNoError(simError);
    const playerState = state.playerStates.values().next().value;
    expect(playerState.enoTimeRemaining).toBeCloseTo(1);
    expect(playerState.afUi.value).toBe(-3);
    expect(playerState.umbralHearts.value).toBe(1);
    // Dropping enochian does not raise an error
    expect(
        isOptionalSome(
            state.addAndSimAction(playerState.playerId, delayBy(1.1)),
        ),
    ).toBe(false);
    expect(playerState.afUi.value).toBe(0);
    expect(playerState.umbralHearts.value).toBe(0);
});

test("triplecast reduces cast time", () => {
    const { state: stateA, simError: simErrorA } = simActions([
        BlmActions.Triple,
        BlmActions.F3,
        BlmActions.F4,
        BlmActions.Despair,
    ]);
    checkNoError(simErrorA);
    const { state: stateB, simError: simErrorB } = simActions([
        BlmActions.F3,
        BlmActions.F4,
        BlmActions.Despair,
    ]);
    checkNoError(simErrorB);
    expect(stateB.encounterTime).toBeGreaterThan(stateA.encounterTime);
});

test("triplecast overwrites remaining stacks", () => {
    const { state, simError } = simActions([BlmActions.Triple, BlmActions.F3]);
    checkNoError(simError);
    const playerState = state.playerStates.values().next().value;
    expect(playerState.buffs.get(BLM_BUFF_LABELS.Triple.short)).toStrictEqual(
        new Buff(BLM_BUFF_LABELS.Triple, 2),
    );
});
