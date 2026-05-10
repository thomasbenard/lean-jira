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

### Voie A — `autoconfig` (recommandée)

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

**Ce qu'il faut toujours vérifier manuellement après génération :**
- Le `devStart: true` est sur la bonne colonne (début du travail actif réel)
- Les colonnes `type: queue` correspondent bien à des files d'attente (pas du travail actif)
- Ajouter `role: dev | qa | po` sur les colonnes si vous voulez les métriques role-aware (voir Section 3b)
- Vérifier `cutoffDate` si votre historique Jira a subi un bulk-close

---

### Voie B — Configuration manuelle

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
