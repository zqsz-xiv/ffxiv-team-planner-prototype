export type Seconds = number;
export type Result<L, R> = L | R;
export type Optional<T> = T | undefined;
export type PlayerId = number;

export function isOptionalSome<T>(optional: Optional<T>): optional is T {
    return optional !== undefined;
}

export function unimplemented(): never {
    throw new Error("unimplemented");
}

export function unreachable(): never {
    throw new Error("unreachable code path");
}

export interface Serialize {
    toPlainText(): string;
    toJSON(): any;
}
