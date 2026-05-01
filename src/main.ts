import { Command } from "commander";
import fs from "fs";
import yaml from "yaml";
import path from "path";
import Database from "better-sqlite3";
import { sync } from "./sync";
import { openDb, getDoneStatusNames, getAllStatuses } from "./db/store";
import { runAllMetrics, runMetric, ALL_METRICS } from "./metrics/index";
import { BUCKET_LABELS, BUCKET_ORDER, SizeBucket } from "./metrics/utils";
import { backfillSnapshots } from "./snapshots/compute";
import { generateReport } from "./report/generate";
import { MetricConfig } from "./metrics/types";

type ColumnType = "todo" | "active" | "queue" | "done";

export interface BoardColumn {
  name: string;
  type: ColumnType;
  devStart?: boolean;
  statuses: string[];
  legacyStatuses?: string[];
}

export interface BoardConfig {
  columns: BoardColumn[];
  legacyDoneStatuses?: string[];
}

interface DerivedStatusConfig {
  todoStatuses: string[];
  devStartStatuses: string[];
  inProgressStatuses: string[];
  activeStatuses: string[];
  queueStatuses: string[];
  doneStatuses: string[];
}

export function deriveStatusConfig(board: BoardConfig): DerivedStatusConfig {
  const effectiveStatuses = (c: BoardColumn): string[] => [...c.statuses, ...(c.legacyStatuses ?? [])];
  const byType = (type: ColumnType): string[] =>
    board.columns.filter((c) => c.type === type).flatMap(effectiveStatuses);
  const unique = (arr: string[]): string[] => [...new Set(arr)];

  const active = byType("active");
  const queue = byType("queue");

  return {
    todoStatuses: unique(byType("todo")),
    devStartStatuses: unique(board.columns.filter((c) => c.devStart).flatMap(effectiveStatuses)),
    inProgressStatuses: unique([...active, ...queue]),
    activeStatuses: unique(active),
    queueStatuses: unique(queue),
    doneStatuses: unique([...byType("done"), ...(board.legacyDoneStatuses ?? [])]),
  };
}

export interface ValidationEntry {
  name: string;
  found: boolean;
  isLegacy: boolean;
}

export interface ValidationSection {
  label: string;
  entries: ValidationEntry[];
}

export interface ValidationResult {
  sections: ValidationSection[];
  missingCount: number;
}

const LEGACY_SECTION_LABEL = "doneStatuses";

export function validateStatusConfig(
  sections: Array<{ label: string; statuses: string[] }>,
  dbStatuses: Array<{ name: string; categoryKey: string }>,
  legacyNames?: Set<string>,
): ValidationResult {
  const dbNames = new Set(dbStatuses.map((s) => s.name));
  let missingCount = 0;
  const resultSections: ValidationSection[] = [];

  for (const { label, statuses } of sections) {
    if (statuses.length === 0) continue;
    const entries: ValidationEntry[] = statuses.map((name) => {
      const found = dbNames.has(name);
      const isLegacy = !found && (label === LEGACY_SECTION_LABEL || (legacyNames?.has(name) ?? false));
      if (!found && !isLegacy) missingCount++;
      return { name, found, isLegacy };
    });
    resultSections.push({ label, entries });
  }

  return { sections: resultSections, missingCount };
}

interface AppConfig {
  jira: {
    baseUrl: string;
    email: string;
    apiToken: string;
    projectKey: string;
    boardId: number;
  };
  board: BoardConfig;
  metrics?: {
    cutoffDate?: string;
    bugIssueTypes?: string[];
  };
  db: { path: string };
}

function loadConfig(configPath: string): AppConfig {
  const raw = fs.readFileSync(configPath, "utf-8");
  return yaml.parse(raw) as AppConfig;
}

