import { t } from "../i18n/index";
import {
  escapeHtml,
  syncMetaLabel,
  agingRowsHtml,
  helpBtn,
  fmtInt,
  hide,
  bySizeRows,
  forecastTableRows,
} from "./htmlHelpers";
import { estimationFlags } from "./estimation";
import { evalLowerBetter, evalHigherBetter } from "./healthThresholds";
import {
  buildKpiCells,
  computeVerdict,
  verdictLabels,
  formatKpiNumber,
  fmtDelta,
  SIGNAL_CLS,
  SIGNAL_COLOR,
  type KpiCell,
  type KpiSignals,
} from "./kpi";
import type { BottleneckAnalysisResult, RoleKey } from "../metrics/bottleneckAnalysis";
import type { RenderInput } from "./types";

const ROLE_CSS_COLOR: Record<RoleKey, string> = {
  dev: "var(--violet)",
  qa:  "var(--green)",
  po:  "var(--orange)",
};

// pourquoi: data-values est lu côté client par renderSparklines() ; JSON est ASCII-safe pour des nombres,
// escapeHtml encode les guillemets pour rester valide dans un attribut entre apostrophes.
function renderKpiCellHtml(c: KpiCell, idx: number): string {
  const help = c.helpKey ? helpBtn(c.helpKey) : "";
  const unit = c.value !== null && c.unit ? `<span class="unit">${escapeHtml(c.unit)}</span>` : "";
  const sparkData = JSON.stringify(c.spark);
  return `<div class="kpi-cell ${SIGNAL_CLS[c.signal]}">
      <div class="kpi-label">${escapeHtml(c.label)}${help}</div>
      <div class="kpi-value">${escapeHtml(formatKpiNumber(c.value))}${unit}</div>
      ${fmtDelta(c)}
      <canvas class="spark" id="kpi-spark-${idx}" width="180" height="52" data-values='${escapeHtml(sparkData)}' data-color="${SIGNAL_COLOR[c.signal]}"></canvas>
    </div>`;
}

function buildBottleneckPanelHtml(b: BottleneckAnalysisResult): string {
  if (b.count === 0) {
    return `<div class="chart-card wide"><h3>Bottleneck Analysis${helpBtn("bottleneckAnalysis")}</h3><p class="meta-line">${escapeHtml(t("report.bottleneck.noData"))}</p></div>`;
  }
  const primary = b.primaryBottleneck ?? "dev";
  const score = b.byRole[primary].score;
  const badgeCls = score >= 0.6 ? "risk-critical" : score >= 0.4 ? "risk-at-risk" : "risk-ok";
  const colLabel = b.primaryColumn ? ` (${escapeHtml(b.primaryColumn)})` : "";
  const bars = (["dev", "qa", "po"] as const).map((role) => {
    const s = b.byRole[role];
    const pct = Math.round(s.score * 100);
    const fillColor = s.score >= 0.6 ? "var(--red)" : s.score >= 0.4 ? "var(--orange)" : "var(--green)";
    const labelCls = s.score >= 0.6 ? "risk-critical" : s.score >= 0.4 ? "risk-at-risk" : "risk-ok";
    return `<div class="bn-row">
        <span class="bn-label ${labelCls}">${escapeHtml(role.toUpperCase())} <span class="bn-rank">#${s.rank}</span></span>
        <div class="bn-bar-bg"><div class="bn-bar-fill" style="width:${pct}%;background:${fillColor}"></div></div>
        <span class="bn-pct mono">${pct}%</span>
      </div>`;
  }).join("");
  return `<div class="chart-card wide">
    <h3>Bottleneck Analysis${helpBtn("bottleneckAnalysis")}</h3>
    <p class="meta-line"><span class="${badgeCls}">${escapeHtml(primary.toUpperCase())}${colLabel}</span> — ${escapeHtml(b.recommendation)}</p>
    <div class="bn-bars">${bars}</div>
  </div>`;
}

