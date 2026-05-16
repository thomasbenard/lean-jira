import type { ChartSeries, BucketStats } from "./snapshotSeries";
import type { AgingWipSummary } from "../metrics/agingWip";
import type { ForecastSummary } from "../metrics/forecast";
import type { HistogramBin } from "../metrics/utils";
import type { HealthThresholds } from "./healthThresholds";
import type { ResolvedPersonalization } from "./personalization";
import type { EstimationConfig } from "../metrics/types";
import type { BottleneckAnalysisResult } from "../metrics/bottleneckAnalysis";
import type { DurationDistributionResult } from "../metrics/durationDistribution";
import type { SprintChartSeries } from "./sprintSeries";

export interface RenderInput {
  projectKey: string;
  squadName?: string;
  jiraBaseUrl: string;
  generatedAt: string;
  lastSnapshotDate: string;
  lastSyncAt: string | null;
  isSyncStale: boolean;
  kpis: Record<string, number | null>;
  charts: Record<string, ChartSeries>;
  leadBySize: Partial<Record<string, BucketStats>>;
  cycleBySize: Partial<Record<string, BucketStats>>;
  leadTimeBySizeCharts: Record<string, ChartSeries>;
  cycleTimeBySizeCharts: Record<string, ChartSeries>;
  agingWip: AgingWipSummary;
  forecast: ForecastSummary;
  histogram: HistogramBin[];
  cycleStats: { median: number; p85: number; p95: number; avg: number; count: number };
  healthThresholds?: HealthThresholds;
  scopeAlertHtml?: string;
  scopeSectionHtml?: string;
  personalization?: ResolvedPersonalization;
  estimation?: EstimationConfig;
  bottleneck: BottleneckAnalysisResult;
  distribution: DurationDistributionResult;
  sprintCharts: {
    throughput: SprintChartSeries;
    bugThroughput: SprintChartSeries;
    throughputWeighted: SprintChartSeries;
    leadTime: SprintChartSeries;
    cycleTime: SprintChartSeries;
    bugCycleTime: SprintChartSeries;
    devTimeAllocation: SprintChartSeries;
  } | null;
  rolesSprintCharts: {
    ftrByRole: SprintChartSeries;
    handoffReworkRatio: SprintChartSeries;
    handoffReworkByType: SprintChartSeries;
    reworkCost: SprintChartSeries;
  } | null;
}
