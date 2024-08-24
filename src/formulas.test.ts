import { castTimeFormula } from "./formulas";

test.each([
    [400, 2.5],
    [401, 2.5],
    [414, 2.5],
    [415, 2.49],
    [1291, 2.35],
    [1292, 2.34],
    [2636, 2.12],
    [2637, 2.11],
])("2.5 base recast, sps=%d", (sps: number, expected: number) => {
    expect(castTimeFormula(2.5, sps)).toBe(expected);
});

test.each([
    [400, 2.8],
    [401, 2.8],
    [414, 2.8],
    [415, 2.79],
    [1291, 2.63],
    [1292, 2.62],
    [2636, 2.37],
    [2637, 2.37], // not a 2.8 tier
    [2650, 2.37],
    [2651, 2.36],
])("2.8 base recast, sps=%d", (sps: number, expected: number) => {
    expect(castTimeFormula(2.8, sps)).toBe(expected);
});
