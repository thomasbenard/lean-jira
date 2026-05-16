import { t } from "../i18n/index";
import { escapeHtml, issueLink } from "./htmlHelpers";
import type { ReadStore } from "../store/types";
import type { ScopeChangeResult } from "../metrics/scopeChange";

export function buildScopeAlertBanner(store: ReadStore, scopeData: ScopeChangeResult): string {
  if (scopeData.changedIssues === 0) {return "";}

  // pourquoi : ticket 050 — reproduit `WHERE state='active' ORDER BY start_date DESC LIMIT 1`
  // côté JS ; localeCompare décroissant simule le ORDER BY DESC.
  const activeSprints = store.sprints.all()
    .filter((s) => s.state === "active")
    .sort((a, b) => (b.startDate ?? "").localeCompare(a.startDate ?? ""));

  if (activeSprints.length === 0) {return "";}
  const activeSprint = activeSprints[0];

  const alertSprints = (scopeData.bySprint[activeSprint.name]?.changedIssues ?? 0) > 0
    ? [activeSprint.name]
    : [];

  if (alertSprints.length === 0) {return "";}

  const count = alertSprints.reduce((s, n) => s + (scopeData.bySprint[n]?.changedIssues ?? 0), 0);
  const sprintLabel = alertSprints.join(", ");
  const banner = t("report.scope.alertBanner", { count: String(count) });
  const sprintDetail = t("report.scope.alertSprint", { sprint: sprintLabel });
  return `<div class="alert-orange">${banner} <span class="alert-detail">${escapeHtml(sprintDetail)}</span></div>`;
}

