import Database from "better-sqlite3";

export interface MetricConfig {
  todoStatuses: string[];
  inProgressStatuses: string[];
  doneStatuses: string[];
  // Date ISO (YYYY-MM-DD). Issues résolues avant sont ignorées. Utile pour
  // exclure les bulk closes liés aux migrations de workflow.
  cutoffDate?: string;
}

// Contrat que chaque métrique doit implémenter
export interface Metric<T> {
  name: string;
  description: string;
  compute(db: Database.Database, config: MetricConfig): T;
}
