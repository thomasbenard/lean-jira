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
| `-o, --output <path>` | Fichier HTML de sortie (défaut : `./report.html`) |

---

## Configuration (`config.yaml`)

```yaml
jira:
  baseUrl: "https://your-jira.atlassian.net"
  email: "user@example.com"
  apiToken: "xxx"
  projectKey: "KECK"
  boardId: 42

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
| `lead-time-normalized` | Ratio lead time réel / estimation (détecte les dérives de chiffrage) | Issues estimées non-bug |
| `cycle-time` | Délai de dev : début dev actif → livraison équipe | Issues avec transition todo ET transition devStart |
| `cycle-time-by-size` | Cycle time agrégé par bucket de taille | Idem |
| `cycle-time-normalized` | Ratio cycle time réel / estimation | Issues estimées non-bug |
| `bug-cycle-time` | Cycle time des bugs uniquement (pas d'invariant todo requis) | Issues de type bug |
| `throughput` | Nombre d'issues livrées par semaine | Toutes issues |
| `bug-throughput` | Nombre de bugs livrés par semaine | Issues de type bug |
| `throughput-weighted` | Jours-personnes estimés livrés par semaine (proxy de valeur) | Issues estimées non-bug |
| `wip` | Issues actuellement en cours dans le sprint actif | Sprint actif courant |
| `flow-efficiency` | % du temps réellement travaillé vs temps total en cycle (actif / (actif + queue)) | Issues livrées sur fenêtre cycle-time |
| `aging-wip` | Âge des items en cours comparé aux percentiles historiques de cycle time (classification de risque) | WIP courant |
| `forecast` | Fourchette Monte Carlo de livraisons possibles sur 1/2/4/8 semaines, basée sur les 12 dernières semaines de throughput | Historique récent |

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

1. **KPIs actuels** (dernière fenêtre) : lead time médian, cycle time médian, throughput, WIP, bugs livrés, bug cycle médian, flow efficiency.
2. **Tendances hebdomadaires** : 9 graphiques (lead time, cycle time, throughput, throughput pondéré, WIP, bugs, bug cycle time, cycle normalisé, flow efficiency).
3. **Distribution cycle time** : histogramme avec lignes P50/P85/P95.
4. **Forecast Monte Carlo** : table P15/P50/P85/P95 par horizon.
5. **Aging WIP** : scatter (statut × âge) avec seuils P50/P85/P95 + table top 15 par âge avec classification de risque. Les clés d'issues dans la table sont des liens cliquables ouvrant la page Jira correspondante (`{baseUrl}/browse/{key}`) dans un nouvel onglet.
6. **Par taille** : tableaux statiques lead time et cycle time par bucket (dernière snapshot : count/médiane/P85) + deux graphiques de séries temporelles (lead time et cycle time). Chaque graphique affiche P50/P85/P95 pour le bucket sélectionné via une rangée de boutons (un par bucket ayant des données). Bucket par défaut : celui avec le plus grand nombre d'issues (stat `count`). Sélecteur interactif côté client, sans rechargement. Un seul bucket disponible → bouton non cliquable.
7. **Popovers d'aide** au survol pour chaque métrique.
