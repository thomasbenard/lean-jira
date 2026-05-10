# Design — Documentation de configuration lean-jira

**Date :** 2026-05-10
**Fichier cible :** `docs/configuration.md`

## Objectif

Permettre à un utilisateur (technique ou non) de configurer lean-jira depuis zéro jusqu'au premier rapport, sans aide externe.

## Audience

- **Non-technique (Scrum Master, manager)** : lit les étapes dans l'ordre, copie-colle
- **Technique (dev, tech lead)** : même structure + sous-sections de référence exhaustive

## Structure retenue : Onboarding séquentiel

Un seul fichier `docs/configuration.md`. Suit le flux d'installation dans l'ordre naturel. Chaque section = une étape avec critère de validation et erreurs fréquentes inline. Référence exhaustive en fin de document pour les utilisateurs déjà configurés.

## Plan détaillé

### Section 1 — Pré-requis

Récupérer 3 infos depuis Jira avant toute config.

| Info | Où trouver | Exemple |
|---|---|---|
| `projectKey` | URL du board Jira | `PROJ` |
| `boardId` | URL du board Jira (`rapidView=42`) | `42` |
| Token d'auth | Selon type d'instance (voir ci-dessous) | — |

Encadré "Quel auth choisir ?" — arbre de décision :
- Jira Cloud → Basic (`email` + `apiToken`)
- Jira Cloud avec domaine custom bloquant Basic → gateway `api.atlassian.com` + `frontendUrl`
- Jira Server ≥ 8.14 / Data Center → PAT (`personalAccessToken`)

### Section 2 — `config.yaml`

3 blocs copier-coller distincts selon auth :
1. Basic (Jira Cloud standard)
2. Gateway Atlassian (Cloud domaine custom) + explication récupération `cloudId`
3. PAT (Server / Data Center)

### Section 3 — `board.yaml` (le plus dense)

**3a — Voie rapide : `autoconfig`** (recommandée)
- Séquence 2 commandes : dry-run puis `--apply`
- Ce que la commande infère automatiquement
- Ce qu'il faut vérifier/ajuster manuellement après génération

**3b — Configuration manuelle**
- Table des 4 `type` avec impact sur chaque métrique
- Guide décisionnel `devStart` : quelle colonne marque le début du travail actif
- Guide `role:` : optionnel, active métriques role-aware — quand ça vaut le coup

**3c — Cas particuliers**
- `legacyDoneStatuses` : quand des statuts ont été renommés dans Jira
- `cutoffDate` : migration de workflow / bulk-close historique

### Section 4 — Valider et premier lancement

Séquence exacte avec sortie attendue à chaque étape :
1. `npm run validate` → liste des statuts OK/KO
2. `npm run sync` → premier pull Jira
3. `npm run refresh` → rapport généré

Erreurs fréquentes inline :
- Statut introuvable → `validate` liste les statuts disponibles en base
- Base vide → lancer `sync` d'abord
- 401 → vérifier token / type d'auth

### Section 5 — Référence complète

Tableaux champ par champ pour `config.yaml` et `board.yaml` :

| Champ | Type | Requis | Défaut | Description |

Couvre tous les champs y compris optionnels :
- `jira.name`, `jira.frontendUrl`, `jira.mode`, `jira.frozenNow`, `jira.fixturesPath`
- `board.legacyDoneStatuses`
- `metrics.cutoffDate`, `metrics.bugIssueTypes`, `metrics.healthThresholds`
- `report.title`, `report.logoUrl`, `report.fontUrl`, `report.customCssPath`, `report.templatePath`, `report.excludeTabs`

### Section 6 — Cas avancés

- **Multi-squad** : plusieurs configs → plusieurs rapports (`refresh -c config.X.yaml -o report.X.html`)
- **Personnalisation rapport** : `title`, `logoUrl`, `fontUrl`, `customCssPath`, `templatePath`, `excludeTabs`
- **Mode fake** : tester sans Jira avec fixtures JSON embarquées

### Section 7 — Troubleshooting

Format : symptôme → cause probable → fix.

Couvre :
- Cycle time à 0 → `devStart` ne matche aucune transition
- Métriques role-aware absentes du rapport → aucun `role:` dans `board.yaml`
- Auth 401 → token expiré / mauvais type d'auth
- Throughput faussé par bulk-close → ajouter `cutoffDate`
- `validate` dit "Base vide" → lancer `sync` d'abord

## Maintenance — doc vivante

`docs/configuration.md` doit rester synchronisée avec le code. Règle :

**Tout ticket qui touche l'un des éléments suivants doit mettre à jour `docs/configuration.md` en fin de dev :**
- Ajout/suppression/renommage d'un champ `config.yaml` ou `board.yaml`
- Nouvelle commande ou option CLI
- Nouvelle métrique ajoutée au catalogue
- Changement de comportement d'une commande existante (ex. `autoconfig`, `validate`)

**Intégration dans le workflow `implement-ticket` :** le skill `/implement-ticket` doit inclure une étape finale explicite :
> "Si le ticket modifie la config, les commandes ou le comportement utilisateur → mettre à jour `docs/configuration.md` (section Référence complète et/ou Troubleshooting si pertinent)."

Critère simple : si un utilisateur qui lit `docs/configuration.md` serait surpris par le comportement après le ticket → la doc est à mettre à jour.

## Ce qui n'est PAS dans cette doc

- Catalogue des métriques (dans README)
- Architecture interne (dans README + CLAUDE.md)
- Contribution / ajout de métrique (dans README)

## Lien README

Ajouter dans README section "Configuration" un lien : `→ [Guide de configuration complet](docs/configuration.md)`.
