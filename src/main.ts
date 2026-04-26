import { Command } from "commander";
import fs from "fs";
import yaml from "yaml";
import path from "path";
import { sync } from "./sync";
import { openDb } from "./db/store";
import { runAllMetrics, runMetric, ALL_METRICS } from "./metrics/index";
import { BUCKET_LABELS, BUCKET_ORDER, SizeBucket } from "./metrics/utils";

interface AppConfig {
  jira: {
    baseUrl: string;
    email: string;
    apiToken: string;
    projectKey: string;
    boardId: number;
    todoStatuses: string[];
    inProgressStatuses: string[];
    doneStatuses: string[];
  };
  metrics?: {
    cutoffDate?: string;
  };
  db: { path: string };
}

function loadConfig(configPath: string): AppConfig {
  const raw = fs.readFileSync(configPath, "utf-8");
  return yaml.parse(raw) as AppConfig;
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
    const metricConfig = {
      todoStatuses: config.jira.todoStatuses,
      inProgressStatuses: config.jira.inProgressStatuses,
      doneStatuses: config.jira.doneStatuses,
      cutoffDate: config.metrics?.cutoffDate,
      excludeOutliers: !opts.includeOutliers,
    };

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
  .command("list-metrics")
  .description("Liste toutes les métriques disponibles")
  .action(() => {
    console.log("Métriques disponibles :");
    for (const m of ALL_METRICS) {
      console.log(`  ${m.name.padEnd(20)} ${m.description}`);
    }
  });

program.parse(process.argv);

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
      const totalIssues = "issues" in d ? (d.issues as unknown[]).length : ((d.count as number) + ((d.excludedOutliers as number) ?? 0));
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
