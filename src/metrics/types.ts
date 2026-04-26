import Database from "better-sqlite3";

export interface MetricConfig {
  todoStatuses: string[];
  devStartStatuses: string[];
  inProgressStatuses: string[];
  doneStatuses: string[];
  // Date ISO (YYYY-MM-DD). Issues résolues avant sont ignorées. Utile pour
  // exclure les bulk closes liés aux migrations de workflow.
  cutoffDate?: string;
  // Exclure les outliers extrêmes (Tukey upper fence: Q3 + 1.5*IQR) avant
  // de calculer moyennes et percentiles. Default true.
  excludeOutliers?: boolean;
  // Types Jira considérés comme bugs. Bucket dédié "BUG" + exclusion des
  // métriques d'estimation (normalized, weighted throughput).
  bugIssueTypes: string[];
}

// Contrat que chaque métrique doit implémenter
export interface Metric<T> {
  name: string;
  description: string;
  compute(db: Database.Database, config: MetricConfig): T;
}
