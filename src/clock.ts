let frozen: Date | null = null;

export function initClock(iso?: string): void {
  frozen = iso ? new Date(iso) : null;
}

export function now(): Date {
  return frozen ? new Date(frozen) : new Date();
}