function buildColumnDrilldownHtml(b: BottleneckAnalysisResult): string {
  if (b.byColumn.length === 0) {return "";}
  const maxMedian = Math.max(...b.byColumn.map((c) => c.medianDays));
  const rows = b.byColumn.map((c) => {
    const pct = maxMedian > 0 ? Math.max(1, Math.round((c.medianDays / maxMedian) * 100)) : 1;
    const color = ROLE_CSS_COLOR[c.role];
    return `<div class="bn-row">
        <span class="bn-label">${escapeHtml(c.column)} <span class="bn-rank">${escapeHtml(c.role.toUpperCase())}</span></span>
        <div class="bn-bar-bg"><div class="bn-bar-fill" style="width:${pct}%;background:${color}"></div></div>
        <span class="bn-pct mono">${c.medianDays.toFixed(1)}j <span class="bn-rank">(${c.count})</span></span>
      </div>`;
  }).join("");
  return `<div class="chart-card" style="margin-bottom: 1rem">
    <h3>${escapeHtml(t("report.chart.columnDrilldown"))}${helpBtn("bottleneckAnalysis")}</h3>
    <div class="bn-bars bn-bars-col">${rows}</div>
  </div>`;
}

function renderRoleCardHtml(r: { cls: string; name: string; wip: number | null; med: number | null; ftr: number | null }): string {
  return `<div class="role ${r.cls}">
      <h4>${escapeHtml(r.name)}</h4>
      <div class="role-stats">
        <div class="role-stat"><div class="v">${fmtInt(r.wip)}</div><div class="l">WIP</div></div>
        <div class="role-stat"><div class="v">${r.med === null ? "—" : `${r.med.toFixed(1)}j`}</div><div class="l">${escapeHtml(t("report.role.median"))}</div></div>
        <div class="role-stat"><div class="v">${r.ftr === null ? "—" : `${(r.ftr * 100).toFixed(0)}%`}</div><div class="l">${escapeHtml(t("report.role.ftr"))}</div></div>
      </div>
    </div>`;
}

export function buildKpiCellsFromInput(input: RenderInput): KpiCell[] {
  const thresholds = input.healthThresholds;
  const rawSignals: KpiSignals = {
    leadTime: evalLowerBetter(input.kpis.leadTimeMedian, thresholds?.leadTimeMedianDays),
    cycleTime: evalLowerBetter(input.kpis.cycleTimeMedian, thresholds?.cycleTimeMedianDays),
    throughput: evalHigherBetter(input.kpis.throughputCount, thresholds?.throughputWeekly),
    wip: evalLowerBetter(input.kpis.wipCount, thresholds?.wipCount),
    bugCycle: evalLowerBetter(input.kpis.bugCycleTimeMedian, thresholds?.bugCycleTimeMedianDays),
    bugRatio: evalLowerBetter(input.kpis.devTimeAvgBugRatio, thresholds?.bugRatio),
  };
  return buildKpiCells(input.charts, input.agingWip, rawSignals);
}

export function buildVerdictHtml(input: RenderInput): string {
  const verdict = computeVerdict(buildKpiCellsFromInput(input));
  return `<div class="verdict ${verdict.status}">
  <span class="verdict-status">${escapeHtml(verdictLabels()[verdict.status])}</span>
  <span class="verdict-text">${verdict.phrase}</span>
  <span class="verdict-time mono">${escapeHtml(syncMetaLabel(input.lastSyncAt))} · Snapshot ${escapeHtml(input.lastSnapshotDate)}</span>
</div>`;
}

export function buildKpiGridHtml(input: RenderInput): string {
  return buildKpiCellsFromInput(input).map(renderKpiCellHtml).join("");
}

