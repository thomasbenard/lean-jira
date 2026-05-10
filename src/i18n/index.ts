export type LocaleCode = "en" | "fr";

export interface LocaleShape {
  "sync.start": string;
  "sync.statusesFetched": string;
  "sync.sprintsFetched": string;
  "sync.incrementalFrom": string;
  "sync.firstSync": string;
  "sync.issuesFetching": string;
  "sync.issuesFetched": string;
  "sync.done": string;
  "sync.estimationMethodChanged": string;
  "sync.sizeLabelUnrecognized": string;
  "board.missing": string;
  "board.runAutoconfig": string;
  "fakeMode.missingFrozenNow": string;
  "config.authMissing": string;
  "estimation.requiresField": string;
  "estimation.requiresThresholds": string;
  "snapshots.done": string;
  "report.done": string;
  "validateConfig.empty": string;
  "validateConfig.ok": string;
  "validateConfig.entryFound": string;
  "validateConfig.missingLegacy": string;
  "validateConfig.missing": string;
  "validateConfig.available": string;
  "validateConfig.errors": string;
  "autoconfig.emptyBoard": string;
  "autoconfig.singleColumn": string;
  "autoconfig.fakeNotAvailable": string;
  "autoconfig.applying": string;
  "autoconfig.applied": string;
  "autoconfig.wip.stripped": string;
  "autoconfig.dryRunBoardName": string;
  "autoconfig.dryRunDevStart": string;
  "autoconfig.dryRunQueueColumns": string;
  "autoconfig.columnTypesHelp": string;
  "listMetrics.header": string;
  "locale.unknown": string;
}

import { en } from "./en";
import { fr } from "./fr";

const LOCALES: Record<LocaleCode, LocaleShape> = { en, fr };

let current: LocaleShape = en;

export function initLocale(code: string): void {
  if (code === "en" || code === "fr") {
    current = LOCALES[code];
  } else {
    current = en;
    console.warn(t("locale.unknown", { code }));
  }
}

export function t(key: keyof LocaleShape, vars?: Record<string, string | number>): string {
  let str = current[key];
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.split(`{{${k}}}`).join(String(v));
    }
  }
  return str;
}
