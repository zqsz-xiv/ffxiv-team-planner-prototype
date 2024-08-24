export interface Label {
    short: string;
    long_en: string;
    img_href: string;
}

/** Retrieves an icon (usually 40x40) from xivapi. */
export function xivapi_img(path: string): string {
    return new URL(path, "https://xivapi.com/i/").toString();
}

export function label(
    short: string,
    long_en: string,
    img_href?: string,
): Label {
    return { short: short, long_en: long_en, img_href: img_href ?? "missing" };
}

export const GENERAL_ACTION_LABELS: Record<string, Label> = {
    EmptyWeave: label("empty", "Empty weave slot"),
};

export function makeLabelWaitUntil(targetTime: number) {
    return label(
        `delay until ${targetTime.toFixed(3)}`,
        `Delay until timestamp ${targetTime.toFixed(3)}`,
    );
}

export function makeLabelDelayBy(duration: number) {
    return label(
        `delay by ${duration.toFixed(3)}`,
        `Delay by ${duration.toFixed(3)} seconds`,
    );
}

export function makeLabelWaitForMp(target: number) {
    return label(
        `delay until mp ${target.toFixed(0)}`,
        `Delay until MP reaches ${target.toFixed(0)}`,
    );
}

const LB_ICON = xivapi_img("000000/000103.png");

export const LB_LABELS = {
    TankLB1: label("LB1", "Shield Wall", LB_ICON),
    TankLB2: label("LB2", "Stronghold", LB_ICON),
    PLDLB3: label("LB3", "Last Bastion", LB_ICON),
    WARLB3: label("LB3", "Land Waker", LB_ICON),
    DRKLB3: label("LB3", "Dark Force", LB_ICON),
    GNBLB3: label("LB3", "Gunmetal Soul", LB_ICON),
    HealerLB1: label("LB1", "Healing Wind", LB_ICON),
    HealerLB2: label("LB2", "Breath of the Earth", LB_ICON),
    WHMLB3: label("LB3", "Pulse of Life", LB_ICON),
    SCHLB3: label("LB3", "Angel Feathers", LB_ICON),
    ASTLB3: label("LB3", "Astral Stasis", LB_ICON),
    SGELB3: label("LB3", "Techne Makre", LB_ICON),
    MeleeLB1: label("LB1", "Braver", LB_ICON),
    MeleeLB2: label("LB2", "Bladedance", LB_ICON),
    MNKLB3: label("LB3", "Final Heaven", LB_ICON),
    DRGLB3: label("LB3", "Dragonsong Dive", LB_ICON),
    NINLB3: label("LB3", "Chimatsuri", LB_ICON),
    SAMLB3: label("LB3", "Doom of the Living", LB_ICON),
    RPRLB3: label("LB3", "The End", LB_ICON),
    RangedLB1: label("LB1", "Big Shot", LB_ICON),
    RangedLB2: label("LB2", "Desperado", LB_ICON),
    BRDLB3: label("LB3", "Sagittarius Arrow", LB_ICON),
    MCHLB3: label("LB3", "Satellite Beam", LB_ICON),
    DNCLB3: label("LB3", "Crimson Lotus", LB_ICON),
    CasterLB1: label("LB1", "Skyshard", LB_ICON),
    CasterLB2: label("LB2", "Starstorm", LB_ICON),
    BLMLB3: label("LB3", "Meteor", LB_ICON),
    SMNLB3: label("LB3", "Teraflare", LB_ICON),
    RDMLB3: label("LB3", "Vermilion Scourge", LB_ICON),
};

export const MELEE_ROLE_ACTION_LABELS = {
    SW: label("Second Wind", "Second Wind"),
    LS: label("Leg Sweep", "Leg Sweep"),
    Bloodbath: label("Bloodbath", "Bloodbath"),
    Feint: label("Feint", "Feint"),
    ArmsLength: label("Arm's Length", "Arm's Length"),
    TN: label("TN", "True North"),
};

export const CASTER_ROLE_ACTION_LABELS = {
    Addle: label("Addle", "Addle"),
    Sleep: label("Sleep", "Sleep"),
    Lucid: label("Lucid", "Lucid Dreaming"),
    Swift: label("Swift", "Swiftcast"),
    Sure: label("Sure", "Surecast"),
};

export const CASTER_ROLE_BUFF_LABELS = {
    Lucid: label("Lucid", "Lucid Dreaming"),
    Swift: label("Swift", "Swiftcast"),
};
