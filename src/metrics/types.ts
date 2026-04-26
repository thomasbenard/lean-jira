import Database from "better-sqlite3";

export interface MetricConfig {
  todoStatuses: string[];
  inProgressStatuses: string[];
  doneStatuses: string[];
}

// Contrat que chaque métrique doit implémenter
export interface Metric<T> {
  name: string;
  description: string;
  compute(db: Database.Database, config: MetricConfig): T;
}
