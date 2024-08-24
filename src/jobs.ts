export enum Job {
    BLM = "blm",
    MNK = "mnk",
}

export function stringToJob(s: string): Job {
    s = s.replace(/\s/g, "").toLowerCase();
    switch (s) {
        case "blackmage":
            s = "blm";
            break;
        case "monk":
            s = "mnk";
            break;
    }
    return s as Job;
}
