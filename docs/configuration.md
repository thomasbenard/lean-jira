# Guide de configuration lean-jira

> **Objectif :** configurer lean-jira depuis zéro et générer un premier rapport en moins de 15 minutes.

**Lien rapide :** si tu es déjà configuré → [Référence complète](#5-référence-complète)

---

## Table des matières

1. [Pré-requis — ce qu'il faut récupérer dans Jira](#1-pré-requis--ce-quil-faut-récupérer-dans-jira)
2. [config.yaml — connexion Jira](#2-configyaml--connexion-jira)
3. [board.yaml — définition du board](#3-boardyaml--définition-du-board)
4. [Valider et premier lancement](#4-valider-et-premier-lancement)
5. [Référence complète](#5-référence-complète)
6. [Cas avancés](#6-cas-avancés)
7. [Troubleshooting](#7-troubleshooting)

---

## 1. Pré-requis — ce qu'il faut récupérer dans Jira

Avant de créer les fichiers de config, récupérer ces 3 informations depuis Jira :

| Information | Où la trouver | Exemple |
|---|---|---|
| `projectKey` | URL du board : `.../jira/software/projects/**PROJ**/boards` | `PROJ` |
| `boardId` | URL du board : `...?rapidView=**42**` ou dans l'URL de configuration du board | `42` |
| Token d'authentification | Voir encadré ci-dessous | — |

### Quel type d'auth choisir ?

```
Mon instance Jira est...
│
├── Jira Cloud (*.atlassian.net)
│   ├── Auth Basic fonctionne ?
│   │   └── OUI → email + apiToken  (→ Section 2, Bloc 1)
│   └── Domaine custom / Basic bloqué ?
│       └── OUI → gateway Atlassian  (→ Section 2, Bloc 2)
│
└── Jira Server ou Data Center
    ├── Version ≥ 8.14 ?
    │   └── OUI → PAT recommandé     (→ Section 2, Bloc 3)
    └── Version < 8.14
        └── Basic uniquement         (→ Section 2, Bloc 1)
```

**Créer un token API (Jira Cloud) :**
1. Jira → icône profil → **Gérer le compte**
2. **Sécurité** → **Créer et gérer des tokens d'API**
3. Créer un token, copier la valeur (non récupérable après fermeture)

**Créer un PAT (Jira Server/DC) :**
1. Jira → icône profil → **Profil**
2. **Personal Access Tokens** → **Créer un token**

---

## 2. `config.yaml` — connexion Jira

```bash
cp config.example.yaml config.yaml
# puis éditer config.yaml avec vos valeurs
```

> `config.yaml` est gitignoré — ne jamais le versionner (il contient vos secrets).

---

### Bloc 1 — Jira Cloud, auth Basic

```yaml
jira:
  baseUrl: "https://your-company.atlassian.net"
  email: "you@company.com"
  apiToken: "YOUR_API_TOKEN"
  projectKey: "PROJ"
  boardId: 42
  name: "Ma Squad"          # Optionnel — titre dans le rapport

db:
  path: "./lean-jira.db"
```

---

### Bloc 2 — Jira Cloud, domaine custom (gateway Atlassian)

À utiliser si votre domaine custom bloque l'auth Basic (erreur 401 avec le Bloc 1).

```yaml
jira:
  baseUrl: "https://api.atlassian.com/ex/jira/YOUR_CLOUD_ID/"
  frontendUrl: "https://your-company.com"   # obligatoire ici — sert aux liens du rapport
  email: "you@company.com"
  apiToken: "YOUR_API_TOKEN"
  projectKey: "PROJ"
  boardId: 42

db:
  path: "./lean-jira.db"
```

**Récupérer `YOUR_CLOUD_ID` :**
```bash
curl https://your-company.com/_edge/tenant_info
# Réponse : {"cloudId":"xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx", ...}
```

---

### Bloc 3 — Jira Server / Data Center (PAT)

```yaml
jira:
  baseUrl: "https://jira.your-company.com"
  personalAccessToken: "YOUR_PAT"
  projectKey: "PROJ"
  boardId: 42

db:
  path: "./lean-jira.db"
```

> `email` et `apiToken` sont ignorés si `personalAccessToken` est présent et non vide.

---

✓ **Config.yaml prête.** Passer à la section suivante.

---

## 3. `board.yaml` — définition du board

`board.yaml` mappe votre workflow Jira aux métriques Lean. Deux voies :

| Voie | Quand l'utiliser |
|---|---|
| **A — `autoconfig`** (recommandée) | Nouvelle installation, workflow Jira standard |
| **B — Manuelle** | Workflow complexe, ajustements fins requis |

---

### 3a. Voie A — `autoconfig` (recommandée)

`autoconfig` interroge l'API Jira et génère `board.yaml` automatiquement.

**Étape 1 — Dry-run (inspecter avant d'appliquer) :**
```bash
npm run autoconfig
```
Affiche le YAML inféré sur stdout. Aucun fichier écrit.

**Étape 2 — Appliquer :**
```bash
npm run autoconfig -- --apply
```
Écrit `board.yaml`. Si un `board.yaml` existe déjà, sauvegardé en `board.yaml.bak`.

**Ce qu'`autoconfig` fait automatiquement :**
- Récupère les colonnes du board depuis l'API Jira
- Assigne le `type` de chaque colonne (`todo`, `active`, `queue`, `done`)
- Pose `devStart: true` sur la première colonne `active`
- Détecte les colonnes "queue" par mots-clés : review, validation, valider, attente, wait, waiting, approval, approuver, staging, qa…
- Si une base SQLite existe déjà : ajoute les statuts renommés dans `legacyDoneStatuses`
- Calcule les `bucketThresholds` (seuils XS/S/M/L) par percentiles P25/P50/P75/P90 sur les données d'estimation réelles (≥ 30 issues estimées requises) ; fallback sur des valeurs par défaut sinon

**Ce qu'il faut toujours vérifier manuellement après génération :**
- Le `devStart: true` est sur la bonne colonne (début du travail actif réel)
- Les colonnes `type: queue` correspondent bien à des files d'attente (pas du travail actif)
- Ajouter `role: dev | qa | po` sur les colonnes si vous voulez les métriques role-aware (voir Section 3b)
- Vérifier `cutoffDate` si votre historique Jira a subi un bulk-close

---

### 3b. Voie B — Configuration manuelle

```bash
cp board.example.yaml board.yaml
# puis éditer board.yaml
```

#### Types de colonnes

Chaque colonne du board a un `type` qui détermine son rôle dans les métriques :

| `type` | Signification | Impact métrique |
|---|---|---|
| `todo` | File d'attente initiale | Début du **lead time** |
| `active` + `devStart: true` | Début du travail actif | Début du **cycle time** |
| `active` | Travail en cours (sans être le devStart) | "Touch time" → **flow efficiency** + WIP |
| `queue` | File d'attente intermédiaire | "Queue time" → **flow efficiency** + WIP |
| `done` | Livraison équipe | Définit `done_at` pour toutes les métriques |

> **`devStart: true`** peut être posé sur plusieurs colonnes — leurs statuts sont unionés. Exemple : si "Analyse" et "Développement" marquent tous deux le début du travail, les deux peuvent avoir `devStart: true`.

#### Exemple complet

```yaml
board:
  columns:
    - name: "Backlog"
      type: todo
      statuses:
        - "To Do"
        - "Ready"

    - name: "Développement"
      type: active
      devStart: true
      role: dev          # optionnel — active métriques role-aware
      statuses:
        - "In Progress"

    - name: "Code Review"
      type: queue
      role: qa
      statuses:
        - "In Review"

    - name: "QA"
      type: active
      role: qa
      statuses:
        - "In QA"

    - name: "Validation PO"
      type: queue
      role: po
      statuses:
        - "À valider"

    - name: "Done"
      type: done
      statuses:
        - "Done"
        - "Livré"

metrics:
  bugIssueTypes:
    - "Bug"
```

#### Champ `role:` — métriques role-aware

Le champ `role: dev | qa | po` est **optionnel**. Il active les métriques : stage time breakdown, WIP par rôle, throughput gap, handoff rework, first-time-right.

Sans `role:` sur aucune colonne : ces métriques et l'onglet "Flux par rôle" du rapport sont silencieusement masqués.

> Règle : une colonne de travail actif → `role: dev` ou `role: qa` selon qui travaille. Une colonne de validation → `role: po`. Les files d'attente entre deux rôles peuvent aussi avoir un `role:`.

---

### 3c. Cas particuliers

#### `legacyDoneStatuses` — statuts renommés dans Jira

Si votre historique Jira contient des transitions vers des statuts qui **n'existent plus dans l'API courante** (parce qu'ils ont été renommés), lean-jira ne peut pas les détecter comme "done" automatiquement.

Symptôme : throughput anormalement bas sur l'historique ancien, alors que les tickets sont bien fermés dans Jira.

Fix :
```yaml
board:
  legacyDoneStatuses:
    - "Delivered"      # ancien nom, renommé en "Done" lors d'une migration
    - "DELIVERED"      # variante casse
```

> Garder cette liste minimale — n'ajouter que les statuts présents dans l'historique des transitions mais absents de `/rest/api/2/status`.

#### `cutoffDate` — ignorer l'historique avant une date

Si votre instance Jira a subi un **bulk-close** (fermeture en masse de tickets lors d'une migration de workflow), le throughput sera artificiellement gonflé sur la période concernée.

Fix : ignorer toutes les issues livrées avant la date du bulk-close.

```yaml
metrics:
  cutoffDate: "2025-11-01"   # ignorer les livraisons antérieures à cette date
```

> `cutoffDate` affecte `lead-time`, `cycle-time`, `throughput` et toutes les métriques de durée. Les issues livrées avant cette date sont exclues des calculs et du rapport.

---

## 4. Valider et premier lancement

### Étape 1 — Valider la config board

```bash
npm run validate
```

Vérifie que chaque statut listé dans `board.yaml` existe bien en base (table `statuses` peuplée par `sync`).

**Sortie attendue (tout OK) :**
```
todoStatuses
  ✓ To Do
  ✓ Ready

devStartStatuses
  ✓ In Progress

inProgressStatuses
  ✓ In Progress
  ✓ In Review

doneStatuses
  ✓ Done

activeStatuses
  ✓ In Progress

queueStatuses
  ✓ In Review

✓ Config valide.
```

**Sortie si problème :**
```
todoStatuses
  ✓ To Do
  ✗ Backlog   ← introuvable en base

Statuts disponibles en base :
  To Do                          (new)
  In Progress                    (indeterminate)
  In Review                      (indeterminate)
  Done                           (done)

1 statut(s) introuvable(s). Vérifier board.yaml.
```

> Si un statut est marqué `✗` : copier le nom exact depuis la liste "Statuts disponibles en base" et corriger `board.yaml`.

**Erreur "Base vide" :**
```
Base vide. Lancer npm run sync d'abord.
```
→ Lancer `npm run sync` puis relancer `npm run validate`.

---

### Étape 2 — Premier sync

```bash
npm run sync
```

Pull de tous les tickets, transitions et sprints depuis Jira → SQLite. Durée : quelques secondes à quelques minutes selon la taille du projet.

---

### Étape 3 — Premier rapport

```bash
npm run refresh
```

Enchaîne `sync → snapshots → report`. Génère `./report.html`.

Ouvrir `report.html` dans un navigateur. Si les métriques semblent incorrectes :
- Cycle time à 0 → voir [Troubleshooting](#7-troubleshooting)
- Métriques role-aware absentes → voir [Section 3b](#champ-role--métriques-role-aware)

---

✓ **Installation terminée.** Pour regénérer le rapport : `npm run refresh`.

---

## 5. Référence complète

### `config.yaml` — tous les champs

#### Section `jira:`

| Champ | Type | Requis | Défaut | Description |
|---|---|---|---|---|
| `baseUrl` | string | Oui | — | URL de base de l'instance Jira. Pour le gateway Atlassian : `https://api.atlassian.com/ex/jira/<cloudId>/` |
| `frontendUrl` | string | Non* | — | URL de l'interface Jira pour les liens cliquables du rapport. *Obligatoire si `baseUrl` pointe vers le gateway Atlassian |
| `email` | string | Non* | — | Email du compte Jira. *Requis pour auth Basic |
| `apiToken` | string | Non* | — | Token API Jira. *Requis pour auth Basic |
| `personalAccessToken` | string | Non* | — | PAT Jira Server/DC. *Prend le dessus sur `email`/`apiToken` si présent et non vide |
| `projectKey` | string | Oui | — | Clé du projet Jira (ex: `PROJ`) |
| `boardId` | number | Oui | — | ID numérique du board Jira (visible dans l'URL) |
| `name` | string | Non | `projectKey` | Nom affiché dans le titre du rapport HTML |
| `mode` | `"real"` \| `"fake"` | Non | `"real"` | `"fake"` pour utiliser les fixtures JSON embarquées sans connexion Jira |
| `frozenNow` | string (YYYY-MM-DD) | Non* | — | *Obligatoire si `mode: fake`. Fige la date "aujourd'hui" pour un output déterministe |
| `fixturesPath` | string | Non | `"./src/jira/fixtures"` | Chemin vers les fixtures JSON pour le mode fake |

#### Section `db:`

| Champ | Type | Requis | Défaut | Description |
|---|---|---|---|---|
| `db.path` | string | Oui | — | Chemin vers le fichier SQLite (sera créé s'il n'existe pas) |

---

### `board.yaml` — tous les champs

#### Section `board.columns[]:`

| Champ | Type | Requis | Description |
|---|---|---|---|
| `name` | string | Oui | Nom de la colonne (affiché dans les logs) |
| `type` | `"todo"` \| `"active"` \| `"queue"` \| `"done"` | Oui | Rôle de la colonne dans les métriques (voir Section 3b) |
| `devStart` | boolean | Non | `true` = début du cycle time. Peut être posé sur plusieurs colonnes (statuts unionés) |
| `role` | `"dev"` \| `"qa"` \| `"po"` | Non | Active les métriques role-aware pour cette colonne |
| `statuses[]` | string[] | Oui | Liste des noms de statuts Jira exacts (casse significative) |

#### Section `board:` (hors colonnes)

| Champ | Type | Requis | Description |
|---|---|---|---|
| `legacyDoneStatuses[]` | string[] | Non | Statuts historiques renommés, absents de l'API Jira courante, à considérer comme "done" |

#### Section `metrics:`

| Champ | Type | Requis | Défaut | Description |
|---|---|---|---|---|
| `cutoffDate` | string (YYYY-MM-DD) | Non | — | Issues livrées avant cette date ignorées par toutes les métriques |
| `bugIssueTypes[]` | string[] | Non | `[]` | Types Jira traités comme bugs (bucket `BUG`, métriques `bug-*`) |
| `excludeIssueTypes[]` | string[] | Non | `[]` | Types Jira exclus de toutes les métriques |
| `scopeChangeGracePeriodHours` | number | Non | — | Délai (en heures) après entrée en sprint avant lequel un changement de scope n'est pas comptabilisé |
| `healthThresholds` | object | Non | — | Seuils des signaux de santé KPI dans le rapport (voir ci-dessous) |
| `estimation` | object | Non | `{ method: "time" }` | Méthode d'estimation utilisée (voir `board.example.yaml`). `bucketThresholds` générés automatiquement par `autoconfig` (calibrés sur données réelles ou valeurs par défaut) |

**`healthThresholds` — détail :**

| Clé | Type | Défaut | Description |
|---|---|---|---|
| `mode` | `"static"` \| `"dynamic"` | `"static"` | Mode de calcul des seuils |
| `windowWeeks` | number | `12` | Fenêtre historique en semaines (mode `dynamic` uniquement) |
| `leadTimeMedianDays` | `{ warn, crit }` | — | Médiane lead time (bas = mieux) |
| `cycleTimeMedianDays` | `{ warn, crit }` | — | Médiane cycle time (bas = mieux) |
| `throughputWeekly` | `{ warn, crit }` | — | Throughput hebdo moyen (haut = mieux) |
| `wipCount` | `{ warn, crit }` | — | WIP courant (bas = mieux) |
| `bugCycleTimeMedianDays` | `{ warn, crit }` | — | Médiane cycle time bugs (bas = mieux) |
| `bugRatio` | `{ warn, crit }` | — | Part des bugs dans les livraisons (bas = mieux) |

**Mode `static`** (défaut) : les seuils `{ warn, crit }` sont utilisés tels quels. Absent = aucun signal.

**Mode `dynamic`** : les seuils sont calculés automatiquement depuis les `windowWeeks` dernières semaines de `metric_snapshots`. Pour chaque KPI : `warn = P50` (médiane historique), `crit = P85` (pour métriques bas = mieux) ou `P15` (pour throughput). Minimum 4 semaines de données requis — en-dessous, le signal reste absent. Un `{ warn, crit }` défini explicitement dans `healthThresholds` pour un KPI donné prend le dessus sur la valeur dynamique pour ce KPI uniquement.

```yaml
# Exemple mode dynamique avec override throughput
metrics:
  healthThresholds:
    mode: dynamic
    windowWeeks: 12
    throughputWeekly:   # override : on connaît le minimum attendu
      warn: 3
      crit: 1
```

#### Section `report:` (dans `board.yaml`)

| Champ | Type | Requis | Description |
|---|---|---|---|
| `title` | string | Non | Remplace "Rapport Lean — {projectKey}" dans le `<title>` HTML et l'en-tête |
| `logoUrl` | string | Non | Chemin local (`.png`, `.jpg`, `.svg`, `.webp` — embarqué en base64) ou URL `http(s)` |
| `fontUrl` | string | Non | Remplace le lien Google Fonts IBM Plex dans le rapport |
| `customCssPath` | string | Non | Chemin vers un fichier `.css` injecté après le style par défaut (cascade normale) |
| `excludeTabs[]` | string[] | Non | Onglets à masquer : `delivery`, `quality`, `roles`, `forecast`, `advanced` |
| `templatePath` | string | Non | Chemin vers un template Handlebars `.hbs` custom (remplace le rendu HTML intégral) |

> Chemins `logoUrl`, `customCssPath`, `templatePath` résolus depuis le répertoire de `board.yaml`.

---

## 6. Cas avancés

### Multi-squad — plusieurs rapports depuis une base commune

Si plusieurs squads partagent le même projet Jira mais veulent des rapports distincts :

```bash
# Squad A
npm run refresh -- -c config.squad-a.yaml -b board.squad-a.yaml -o report.squad-a.html

# Squad B
npm run refresh -- -c config.squad-b.yaml -b board.squad-b.yaml -o report.squad-b.html
```

Chaque squad peut avoir son propre `config.yaml` (projectKey différent) et son propre `board.yaml` (colonnes, cutoffDate, thresholds adaptés).

---

### Personnalisation du rapport HTML

Le rapport est un fichier HTML autonome (aucun serveur requis, partageable par email/Slack).

**Logo et titre :**
```yaml
report:
  title: "Équipe Plateforme — Lean Metrics"
  logoUrl: "./assets/logo.png"    # embarqué en base64 dans le HTML
```

**Police personnalisée :**
```yaml
report:
  fontUrl: "https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap"
```

**CSS additionnel (sans modifier le template) :**
```yaml
report:
  customCssPath: "./my-report.css"
```

**Masquer des onglets :**
```yaml
report:
  excludeTabs:
    - roles      # masquer l'onglet "Flux par rôle"
    - forecast   # masquer l'onglet "Prévision"
```

**Template Handlebars custom (contrôle total) :**
```bash
# Exporter le template par défaut comme point de départ
npm run report -- --export-template ./my-template
# Éditer my-template/report.hbs
```
```yaml
report:
  templatePath: "./my-template/report.hbs"
```

---

### Mode fake — tester sans connexion Jira

Utile pour tester la configuration ou contribuer au projet sans accès Jira.

```yaml
# config.fake.yaml
jira:
  mode: "fake"
  frozenNow: "2026-01-15"     # date figée pour output déterministe
  projectKey: "FAKE"
  boardId: 1
db:
  path: "./lean-jira-fake.db"
```

```bash
npm run refresh -- -c config.fake.yaml -b board.fake.yaml -o report.fake.html
```

Les fixtures JSON dans `src/jira/fixtures/` remplacent l'API. Le forecast Monte Carlo utilise un PRNG seedé par `frozenNow` → output identique à chaque exécution.

---

## 7. Troubleshooting

### Cycle time à 0 ou anormalement bas

**Symptôme :** `cycle-time` retourne 0 ou une médiane de 0 jour, même pour des tickets travaillés plusieurs jours.

**Cause :** `devStart: true` ne matche aucune transition dans l'historique. Les statuts listés dans la colonne `devStart` de `board.yaml` n'apparaissent pas dans les transitions Jira.

**Fix :**
```bash
npm run validate    # liste les statuts disponibles en base
```
Comparer la liste avec les statuts dans la colonne `devStart: true` de `board.yaml`. Corriger l'orthographe ou le nom.

---

### Métriques role-aware absentes du rapport (onglet "Flux par rôle" masqué)

**Symptôme :** l'onglet "Flux par rôle" n'apparaît pas dans le rapport, ou `stage-time-breakdown` ne retourne aucune donnée.

**Cause :** aucune colonne dans `board.yaml` n'a de champ `role:`.

**Fix :** ajouter `role: dev | qa | po` sur les colonnes concernées (voir [Section 3b](#champ-role--métriques-role-aware)).

---

### Erreur 401 — Auth refusée

**Symptôme :** `npm run sync` échoue avec une erreur 401 ou "Unauthorized".

**Causes possibles et fix :**
1. Token API expiré → recréer un token dans Jira → mettre à jour `config.yaml`
2. Mauvais type d'auth → vérifier l'arbre de décision [Section 1](#quel-type-dauth-choisir-)
3. Jira Cloud domaine custom bloquant Basic → passer au [Bloc 2 gateway](#bloc-2--jira-cloud-domaine-custom-gateway-atlassian)

---

### Throughput anormalement élevé sur une période ancienne

**Symptôme :** un pic de throughput soudain sur une période passée, non corrélé avec l'activité réelle de l'équipe.

**Cause probable :** bulk-close lors d'une migration de workflow Jira (fermeture en masse de tickets à une date précise).

**Fix :** identifier la date du bulk-close dans Jira, puis :
```yaml
metrics:
  cutoffDate: "YYYY-MM-DD"   # date du lendemain du bulk-close
```

---

### `npm run validate` dit "Base vide"

**Symptôme :**
```
Base vide. Lancer npm run sync d'abord.
```

**Cause :** `validate` a besoin que la table `statuses` soit peuplée par un `sync`.

**Fix :**
```bash
npm run sync
npm run validate
```

---

### Statut dans `validate` marqué ✗ (introuvable)

**Symptôme :** `validate` liste un statut avec `✗`.

**Cause :** le nom dans `board.yaml` ne correspond pas exactement au nom Jira (casse, accent, espace).

**Fix :** copier le nom exact depuis la liste "Statuts disponibles en base" affichée par `validate`.

---