// Construit le MetricConfig en fusionnant config.yaml + table statuses (statusCategory).
// Tout statut dont category_key='done' est retiré des listes in-progress / active / queue
// et ajouté à doneStatuses. Évite les biais quand un statut "done" du board est listé
// dans inProgressStatuses du config (ex: "À valider" sur le board KECK).
function buildMetricConfig(db: Database.Database, app: AppConfig, opts: { excludeOutliers?: boolean } = {}): MetricConfig {
  const derived = deriveStatusConfig(app.board);
  // Source 1 : statusCategory.key='done' depuis l'API Jira (statuses table).
  // Source 2 : derived.doneStatuses pour les statuts historiques renommés
  //   qui n'apparaissent plus dans l'API mais existent dans l'historique des
  //   transitions (ex: "To Be Validated", "Delivred"). Sans ce fallback, ces
  //   statuts polluent inProgressStatuses.
  const doneSet = new Set([...getDoneStatusNames(db), ...derived.doneStatuses]);
  const filter = (list: string[]): string[] => list.filter((s) => !doneSet.has(s));

  const stripped = {
    inProgress: filter(derived.inProgressStatuses),
    active: filter(derived.activeStatuses),
    queue: filter(derived.queueStatuses),
  };

  const removed = {
    inProgress: derived.inProgressStatuses.filter((s) => doneSet.has(s)),
    active: derived.activeStatuses.filter((s) => doneSet.has(s)),
    queue: derived.queueStatuses.filter((s) => doneSet.has(s)),
  };
  const totalRemoved = removed.inProgress.length + removed.active.length + removed.queue.length;
  if (totalRemoved > 0) {
    const all = [...new Set([...removed.inProgress, ...removed.active, ...removed.queue])];
    console.warn(`  ⚠ ${totalRemoved} statut(s) du config classés 'done' par Jira → exclus du WIP/flow : ${all.join(", ")}`);
  }

  return {
    todoStatuses: derived.todoStatuses,
    devStartStatuses: derived.devStartStatuses,
    inProgressStatuses: stripped.inProgress,
    doneStatuses: [...doneSet],
    activeStatuses: stripped.active,
    queueStatuses: stripped.queue,
    cutoffDate: app.metrics?.cutoffDate,
    excludeOutliers: opts.excludeOutliers !== false,
    bugIssueTypes: app.metrics?.bugIssueTypes ?? ["Bug"],
  };
}

const program = new Command();

program
  .name("lean-jira")
  .description("Métriques Lean depuis Jira Kanban")
  .version("1.0.0");

program
  .command("sync")
  .description("Récupère les données Jira et les stocke en base")
  .option("-c, --config <path>", "Chemin vers config.yaml", "./config.yaml")
  .action(async (opts) => {
    const config = loadConfig(path.resolve(opts.config));
    await sync(config);
  });

program
  .command("metrics")
  .description("Calcule et affiche toutes les métriques depuis la base")
  .option("-c, --config <path>", "Chemin vers config.yaml", "./config.yaml")
  .option("-m, --metric <name>", "Métrique spécifique (optionnel)")
  .option("--json", "Sortie JSON brute")
  .option("--include-outliers", "Inclure les outliers extrêmes (Tukey upper fence) dans les calculs")
  .action((opts) => {
    const config = loadConfig(path.resolve(opts.config));
    const db = openDb(config.db.path);
    const metricConfig = buildMetricConfig(db, config, { excludeOutliers: !opts.includeOutliers });

    const results = opts.metric
      ? { [opts.metric]: runMetric(opts.metric, db, metricConfig) }
      : runAllMetrics(db, metricConfig);

    if (opts.json) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      printResults(results);
    }
  });

program
  .command("snapshots")
  .description("Recalcule l'historique des snapshots hebdomadaires (table metric_snapshots)")
  .option("-c, --config <path>", "Chemin vers config.yaml", "./config.yaml")
  .action((opts) => {
    const config = loadConfig(path.resolve(opts.config));
    const db = openDb(config.db.path);
    const metricConfig = buildMetricConfig(db, config);
    const count = backfillSnapshots(db, metricConfig);
    console.log(`Snapshots recalculés : ${count} dates hebdomadaires.`);
  });

program
  .command("report")
  .description("Génère un rapport HTML autonome (charts trends + KPIs) à partir des snapshots")
  .option("-c, --config <path>", "Chemin vers config.yaml", "./config.yaml")
  .option("-o, --output <path>", "Chemin du fichier HTML de sortie", "./report.html")
  .action((opts) => {
    const config = loadConfig(path.resolve(opts.config));
    const db = openDb(config.db.path);
    const metricConfig = buildMetricConfig(db, config);
    generateReport(db, config.jira.projectKey, config.jira.baseUrl, path.resolve(opts.output), metricConfig);
    console.log(`Rapport généré : ${path.resolve(opts.output)}`);
  });

