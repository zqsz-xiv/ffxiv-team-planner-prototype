import { Seconds } from "./utils";

// Auto Attack, DoT and HoT Strength: =(1000+INT(130*(Speed-400)/1900))/1000
// Weaponskill and Spell Cast and Global Cooldown Reduction (No Haste Buffs):
// =(INT(GCD*(1000+CEILING(130*(400-Speed)/1900))/10000)/100)

export function castTimeFormula(baseRecast: Seconds, sps: number) {
    // copied from akh morning
    // https://www.akhmorning.com/allagan-studies/modifiers/levelmods/
    const sub = 400;
    const div = 1900;
    // Formula truncates to the nearest 10ms
    return (
        Math.floor(
            (baseRecast *
                1000 *
                (1000 + Math.ceil((130 * (sub - sps)) / div))) /
                10000,
        ) / 100
    );
}
