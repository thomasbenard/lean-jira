# Ticket 017 — Split config : séparation credentials Jira / config board

## User story

En tant que lead technique configurant lean-jira sur un nouveau projet, je veux avoir deux fichiers
de configuration distincts — un pour les credentials Jira (gitignored) et un pour la config du
board (commitable) — afin de pouvoir versionner le mapping des colonnes et les seuils métriques
sans exposer les secrets dans le dépôt.

## Solution retenue

Scinder `config.yaml` en deux fichiers :

- **`config.yaml`** (`jira.*` + `db.*`) — gitignored, contient les secrets. Créé manuellement par
  le développeur à partir de `config.example.yaml`.
- **`board.yaml`** (`board.*` + `metrics.*`) — commitable, contient la configuration du board et
  les paramètres métriques. Généré par `autoconfig --apply`, puis affiné manuellement.

Toutes les commandes qui consomment la config board (`metrics`, `snapshots`, `report`,
`validate-config`) reçoivent un flag `--board-config` / `-b` (défaut `./board.yaml`).
La commande `sync` n'a besoin que de `config.yaml` (credentials seuls) — pas de `-b`.
La commande `autoconfig --apply` écrit `board.yaml` (au lieu de patcher `config.yaml`).

`AppConfig` est scindée en deux interfaces : `JiraFileConfig` (secrets) et `BoardFileConfig`
(board + metrics), fusionnées en mémoire par `loadConfigs()`.

## Dépendances

**Précondition pour ticket 016** : le ticket 016 (`autoconfig preserve config existant`) cible
actuellement `config.yaml`. Après ce ticket, sa cible devient `board.yaml` et `BoardFileConfig`.
Le ticket 017 doit être livré avant le 016.

## Estimation

**Bucket** : M (~2j)

**Justification** : 1 fichier TypeScript principal (`src/main.ts`) avec refactor de l'interface +
`loadConfig`, 4 commandes à mettre à jour avec le flag `-b`, comportement `--apply` modifié, 2
fichiers d'exemple à mettre à jour. Aucune migration DB. 5-7 scénarios de test.

## Statut

**à faire**
