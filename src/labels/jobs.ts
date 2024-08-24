import { Label, label } from "./common";
import { Job } from "../jobs";

import mnk_icon from "./mnk.png";
import blm_icon from "./blm.png";

export function getJobLabel(job: Job): Label {
    switch (job) {
        case Job.MNK:
            return JOB_LABELS.MNK;
        case Job.BLM:
            return JOB_LABELS.BLM;
        default:
            throw new Error("invalid job " + job);
    }
}

export const JOB_LABELS = {
    MNK: label("MNK", "Monk", mnk_icon),
    BLM: label("BLM", "Black Mage", blm_icon),
};