program
  .command("validate-config")
  .description("Vérifie que les statuts du config existent dans la base (après un sync)")
  .option("-c, --config <path>", "Chemin vers config.yaml", "./config.yaml")
  .action((opts) => {
    const config = loadConfig(path.resolve(opts.config));
    const db = openDb(config.db.path);

    const dbStatuses = getAllStatuses(db);
    if (dbStatuses.length === 0) {
      console.error("Base vide. Lancer `npm run sync` d'abord.");
      process.exit(1);
    }

    const derived = deriveStatusConfig(config.board);
    const sections = [
      { label: "todoStatuses", statuses: derived.todoStatuses },
      { label: "devStartStatuses", statuses: derived.devStartStatuses },
      { label: "inProgressStatuses", statuses: derived.inProgressStatuses },
      { label: "doneStatuses", statuses: derived.doneStatuses },
      { label: "activeStatuses", statuses: derived.activeStatuses },
      { label: "queueStatuses", statuses: derived.queueStatuses },
    ];

    const legacyNames = new Set(config.board.columns.flatMap((c) => c.legacyStatuses ?? []));
    const result = validateStatusConfig(sections, dbStatuses, legacyNames);

    for (const section of result.sections) {
      console.log(`\n${section.label}`);
      for (const entry of section.entries) {
        if (entry.found) {
          console.log(`  ✓ ${entry.name}`);
        } else if (entry.isLegacy) {
          console.log(`  ✗ ${entry.name}  ← introuvable en base (statut legacy — accepté pour l'historique)`);
        } else {
          console.log(`  ✗ ${entry.name}  ← introuvable en base`);
        }
      }
    }

    if (result.missingCount > 0) {
      console.log("\nStatuts disponibles en base :");
      for (const s of dbStatuses) {
        console.log(`  ${s.name.padEnd(30)} (${s.categoryKey})`);
      }
      console.log(`\n${result.missingCount} statut(s) introuvable(s). Vérifier config.yaml.`);
      process.exit(1);
    } else {
      console.log("\n✓ Config valide.");
    }
  });

program
  .command("list-metrics")
  .description("Liste toutes les métriques disponibles")
  .action(() => {
    console.log("Métriques disponibles :");
    for (const m of ALL_METRICS) {
      console.log(`  ${m.name.padEnd(20)} ${m.description}`);
    }
  });

if (require.main === module) {
  program.parse(process.argv);
}

