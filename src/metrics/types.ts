import type Database from "better-sqlite3";

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
}

// Contrat que chaque métrique doit implémenter
export interface Metric<T> {
  name: string;
  description: string;
  compute(db: Database.Database, config: MetricConfig): T;
}
