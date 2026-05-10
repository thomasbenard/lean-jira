# lean-jira — Spécification fonctionnelle

## Vue d'ensemble

CLI qui synchronise les données d'un board Jira Kanban, calcule des métriques de flux Lean, et génère un rapport HTML autonome avec tendances temporelles.

**Cas d'usage cible** : équipe Agile/Kanban souhaitant piloter par les métriques de flux sans dépendance à des outils BI tiers.

---

## Commandes CLI

| Commande | Description |
|---|---|
| `npm run sync` | Pull Jira → SQLite (issues + transitions + sprints) |
| `npm run metrics` | Calcule et affiche toutes les métriques |
| `npm run snapshots` | Recalcule l'historique hebdomadaire (`metric_snapshots`) |
| `npm run report` | Génère un rapport HTML autonome avec charts de tendances |
| `npm run refresh` | Enchaîne sync → snapshots → report (arrêt sur erreur) |
| `npm run validate` | Vérifie que les statuts du config existent en base (après un sync) |
| `npm run autoconfig` | Génère `board.columns` depuis l'API Jira. Colonnes intermédiaires inférées `queue` si le nom contient un mot-clé connu (review, validation, valider, attente, wait, waiting, approval, approuver, staging, qa), sinon `active`. Commentaire YAML inline indique le mot-clé déclencheur pour les colonnes `queue` inférées. Si `board.columns` existe déjà : fusionne (préserve `type`/`devStart`/`legacyStatuses`, met à jour `statuses`). Avec `--apply` : écrit dans `board.yaml` + backup `.bak`. Détecte les statuts legacy depuis l'historique DB. Warnings et commentaire YAML des statuts non classés affichés en fin de sortie. |
| `npm run build` | Compile TypeScript → `./dist` |
| `npm start` | Lance le build compilé |

### Options `metrics`

| Option | Description |
|---|---|
| `-c, --config <path>` | Chemin config YAML (défaut : `./config.yaml`) |
| `-m, --metric <name>` | Métrique unique à exécuter |
| `--json` | Sortie JSON brut |
| `--include-outliers` | Ne pas filtrer les outliers extrêmes |

### Options `report`

| Option | Description |
|---|---|
| `-c, --config <path>` | Chemin config YAML (défaut : `./config.yaml`) |
| `-b, --board-config <path>` | Chemin board YAML (défaut : `./board.yaml`) |
| `-o, --output <path>` | Fichier HTML de sortie (défaut : `./report.html`) |

### Options `refresh`

| Option | Description |
|---|---|
| `-c, --config <path>` | Chemin config YAML (défaut : `./config.yaml`) |
| `-b, --board-config <path>` | Chemin board YAML (défaut : `./board.yaml`) |
| `-o, --output <path>` | Fichier HTML de sortie (défaut : `./report.html`) |

Permet de générer des rapports distincts pour plusieurs squads en parallèle :
```bash
npm run refresh -- -c config.keck.yaml -b board.yaml -o report.keck.html
npm run refresh -- -c config.kepler.yaml -b board.yaml -o report.kepler.html
```

---

## Configuration (`config.yaml`)

```yaml
jira:
  baseUrl: "https://your-jira.atlassian.net"
  email: "user@example.com"
  apiToken: "xxx"
  projectKey: "KECK"
  boardId: 42
  name: "Ma Squad"                  # optionnel — affiché dans le titre du rapport

board:
  columns:
    - name: "À faire"
      type: todo
      statuses:
        - "To Do"

    - name: "Développement"
      type: active
      devStart: true              # cycle time démarre ici
      statuses:
        - "In Development"
      legacyStatuses:             # anciens noms renommés, conservés pour l'historique
        - "Dev in progress"

    - name: "Review"
      type: queue                 # queue time pour flow-efficiency
      statuses:
        - "In Review"
        - "Ready for QA"

    - name: "Done"
      type: done
      statuses:
        - "Done"

  legacyDoneStatuses:             # statuts done renommés absents de l'API Jira courante
    - "To Be Validated"

metrics:
  cutoffDate: "2024-01-01"        # Ignorer les issues livrées avant cette date
  bugIssueTypes:
    - "Bug"

db:
  path: "./jira.db"
```

### Rôle des colonnes et dérivation des statuts

Le board est défini comme une liste ordonnée de colonnes. Chaque colonne a un `type`, une liste de `statuses` (noms courants) et une liste optionnelle de `legacyStatuses` (anciens noms renommés). Le système dérive automatiquement les listes de statuts nécessaires aux métriques :

