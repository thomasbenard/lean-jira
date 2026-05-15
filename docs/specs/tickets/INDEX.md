# Index des tickets

| N° | Description | Statut |
|---|---|---|
| [001](001-lead-cycle-time-bucket-selector/description.md) | Lead/cycle time par taille : séries temporelles avec sélecteur de bucket | livré |
| [002](002-automatisation-pipeline-refresh/description.md) | Automatisation du pipeline refresh | livré |
| [003](003-rapport-liens-jira-cliquables/description.md) | Rapport : liens Jira cliquables sur les clés d'issues | livré |
| [004](004-rapport-indicateur-fraicheur/description.md) | Rapport : indicateur de fraîcheur des données | livré |
| [005](005-onboarding-config-validate/description.md) | Onboarding : config example + commande validate-config | livré |
| [006](006-config-board-column-centric/description.md) | Config board centré sur les colonnes | livré |
| [007](007-rapport-courbe-tendance/description.md) | Rapport : courbe de tendance sur les graphes | livré |
| [008](008-dev-time-allocation/description.md) | Dev time allocation (features vs bugs) | livré |
| [009](009-sync-incremental/description.md) | Sync incrémental | livré |
| [010](010-autoconfig-board-depuis-api-jira/description.md) | Autoconfiguration du board depuis l'API Jira | livré |
| [011](011-legacy-statuses-par-colonne/description.md) | legacyStatuses par colonne | livré |
| [012](012-inference-queue-par-mots-cles/description.md) | Inférence active/queue par mots-clés sur nom de colonne | livré |
| [013](013-bug-backlog/description.md) | Métrique bug-backlog | livré |
| [014](014-rapport-lisibilite-groupement/description.md) | Rapport : lisibilité par groupement thématique | livré |
| [015](015-kpi-signaux-sante/description.md) | KPIs : signaux de santé statiques | livré |
| [016](016-autoconfig-preserve-config-existant/description.md) | autoconfig : préserver le config existant | livré |
| [017](017-split-config-jira-board/description.md) | Split config : séparation credentials Jira / config board | livré |
| [018](018-dev-time-allocation-wip-ratio/description.md) | dev-time-allocation : inclure WIP et corriger avgBugRatio | livré |
| [019](019-role-column-config/description.md) | Role column config | livré |
| [020](020-time-in-status-infra/description.md) | Time-in-status infra | livré |
| [021](021-stage-time-breakdown/description.md) | Stage Time Breakdown | livré |
| [022](022-wip-per-role/description.md) | WIP par rôle | livré |
| [023](023-stage-throughput-gap/description.md) | Stage Throughput Gap | livré |
| [024](024-handoff-rework-detection/description.md) | Handoff Rework Detection | livré |
| [025](025-first-time-right-rate/description.md) | First-Time-Right Rate | livré |
| [026](026-rapport-metriques-role-aware/description.md) | Rapport : métriques role-aware | livré |
| [027](027-rapport-cockpit-refonte/description.md) | Refonte rapport HTML vers design Cockpit | livré |
| [028](028-rapport-personnalisation-config/description.md) | Rapport HTML personnalisable via config YAML | livré |
| [029](029-rapport-template-handlebars/description.md) | Template Handlebars pour override HTML complet du rapport | livré |
| [030](030-support-jira-server-pat/description.md) | Support Jira Server / Data Center (PAT auth) | livré |
| [031](031-scope-change-db-sync/description.md) | Infra DB + sync : changements de champs Jira | livré |
| [032](032-scope-change-metric/description.md) | Métrique : détection de changement de périmètre | livré |
| [033](033-scope-change-report/description.md) | Rapport : graphe scope change + alerte | livré |
| [034](034-scope-change-fix-denominator/description.md) | Corriger le dénominateur de scope-change-rate | livré |
| [035](035-scope-change-description-only/description.md) | scope-change-rate : détection description uniquement | livré |
| [036](036-scope-change-reduce-false-positives/description.md) | scope-change-rate : réduire les faux positifs | livré |
| [037](037-bottleneck-analysis/description.md) | Bottleneck Analysis | livré |
| [038](038-fake-jira-connector/description.md) | Connecteur Jira fake (mode local sans accès Jira) | livré |
| [039a](039a-estimation-data-model/description.md) | Modèle de données estimation brute | livré |
| [039b](039b-estimation-bucketize/description.md) | Bucketize par méthode d'estimation | livré |
| [039c](039c-estimation-throughput-weighted/description.md) | Throughput pondéré adapté à la méthode d'estimation | livré |
| [039d](039d-estimation-rapport-adaptatif/description.md) | Rapport adaptatif selon méthode d'estimation | livré |
| [040](040-autoconfig-estimation/description.md) | Autoconfig détection de la méthode d'estimation | livré |
| [041a](041a-i18n-infra-cli/description.md) | i18n infrastructure + traduction messages CLI | livré |
| [041b](041b-i18n-report-html/description.md) | Traduction rapport HTML (labels + help texts) | livré |
| [041c](041c-i18n-readme/description.md) | Réécriture README en anglais | livré |
| [042](042-supprimer-renderhtml-hbs-defaut/description.md) | Supprimer renderHtml() (~1025 lignes) et faire de report.hbs le renderer par défaut | livré |
| [043](043-bottleneck-column-drilldown/description.md) | Identifier la colonne (statut) dominante au sein du rôle bottleneck | livré |
| [044](044-bottleneck-column-chart/description.md) | Drill-down par colonne Jira : médiane jours + nb tickets par statut dans onglet Rôles | livré |
| [045](045-vue-par-sprint-rapport/description.md) | Toggle semaines/sprints pour métriques débit dans le rapport HTML | livré |
| [046](046-kpi-seuils-dynamiques/description.md) | Seuils de santé KPI configurables : statique (board.yaml) ou dynamique (P50/P85 historiques) | livré |
| [047](047-rework-cost/description.md) | Coût en jours-ouvrés des retraitements par semaine et par sprint | livré |
| [048](048-bottleneck-drilldown-par-colonne-board/description.md) | Regrouper byColumn par colonne board.yaml plutôt que par statut Jira individuel | livré |
| [049](049-configurable-snapshot-window/description.md) | Fenêtre rolling snapshot configurable via metrics.snapshotWindowDays dans board.yaml | livré |
| [050](050-store-abstraction/description.md) | Abstraction de la couche de stockage (ReadStore / WriteStore) — métriques, snapshots, rapport et sync ne dépendent plus de SQLite | à faire |