function printResults(results: Record<string, unknown>): void {
  for (const [name, data] of Object.entries(results)) {
    const description = ALL_METRICS.find((m) => m.name === name)?.description;
    console.log(`\n=== ${name.toUpperCase()} ===`);
    if (description) console.log(`  ${description}`);
    const d = data as Record<string, unknown>;

    if ("buckets" in d) {
      printBuckets(d.buckets as Record<string, { count: number; excludedOutliers: number; avgDays: number; medianDays: number; p85Days: number; p95Days: number }>);
    } else if ("avgDays" in d) {
      const unit = (d.unit as string | undefined) ?? "j";
      const totalIssues = "issues" in d ? (d.issues as unknown[]).length : ((d.count as number) + ((d.excludedOutliers as number | undefined) ?? 0));
      const excluded = (d.excludedOutliers as number | undefined) ?? 0;
      console.log(`  Moyenne   : ${(d.avgDays as number).toFixed(2)} ${unit}`);
      console.log(`  Médiane   : ${(d.medianDays as number).toFixed(2)} ${unit}`);
      console.log(`  P85       : ${(d.p85Days as number).toFixed(2)} ${unit}`);
      console.log(`  P95       : ${(d.p95Days as number).toFixed(2)} ${unit}`);
      console.log(`  Issues    : ${totalIssues}${excluded > 0 ? ` (${excluded} outliers exclus)` : ""}`);
    } else if ("byWeek" in d) {
      const byWeek = d.byWeek as Array<Record<string, unknown>>;
      const isWeighted = byWeek.length > 0 && "estimatedDays" in byWeek[0];
      const unit = isWeighted ? "j-h" : "issues";
      console.log(`  Moy/semaine : ${(d.avgPerWeek as number).toFixed(1)} ${unit}`);
      byWeek.slice(-8).forEach((w) => {
        if (isWeighted) {
          console.log(`  ${w.week} : ${(w.estimatedDays as number).toFixed(1)} j-h (${w.estimatedCount} estimées, ${w.unestimatedCount} non estimées)`);
        } else {
          console.log(`  ${w.week} : ${w.count}`);
        }
      });
    } else if ("aggregateFlowEfficiency" in d) {
      const agg = d.aggregateFlowEfficiency as number;
      const med = d.medianFlowEfficiency as number;
      const p15 = d.p15FlowEfficiency as number;
      const totalA = d.totalActiveDays as number;
      const totalQ = d.totalQueueDays as number;
      const cnt = d.count as number;
      const exc = (d.excludedOutliers as number | undefined) ?? 0;
      console.log(`  Agrégat (pondéré durée): ${(agg * 100).toFixed(1)} %`);
      console.log(`  Médiane (par issue)    : ${(med * 100).toFixed(1)} %`);
      console.log(`  P15 (pire 15%)         : ${(p15 * 100).toFixed(1)} %`);
      console.log(`  Total actif / queue    : ${totalA.toFixed(1)} j / ${totalQ.toFixed(1)} j`);
      console.log(`  Issues                 : ${cnt}${exc > 0 ? ` (${exc} outliers exclus)` : ""}`);
    } else if ("byHorizon" in d && "recentWeeks" in d) {
      const samples = d.recentWeeks as number[];
      const horizons = d.byHorizon as Array<{ weeks: number; p15: number; p50: number; p85: number; p95: number }>;
      console.log(`  Pool : ${samples.length} semaines (${samples.join(", ")})`);
      console.log(`  Sims : ${d.simulations}`);
      console.log(`  Horizon  P15 (85% conf)  P50 (médiane)  P85  P95`);
      for (const h of horizons) {
        console.log(`  ${String(h.weeks).padStart(2)} sem.   ${h.p15.toFixed(0).padStart(8)}        ${h.p50.toFixed(0).padStart(7)}      ${h.p85.toFixed(0).padStart(4)}  ${h.p95.toFixed(0).padStart(4)}`);
      }
    } else if ("riskCounts" in d) {
      const p = d.percentiles as { p50: number; p85: number; p95: number };
      const rc = d.riskCounts as { ok: number; watch: number; atRisk: number; critical: number };
      console.log(`  Date         : ${d.asOf}`);
      console.log(`  WIP total    : ${d.count}`);
      console.log(`  Seuils (j)   : P50=${p.p50.toFixed(1)}  P85=${p.p85.toFixed(1)}  P95=${p.p95.toFixed(1)}`);
      console.log(`  Risque       : OK=${rc.ok}  watch=${rc.watch}  at-risk=${rc.atRisk}  critical=${rc.critical}`);
      const top = (d.issues as Array<{ issueKey: string; ageDays: number; riskLevel: string; status: string }>).slice(0, 10);
      if (top.length > 0) {
        console.log("  Top âge :");
        for (const i of top) {
          console.log(`    ${i.issueKey.padEnd(12)} ${i.ageDays.toFixed(1).padStart(6)}j  [${i.riskLevel}]  (${i.status})`);
        }
      }
    } else if ("currentWip" in d) {
      console.log(`  Sprint     : ${d.sprintName ?? "(aucun sprint actif)"}`);
      console.log(`  WIP actuel : ${d.currentWip}`);
      console.log(`  Issues     : ${(d.issueKeys as string[]).join(", ")}`);
    }
  }
}

function printBuckets(buckets: Record<string, { count: number; excludedOutliers: number; avgDays: number; medianDays: number; p85Days: number; p95Days: number }>): void {
  const header = "  Bucket             Count    Médiane    P85      P95      Moyenne   Exclus";
  console.log(header);
  for (const b of BUCKET_ORDER) {
    const s = buckets[b];
    if (!s) continue;
    const line = [
      `  ${BUCKET_LABELS[b as SizeBucket].padEnd(19)}`,
      `${String(s.count).padStart(5)}`,
      `${s.medianDays.toFixed(1).padStart(7)}j`,
      `${s.p85Days.toFixed(1).padStart(6)}j`,
      `${s.p95Days.toFixed(1).padStart(6)}j`,
      `${s.avgDays.toFixed(1).padStart(7)}j`,
      `${String(s.excludedOutliers).padStart(5)}`,
    ].join("  ");
    console.log(line);
  }
}
