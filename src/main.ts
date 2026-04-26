import { Command } from "commander";
import fs from "fs";
import yaml from "yaml";
import path from "path";
import { sync } from "./sync";
import { openDb } from "./db/store";
import { runAllMetrics, runMetric, ALL_METRICS } from "./metrics/index";

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
  .action((opts) => {
    const config = loadConfig(path.resolve(opts.config));
    const db = openDb(config.db.path);
    const metricConfig = {
      todoStatuses: config.jira.todoStatuses,
      inProgressStatuses: config.jira.inProgressStatuses,
      doneStatuses: config.jira.doneStatuses,
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
    console.log(`\n=== ${name.toUpperCase()} ===`);
    const d = data as Record<string, unknown>;

    if ("avgDays" in d) {
      console.log(`  Moyenne   : ${(d.avgDays as number).toFixed(1)} j`);
      console.log(`  Médiane   : ${(d.medianDays as number).toFixed(1)} j`);
      console.log(`  P85       : ${(d.p85Days as number).toFixed(1)} j`);
      console.log(`  P95       : ${(d.p95Days as number).toFixed(1)} j`);
      console.log(`  Issues    : ${(d.issues as unknown[]).length}`);
    } else if ("byWeek" in d) {
      const byWeek = d.byWeek as Array<{ week: string; count: number }>;
      console.log(`  Moy/semaine : ${(d.avgPerWeek as number).toFixed(1)}`);
      byWeek.slice(-8).forEach((w) => console.log(`  ${w.week} : ${w.count}`));
    } else if ("currentWip" in d) {
      console.log(`  WIP actuel : ${d.currentWip}`);
      console.log(`  Issues     : ${(d.issueKeys as string[]).join(", ")}`);
    }
  }
}