export function buildScopeChangeChart(scopeData: ScopeChangeResult): string {
  const sprintNames = Object.keys(scopeData.bySprint).sort((a, b) => {
    const numA = parseInt((/\d+/.exec(a))?.[0] ?? "0", 10);
    const numB = parseInt((/\d+/.exec(b))?.[0] ?? "0", 10);
    return numA - numB;
  });

  const shortLabels = sprintNames.map((n) => {
    const idx = n.indexOf(" - ");
    return idx >= 0 ? n.slice(idx + 3) : n;
  });

  const extracted = sprintNames.map((n) => {
    const s = scopeData.bySprint[n];
    return {
      changed: s?.changedIssues ?? 0,
      unchanged: (s?.totalIssues ?? 0) - (s?.changedIssues ?? 0),
      ratio: Math.round((s?.changeRatio ?? 0) * 100),
    };
  });

  return JSON.stringify({
    type: "bar",
    data: {
      labels: shortLabels,
      datasets: [
        { label: t("report.js.label.scopeChanged"), data: extracted.map((e) => e.changed), backgroundColor: "rgba(224, 49, 49, 0.75)", stack: "scope" },
        {
          label: t("report.js.label.scopeDriftRate"), data: extracted.map((e) => e.ratio), type: "line", yAxisID: "y2",
          borderColor: "#0bc5ea", backgroundColor: "rgba(11, 197, 234, 0.08)",
          borderWidth: 2, borderDash: [5, 3], pointRadius: 5, pointBackgroundColor: "#0bc5ea",
          tension: 0.3, fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      datasets: { bar: { barPercentage: 0.6, categoryPercentage: 0.7 } },
      scales: {
        x: { ticks: { maxRotation: 0, minRotation: 0 } },
        y:  { stacked: true, min: 0, ticks: { stepSize: 1 }, title: { display: true, text: t("report.js.axis.nbIssues") } },
        y2: { position: "right", min: 0, suggestedMax: 110, title: { display: true, text: t("report.js.axis.driftRate") }, grid: { drawOnChartArea: false } },
      },
    },
  });
}

export function buildScopeSection(scopeData: ScopeChangeResult, store: ReadStore, jiraBaseUrl: string): string {
  const chartCfg = buildScopeChangeChart(scopeData);

  let tableHtml = "";
  if (scopeData.changedIssueKeys.length > 0) {
    const keys = scopeData.changedIssueKeys;
    const summaries = store.issues.byKeys(keys);
    const summaryByKey = new Map(summaries.map((r) => [r.key, r.summary]));

    const sprintNames = Object.keys(scopeData.bySprint);
    // pourquoi : ticket 050 — Set pour O(1) lookup au lieu d'un IN(?...) SQL.
    const sprintNamesSet = new Set(sprintNames);
    const sprintStartRows = sprintNames.length > 0
      ? store.sprints.all()
          .filter((s) => sprintNamesSet.has(s.name))
          .map((s) => ({ name: s.name, start_date: s.startDate ?? "" }))
      : [];
    const sprintStartByName = new Map(sprintStartRows.map((r) => [r.name, r.start_date]));

    const sprintByKey = new Map<string, string>();
    for (const [sprintName, stats] of Object.entries(scopeData.bySprint)) {
      if (!stats) {continue;}
      for (const detail of stats.issueDetails) {
        sprintByKey.set(detail.key, sprintName);
      }
    }

    const sortedKeys = [...keys].sort((a, b) => {
      const sa = sprintByKey.get(a) ?? "";
      const sb = sprintByKey.get(b) ?? "";
      if (sa === sb) {return a.localeCompare(b);}
      if (!sa) {return 1;}
      if (!sb) {return -1;}
      const da = sprintStartByName.get(sa) ?? sa;
      const db2 = sprintStartByName.get(sb) ?? sb;
      return da < db2 ? 1 : da > db2 ? -1 : 0;
    });

    const rows = sortedKeys.map((key) => {
      const sprint = sprintByKey.get(key) ?? "—";
      const sprintStart = sprintStartByName.get(sprint) ?? sprint;
      const summary = summaryByKey.get(key) ?? "";
      return `<tr data-sprint-start="${escapeHtml(sprintStart)}"><td>${issueLink(key, jiraBaseUrl)}</td><td>${escapeHtml(sprint)}</td><td>${escapeHtml(summary)}</td></tr>`;
    }).join("");

    tableHtml = `<table class="scope-issues-table" id="scopeIssuesTable">
      <thead><tr><th data-col="0">${escapeHtml(t("report.scope.tableKey"))}</th><th data-col="1" class="sort-desc">${escapeHtml(t("report.scope.tableSprint"))}</th><th data-col="2">${escapeHtml(t("report.scope.tableSummary"))}</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  const hasData = Object.keys(scopeData.bySprint).length > 0;

  return `<section class="scope-section">
  <div class="actions-head"><h2>${escapeHtml(t("report.scope.title"))}</h2><div class="sep"></div></div>
  <p class="scope-help">${escapeHtml(t("report.scope.help"))}</p>
  ${hasData ? "" : `<p class="text-dim">${escapeHtml(t("report.scope.noDrift"))}</p>`}
  ${hasData ? `<div class="chart-card wide"><div class="chart-wrap"><canvas id="scopeChangeChart"></canvas></div></div>` : ""}
  ${tableHtml}
  <script>
  (function(){
    var ctx = document.getElementById('scopeChangeChart');
    if (ctx) { new Chart(ctx, ${chartCfg}); }
  })();
  (function(){
    var table = document.getElementById('scopeIssuesTable');
    if (!table) return;
    var tbody = table.querySelector('tbody');
    var ths = table.querySelectorAll('th[data-col]');
    var sortCol = 1, sortAsc = false;
    function cellValue(row, col) {
      if (col === 1) return row.dataset.sprintStart || '';
      return row.cells[col].textContent || '';
    }
    function sort() {
      var rows = Array.from(tbody.querySelectorAll('tr'));
      rows.sort(function(a, b) {
        var av = cellValue(a, sortCol), bv = cellValue(b, sortCol);
        var cmp = av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' });
        return sortAsc ? cmp : -cmp;
      });
      rows.forEach(function(r) { tbody.appendChild(r); });
      ths.forEach(function(th) {
        th.classList.remove('sort-asc', 'sort-desc');
        if (Number(th.dataset.col) === sortCol) th.classList.add(sortAsc ? 'sort-asc' : 'sort-desc');
      });
    }
    ths.forEach(function(th) {
      th.addEventListener('click', function() {
        var col = Number(th.dataset.col);
        if (col === sortCol) { sortAsc = !sortAsc; } else { sortCol = col; sortAsc = true; }
        sort();
      });
    });
  })();
  </script>
</section>`;
}
