# Ticket 010 — Autoconfiguration du board depuis l'API Jira

## User story

En tant que développeur configurant lean-jira sur un nouveau projet Jira, je veux pouvoir générer automatiquement la section `board.columns` de `config.yaml` depuis l'API Jira, afin de ne pas avoir à saisir manuellement les noms de statuts et d'obtenir une configuration de départ cohérente avec le board réel.

## Solution retenue

Nouvelle commande CLI `autoconfig` qui :
1. Lit les credentials Jira depuis `config.yaml` (section `jira`)
2. Appelle `/rest/agile/1.0/board/{boardId}/configuration` pour récupérer les colonnes du board avec leurs status IDs
3. Croise avec `/rest/api/2/status` (déjà utilisé dans `sync`) pour obtenir le nom et la `statusCategory` de chaque statut
4. Infère le `type` de chaque colonne à partir des catégories dominantes (`new` → `todo`, `done` → `done`, sinon `active`)
5. Applique `devStart: true` sur la première colonne `active` par défaut
6. Imprime le YAML résultant (`board.columns`) sur stdout — l'utilisateur copie dans son config.yaml
7. Option `--apply` : écrase la clé `board.columns` directement dans `config.yaml` (destructif, affiché en avertissement)

Pas de modification de la DB. Pas de migration.

## Estimation

**Bucket** : M (~2j)

**Justification** : 3 fichiers touchés (`src/jira/types.ts` +2 interfaces, `src/jira/client.ts` +1 méthode, `src/main.ts` +1 commande ~80 lignes). Pattern existant réutilisable (`fetchAllStatuses` déjà dans `JiraClient`, `yaml` déjà importé). Logique d'inférence non-triviale (colonnes à catégories mixtes). 5-6 scénarios de test attendus. Pas de migration DB.

## Statut

**à faire**