| `type` colonne | Liste dérivée | Rôle dans les métriques |
|---|---|---|
| `todo` | `todoStatuses` | Début du **lead time** |
| `active` + `devStart: true` | `devStartStatuses` | Début du **cycle time** |
| `active` ∪ `queue` | `inProgressStatuses` | Calcul du **WIP** courant et historique |
| `active` | `activeStatuses` | "Touch time" pour `flow-efficiency` |
| `queue` | `queueStatuses` | "Queue time" pour `flow-efficiency` |
| `done` ∪ `legacyDoneStatuses` | `doneStatuses` | Définit la **livraison équipe** (`done_at`) |

Pour chaque colonne, `legacyStatuses` alimente les mêmes listes dérivées que `statuses` : les anciens noms sont inclus dans les calculs de métriques pour couvrir l'historique des transitions.

`legacyDoneStatuses` (niveau board) : alternative pour les statuts done renommés ; convention recommandée pour les statuts de livraison, car elle est distincte des colonnes non-done.

| Paramètre | Rôle |
|---|---|
| `metrics.cutoffDate` | Borne basse globale : issues livrées avant sont ignorées. |
| `metrics.bugIssueTypes` | Bucket dédié BUG, exclu des métriques normalized/weighted. |

---

## Métriques

### Principe de livraison équipe (team-done)

La **livraison** d'une issue est définie comme sa **première transition vers un statut dont `statusCategory = done`** (au sens Jira), ou vers un statut listé dans `doneStatuses` (pour les anciens noms renommés).

Ce choix exclut les délais de validation post-livraison (ex: sur le board KECK, "À valider" porte `statusCategory=done` mais les tickets y attendent la validation PO). Les métriques reflètent le temps de l'équipe, pas le temps total de résolution.

### Filtre outliers

Par défaut, les valeurs extrêmes (queue droite de la distribution) sont exclues des calculs de moyenne et percentiles via la méthode Tukey (Q3 + 1,5 × IQR). Désactivable avec `--include-outliers`. La médiane et P85 ne sont que peu affectées.

### Buckets de taille

Basés sur l'estimation initiale (`originalEstimate`) de l'issue (1 jour = 8 h) :