export function buildRenderedTabs(input: RenderInput): { id: string; label: string; html: string }[] {
  const flags = estimationFlags(input.estimation ?? { method: "time" });
  const tabs: { id: string; label: string; html: string }[] = [];

  tabs.push({
    id: "delivery",
    label: t("report.tab.delivery"),
    html: `<div class="panel-grid">
    <div class="chart-card"><h3>${escapeHtml(t("report.chart.leadTime"))}${helpBtn("leadTime")}</h3><div class="chart-wrap"><canvas id="leadTimeChart"></canvas></div></div>
    <div class="chart-card"><h3>${escapeHtml(t("report.chart.cycleTime"))}${helpBtn("cycleTime")}</h3><div class="chart-wrap"><canvas id="cycleTimeChart"></canvas></div></div>
  </div>
  <div class="panel-grid" style="margin-top: 1rem">
    <div class="chart-card"><h3><span class="chart-title-text" id="throughputChartTitle">${escapeHtml(t("report.chart.throughput"))}</span>${helpBtn("throughput")}</h3><div class="chart-wrap"><canvas id="throughputChart"></canvas></div></div>
    <div class="chart-card"${hide(flags.showWeighted)}><h3><span class="chart-title-text" id="throughputWeightedChartTitle">${escapeHtml(t("report.chart.throughputWeighted", { unit: flags.weightedUnit }))}</span>${helpBtn("throughputWeighted")}</h3><div class="chart-wrap"><canvas id="throughputWeightedChart"></canvas></div></div>
    <div class="chart-card"><h3>${escapeHtml(t("report.chart.wip"))}${helpBtn("wip")}</h3><div class="chart-wrap"><canvas id="wipChart"></canvas></div></div>
    <div class="chart-card">
      <h3>${escapeHtml(t("report.chart.cycleHistogram"))}${helpBtn("cycleHistogram")}</h3>
      <p class="meta-line">${escapeHtml(t("report.meta.cycleStats", { count: String(input.cycleStats.count), median: input.cycleStats.median.toFixed(1), p85: input.cycleStats.p85.toFixed(1), p95: input.cycleStats.p95.toFixed(1), avg: input.cycleStats.avg.toFixed(1) }))}</p>
      <div class="chart-wrap"><canvas id="cycleHistogramChart"></canvas></div>
    </div>
  </div>
  <div class="panel-grid" style="margin-top: 1rem">
    <div class="chart-card"${hide(flags.showBySize)}>
      <h3>${escapeHtml(t("report.chart.leadBySize", { date: input.lastSnapshotDate }))}${helpBtn("leadTimeBySize")}</h3>
      <table><thead><tr><th>${escapeHtml(t("report.table.size"))}</th><th>${escapeHtml(t("report.table.count"))}</th><th>${escapeHtml(t("report.table.median"))}</th><th>${escapeHtml(t("report.table.p85"))}</th></tr></thead>
      <tbody>${bySizeRows(input.leadBySize)}</tbody></table>
    </div>
    <div class="chart-card"${hide(flags.showBySize)}>
      <h3>${escapeHtml(t("report.chart.cycleBySize"))}${helpBtn("cycleTimeBySize")}</h3>
      <table><thead><tr><th>${escapeHtml(t("report.table.size"))}</th><th>${escapeHtml(t("report.table.count"))}</th><th>${escapeHtml(t("report.table.median"))}</th><th>${escapeHtml(t("report.table.p85"))}</th></tr></thead>
      <tbody>${bySizeRows(input.cycleBySize)}</tbody></table>
    </div>
  </div>`,
  });

  tabs.push({
    id: "quality",
    label: t("report.tab.quality"),
    html: `<div class="panel-grid">
    <div class="chart-card"><h3><span class="chart-title-text" id="bugThroughputChartTitle">${escapeHtml(t("report.chart.bugThroughput"))}</span>${helpBtn("bugThroughput")}</h3><div class="chart-wrap"><canvas id="bugThroughputChart"></canvas></div></div>
    <div class="chart-card"><h3>${escapeHtml(t("report.chart.bugCycleTime"))}${helpBtn("bugCycleTime")}</h3><div class="chart-wrap"><canvas id="bugCycleTimeChart"></canvas></div></div>
    <div class="chart-card"><h3>${escapeHtml(t("report.chart.devTimeAllocation"))}${helpBtn("devTimeAllocation")}</h3><div class="chart-wrap"><canvas id="devTimeAllocationChart"></canvas></div></div>
    <div class="chart-card"><h3>${escapeHtml(t("report.chart.bugBacklog"))}${helpBtn("bugBacklog")}</h3><div class="chart-wrap"><canvas id="bugBacklogChart"></canvas></div></div>
  </div>`,
  });

  tabs.push({
    id: "roles",
    label: t("report.tab.roles"),
    html: `<div class="role-grid">
    ${renderRoleCardHtml({ cls: "dev", name: "Dev", wip: input.kpis.wipDev, med: input.kpis.stageTimeDevMedian, ftr: input.kpis.ftrDev })}
    ${renderRoleCardHtml({ cls: "qa",  name: "QA",  wip: input.kpis.wipQa, med: input.kpis.stageTimeQaMedian, ftr: input.kpis.ftrQa })}
    ${renderRoleCardHtml({ cls: "po",  name: "PO",  wip: input.kpis.wipPo, med: input.kpis.stageTimePoMedian, ftr: input.kpis.ftrPo })}
  </div>
  ${buildBottleneckPanelHtml(input.bottleneck)}
  ${buildColumnDrilldownHtml(input.bottleneck)}
  <div class="panel-grid">
    <div class="chart-card"><h3>${escapeHtml(t("report.chart.stageTimeByRole"))}${helpBtn("stageTimeBreakdown")}</h3><div class="chart-wrap"><canvas id="stageTimeByRoleChart"></canvas></div></div>
    <div class="chart-card"><h3>${escapeHtml(t("report.chart.stageTimeShare"))}${helpBtn("stageTimeBreakdown")}</h3><div class="chart-wrap"><canvas id="stageTimeShareChart"></canvas></div></div>
    <div class="chart-card"><h3>${escapeHtml(t("report.chart.wipPerRole"))}${helpBtn("wipPerRole")}</h3><div class="chart-wrap"><canvas id="wipPerRoleChart"></canvas></div></div>
    <div class="chart-card"><h3>${escapeHtml(t("report.chart.stageThroughputGap"))}${helpBtn("stageThroughputGap")}</h3><div class="chart-wrap"><canvas id="stageThroughputGapChart"></canvas></div></div>
    <div class="chart-card"><h3>${escapeHtml(t("report.chart.ftrByRole"))}${helpBtn("firstTimeRight")}</h3><div class="chart-wrap"><canvas id="ftrByRoleChart"></canvas></div></div>
    <div class="chart-card"><h3>${escapeHtml(t("report.chart.reworkRatio"))}${helpBtn("handoffRework")}</h3><div class="chart-wrap"><canvas id="reworkRatioChart"></canvas></div></div>
    <div class="chart-card"><h3>${escapeHtml(t("report.chart.reworkByType"))}${helpBtn("handoffRework")}</h3><div class="chart-wrap"><canvas id="reworkByTypeChart"></canvas></div></div>
    <div class="chart-card"><h3>${escapeHtml(t("report.chart.bottleneckScores"))}${helpBtn("bottleneckAnalysis")}</h3><div class="chart-wrap"><canvas id="bottleneckScoresChart"></canvas></div></div>
    <div class="chart-card"><h3>${escapeHtml(t("report.chart.reworkCost"))}${helpBtn("reworkCost")}</h3><div class="chart-wrap"><canvas id="reworkCostChart"></canvas></div></div>
  </div>`,
  });

  tabs.push({
    id: "forecast",
    label: t("report.tab.forecast"),
    html: `<div class="panel-grid">
    <div class="chart-card">
      <h3>${escapeHtml(t("report.chart.forecastMonteCarlo"))}${helpBtn("forecast")}</h3>
      <p class="meta-line">${escapeHtml(t("report.meta.forecastPool", { weeks: String(input.forecast.weeksUsed), sims: String(input.forecast.simulations) }))}</p>
      <table>
        <thead><tr><th>Horizon</th><th>P15<br><small>(85% conf.)</small></th><th>P50</th><th>P85</th><th>P95</th></tr></thead>
        <tbody>${forecastTableRows(input.forecast)}</tbody>
      </table>
    </div>
    <div class="chart-card">
      <h3>${escapeHtml(t("report.chart.agingWip", { date: input.agingWip.asOf }))}${helpBtn("agingWip")}</h3>
      <p class="meta-line">${escapeHtml(t("report.meta.agingStats", { p50: input.agingWip.percentiles.p50.toFixed(1), p85: input.agingWip.percentiles.p85.toFixed(1), p95: input.agingWip.percentiles.p95.toFixed(1), count: String(input.agingWip.count) }))}</p>
      <div class="chart-wrap"><canvas id="agingScatter"></canvas></div>
    </div>
    <div class="chart-card wide">
      <h3>${escapeHtml(t("report.chart.agingTopItems"))}${helpBtn("agingWip")}</h3>
      <table>
        <thead><tr><th>${escapeHtml(t("report.aging.col.issue"))}</th><th>${escapeHtml(t("report.aging.col.status"))}</th><th>${escapeHtml(t("report.aging.col.age"))}</th><th>${escapeHtml(t("report.aging.col.risk"))}</th></tr></thead>
        <tbody>${agingRowsHtml(input.agingWip, input.jiraBaseUrl)}</tbody>
      </table>
    </div>
  </div>`,
  });

  if (input.scopeSectionHtml) {
    tabs.push({ id: "scope", label: t("report.tab.scope"), html: input.scopeSectionHtml });
  }

  tabs.push({
    id: "advanced",
    label: t("report.tab.advanced"),
    html: `<div class="panel-grid three">
    <div class="chart-card"${hide(flags.showNormalized)}><h3>${escapeHtml(t("report.chart.leadNormalized"))}${helpBtn("leadTimeNormalized")}</h3><div class="chart-wrap"><canvas id="leadNormalizedChart"></canvas></div></div>
    <div class="chart-card"${hide(flags.showNormalized)}><h3>${escapeHtml(t("report.chart.cycleNormalized"))}${helpBtn("cycleTimeNormalized")}</h3><div class="chart-wrap"><canvas id="cycleNormalizedChart"></canvas></div></div>
    <div class="chart-card"><h3>${escapeHtml(t("report.chart.flowEfficiency"))}${helpBtn("flowEfficiency")}</h3><div class="chart-wrap"><canvas id="flowEfficiencyChart"></canvas></div></div>
  </div>
  ${flags.showNormalized ? `<p class="estimation-note">${escapeHtml(t("report.estimation.note"))}</p>` : ""}
  <div class="panel-grid" style="margin-top: 1rem">
    <div class="chart-card"${hide(flags.showBySize)}>
      <h3>${escapeHtml(t("report.chart.leadBySizeAdv"))}${helpBtn("leadTimeBySize")}</h3>
      <div class="bucket-selector" id="leadBySizeBuckets"></div>
      <div class="chart-wrap"><canvas id="leadBySizeChart"></canvas></div>
    </div>
    <div class="chart-card"${hide(flags.showBySize)}>
      <h3>${escapeHtml(t("report.chart.cycleBySizeAdv"))}${helpBtn("cycleTimeBySize")}</h3>
      <div class="bucket-selector" id="cycleBySizeBuckets"></div>
      <div class="chart-wrap"><canvas id="cycleBySizeChart"></canvas></div>
    </div>
  </div>
  <div class="panel-grid" style="margin-top: 1rem">
    <div class="chart-card">
      <h3>${escapeHtml(t("report.chart.cycleDistribution"))}${helpBtn("cycleDistribution")}</h3>
      <div class="bucket-selector" id="cycleDistributionBuckets"></div>
      <div class="chart-wrap"><canvas id="cycleDistributionChart"></canvas></div>
    </div>
    <div class="chart-card">
      <h3>${escapeHtml(t("report.chart.leadDistribution"))}${helpBtn("leadDistribution")}</h3>
      <div class="bucket-selector" id="leadDistributionBuckets"></div>
      <div class="chart-wrap"><canvas id="leadDistributionChart"></canvas></div>
    </div>
  </div>`,
  });

  return tabs;
}
