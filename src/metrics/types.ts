import type Database from "better-sqlite3";

export type EstimationMethod = "time" | "story-points" | "numeric" | "t-shirt" | "none";

export interface EstimationBucketThresholds {
  xs: number;
  s: number;
  m: number;
  l: number;
}

export interface EstimationConfig {
  method: EstimationMethod;
  jiraField?: string;
  bucketThresholds?: EstimationBucketThresholds;
}

export function resolveEstimationField(cfg: EstimationConfig): string | null {
  if (cfg.jiraField) { return cfg.jiraField; }
  if (cfg.method === "time") { return "timeoriginalestimate"; }
  if (cfg.method === "story-points") { return "customfield_10016"; }
  return null;
}

export interface MetricConfig {
  todoStatuses: string[];
  devStartStatuses: string[];
  inProgressStatuses: string[];
  doneStatuses: string[];
  // Sous-ensemble de inProgressStatuses où l'issue est *travaillée*
  // (Dev/QA/Design en cours). Sert au calcul de flow-efficiency et aging-wip.
  activeStatuses?: string[];
  // Sous-ensemble de inProgressStatuses où l'issue *attend* (review, validation,
  // ready-for-X). Tout statut in-progress non listé ici ni dans activeStatuses
  // est ignoré du calcul de flow-efficiency.
  queueStatuses?: string[];
  // Vides si board.yaml ne définit aucun role sur ses colonnes.
  devStatuses?: string[];
  qaStatuses?: string[];
  poStatuses?: string[];
  // Date ISO (YYYY-MM-DD). Issues résolues avant sont ignorées. Utile pour
  // exclure les bulk closes liés aux migrations de workflow.
  cutoffDate?: string;
  // Date ISO (YYYY-MM-DD). Issues résolues après sont ignorées. Utilisé par
  // le système de snapshots pour calculer des métriques sur fenêtre passée.
  windowEndDate?: string;
  // Exclure les outliers extrêmes (Tukey upper fence: Q3 + 1.5*IQR) avant
  // de calculer moyennes et percentiles. Default true.
  excludeOutliers?: boolean;
  // Types Jira considérés comme bugs. Bucket dédié "BUG" + exclusion des
  // métriques d'estimation (normalized, weighted throughput).
  bugIssueTypes: string[];
  // Types Jira exclus de toutes les métriques (ex: Feature, Epic).
  excludeIssueTypes: string[];
  // Couvre le nettoyage de description en sprint planning (ex: 24).
  scopeChangeGracePeriodHours?: number;
  // Méthode d'estimation active. Défaut { method: "time" } injecté par buildMetricConfig().
  estimation: EstimationConfig;
  // Mapping statut Jira → nom de colonne board.yaml. Construit par buildMetricConfig().
  // Absent dans les tests unitaires qui ne passent pas de board complet.
  statusToColumnName?: Record<string, string>;
}

// Contrat que chaque métrique doit implémenter
export interface Metric<T> {
  name: string;
  description: string;
  compute(db: Database.Database, config: MetricConfig): T;
}