| Bucket | Critère |
|---|---|
| XS | < 0,5 j |
| S | 0,5 – 1 j |
| M | 1 – 3 j |
| L | 3 – 5 j |
| XL | ≥ 5 j |
| BUG | Issue de type bug (quelle que soit l'estimation) |
| UNESTIMATED | Pas d'estimation ou estimation ≤ 0 |

### Catalogue des métriques

| Nom | Ce que ça mesure | Population |
|---|---|---|
| `lead-time` | Délai total : entrée backlog (todo) → livraison équipe | Issues avec transition todo ET transition devStart |
| `lead-time-by-size` | Lead time agrégé par bucket de taille | Idem |
| `lead-time-normalized` | Ratio lead time réel / estimation (détecte les dérives de chiffrage) | Idem lead-time, estimées, hors bugs |
| `cycle-time` | Délai de dev : début dev actif → livraison équipe | Issues avec transition todo ET transition devStart |
| `cycle-time-by-size` | Cycle time agrégé par bucket de taille | Idem |
| `cycle-time-normalized` | Ratio cycle time réel / estimation | Idem cycle-time, estimées, hors bugs |
| `bug-cycle-time` | Cycle time des bugs uniquement (pas d'invariant todo requis) | Issues de type bug |
| `throughput` | Nombre d'issues livrées par semaine | Toutes issues |
| `bug-throughput` | Nombre de bugs livrés par semaine | Issues de type bug |
| `throughput-weighted` | Jours-personnes estimés livrés par semaine (proxy de valeur) | Issues estimées non-bug |
| `wip` | Issues actuellement en cours dans le sprint actif | Sprint actif courant |
| `flow-efficiency` | % du temps réellement travaillé vs temps total en cycle (actif / (actif + queue)) | Issues livrées sur fenêtre cycle-time |
| `aging-wip` | Âge des items en cours comparé aux percentiles historiques de cycle time (classification de risque) | WIP courant |
| `forecast` | Fourchette Monte Carlo de livraisons possibles sur 1/2/4/8 semaines, basée sur les 12 dernières semaines de throughput | Historique récent |
| `dev-time-allocation` | Somme des cycle times livrés **+ WIP en cours** par semaine, split features vs bugs. `avgBugRatio = totalBugDays / totalDays` (pondéré par volume). Détecte la dérive vers le mode pompier sans lag de livraison. | Issues avec transition todo ET devStart (livrées ou en cours) |
| `bug-backlog` | Nombre de bugs ouverts à la fin de chaque semaine (`openCount`) et flux net hebdomadaire `closed − created` (`netFlow`). `netFlow > 0` = backlog se réduit, `< 0` = grossit. Pas de scoping sprint. | Tous les bugs (issues de type `bugIssueTypes`) |
| `stage-time-breakdown` | Temps médian passé dans chaque rôle (dev/qa/po) sur la population cycle-time. `avgShareByRole` = part moyenne de chaque rôle dans le temps role-observable. Révèle où le lead time est consommé. Requiert `role: dev\|qa\|po` sur les colonnes du board. | Population cycle-time (todo + devStart + livrée) |
| `wip-per-role` | Nombre de tickets en cours dans chaque rôle (dev/qa/po) à l'instant T. Sans scoping sprint. Permet de détecter le rôle saturé en daily standup. | WIP global (issues.current_status) |
| `stage-throughput-gap` | Entrées et sorties par rôle par semaine ISO. `devNet = devIn − devOut`. Net positif = accumulation d'inventaire dans ce rôle. Fenêtre 30j en snapshot, complète en CLI. | Toutes transitions sur la période |
| `handoff-rework` | % de tickets retournant en arrière entre rôles (`reworkRatio`), nombre moyen de reworks par ticket (`avgReworks`), et décompte par type (qaToDev, poToQa, poDev). | Population cycle-time, rolling 30j |
| `first-time-right` | % de tickets traversant chaque rôle en un seul passage continu (`ftrRate`). Complément de `handoff-rework` : KPI lisible par rôle. | Population cycle-time, rolling 30j |
| `scope-change-rate` | % d'issues dont la description, l'estimation ou l'affectation de sprint a changé après entrée en sprint. Détecte la dérive de périmètre US post-engagement. | Toutes issues avec historique Sprint dans `issue_field_changes` |

**Invariant lead/cycle** : les métriques `lead-time` et `cycle-time` (et leurs variantes) filtrent sur les issues ayant **à la fois** une transition `todoStatuses` et une transition `devStartStatuses`, ce qui garantit `lead_time ≥ cycle_time` par issue et rend les percentiles comparables.

### Statistiques calculées pour chaque métrique temporelle

| Stat | Description |
|---|---|
| Moyenne | Sensible aux outliers ; à lire avec prudence |
| Médiane (P50) | Valeur typique, robuste aux outliers |
| P85 | 85 % des issues livrées en moins de ce délai |
| P95 | Plafond pratique (engagement SLA) |

### Forecast Monte Carlo

- Pool : 12 dernières semaines de throughput réel
- Simulations : 10 000 tirages aléatoires
- Horizons : 1, 2, 4, 8 semaines
- P15 = engagement à 85 % de confiance ("au moins ce nombre d'issues livrées")
- P50 = médiane (livraison la plus probable)
- P85/P95 = scénarios optimistes

---

## Rapport HTML

Fichier autonome (aucune dépendance serveur). Prérequis :

```bash
npm run sync       # Données fraîches
npm run snapshots  # Historique à jour
npm run report     # Génère ./report.html
```

### En-tête

La ligne de métadonnées affiche :
```
Généré le {YYYY-MM-DD HH:MM} · Données Jira du {YYYY-MM-DD HH:MM} · Dernière fenêtre hebdo : {YYYY-MM-DD}
```

- La date « Données Jira » est lue depuis `MAX(sync_log.synced_at)` filtré sur le `project_key` courant.
- Si aucun sync n'a jamais été effectué : `Données Jira : jamais synchronisé`.
- Si le dernier sync date de plus de 7 jours calendaires (seuil strict `>`), un bandeau pleine largeur s'affiche sous l'en-tête : fond `#fff3cd`, bordure `#f59e0b`, texte `#92400e`. Le bandeau est permanent (pas de bouton fermer). Il s'affiche également si aucun sync n'a jamais été effectué.

### Contenu

Le rapport est organisé en 4 sections thématiques H2, dans cet ordre :

#### 1. Livraison

- **KPIs** (4, dernière fenêtre) : lead time médian, cycle time médian, throughput (7j), WIP. Si `metrics.healthThresholds` est configuré dans `board.yaml`, chaque KPI concerné affiche un point coloré (●) avant sa valeur : vert (zone saine), orange (à surveiller), rouge (dégradé). Signal absent si le seuil n'est pas configuré pour ce KPI ou si la valeur est `null`.
- **Graphes principaux** (5) : lead time, cycle time, throughput, throughput pondéré, WIP. Chaque graphique affiche une courbe de tendance superposée calculée par moyenne mobile sur une fenêtre de 4 semaines (gris ardoise `#64748b88`, pointillé `[6,4]`, label "Tendance"). Les 3 premiers points ne sont pas tracés (fenêtre insuffisante).
- **Distribution cycle time** : histogramme avec lignes P50/P85/P95.
- **Par taille** : tableaux statiques lead time et cycle time par bucket (dernière snapshot : count/médiane/P85).
- **Métriques avancées** (accordéon `<details>`, fermé par défaut, fond grisé) : lead normalisé, cycle normalisé, flow efficiency + deux graphiques de séries temporelles by-size (lead time et cycle time par bucket sélectionnable). Chaque graphique by-size affiche P50/P85/P95 pour le bucket actif avec courbe de tendance sur la médiane. Bucket par défaut : celui avec le plus grand count. Sélecteur interactif côté client, sans rechargement. Un seul bucket disponible → bouton non cliquable.

#### 2. Bugs & dette qualité

- **KPIs** (3) : bugs livrés (7j), bug cycle time médian, bug ratio moyen. Bug cycle time médian et bug ratio moyen affichent également le signal de santé si configuré.
- **Graphes** (4) : bug throughput, bug cycle time, allocation dev features vs bugs, bug backlog. Le graphe **Bug Backlog** est double-axe : barres hebdomadaires `netFlow` (vert si ≥ 0, rouge si < 0) sur l'axe droit, courbe `openCount` sur l'axe gauche.

#### 3. Capacité & prévision

- **Forecast Monte Carlo** : table P15/P50/P85/P95 par horizon.
- **Aging WIP** : scatter (statut × âge) avec seuils P50/P85/P95 + table top 15 par âge avec classification de risque. Les clés d'issues dans la table sont des liens cliquables ouvrant la page Jira correspondante (`{baseUrl}/browse/{key}`) dans un nouvel onglet.

#### 4. Flux par rôle

Toujours visible (pas dans un accordéon). Affiche les 5 métriques role-aware issues des tickets 021–025.

- **Stage time breakdown** : 3 KPI cards (médiane dev/qa/po), graphique barres groupées P50+P85 par rôle, donut de répartition moyenne du cycle time (dernière snapshot).
- **WIP par rôle** : 3 KPI cards (WIP dev/qa/po), courbe WIP par rôle sur le temps.
- **Stage throughput gap** : graphique barres groupées flux net (entrées − sorties) par rôle ; axe Y peut être négatif.
- **Handoff rework** : 2 KPI cards (% tickets avec rework, reworks/ticket), courbe taux de rework, graphique barres reworks par type (qaToDev/poToQa/poDev).
- **First-time-right rate** : 3 KPI cards (FTR dev/qa/po en %), courbe FTR par rôle.

Si aucune colonne `role:` n'est configurée dans `board.yaml`, aucune snapshot role-aware n'existe → graphiques vides sans erreur.

#### Transverse

- **Popovers d'aide** au survol pour chaque métrique (bouton `?` inline).

### Rapport adaptatif selon la méthode d'estimation

Le rapport adapte son contenu en fonction de `metrics.estimation.method` dans `board.yaml` :

| Section | `none` | `t-shirt` | `story-points` | `numeric` | `time` |
|---|---|---|---|---|---|
| Throughput pondéré | masqué | masqué | visible (SP) | visible (pts) | visible (j-h) |
| Lead/Cycle normalisé | masqué | masqué | masqué | masqué | visible |
| By-size (tableaux + graphiques) | masqué | visible | visible | visible | visible |

Un bandeau `estimation-context` est toujours présent sous l'en-tête, indiquant la méthode active et ses paramètres (seuils de taille pour story-points, etc.).

Quand les métriques normalisées sont visibles (`method: time`), une note explicative signale que ces métriques sont basées sur le ratio temps réel / temps estimé et qu'il est préférable de se fier aux métriques de flux (lead time, cycle time).

En l'absence de section `estimation` dans `board.yaml`, la méthode `time` est appliquée implicitement.
