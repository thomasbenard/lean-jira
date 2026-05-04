# Ticket 019 — Role column config

## User story

En tant que lead technique configurant lean-jira sur un board multi-rôles, je veux pouvoir
indiquer quel rôle (dev / qa / po) travaille dans chaque colonne du board, afin de fournir
la fondation de configuration nécessaire aux métriques role-aware (tickets 021–025).

## Solution retenue

Ajouter un champ optionnel `role?: RoleType` (`"dev" | "qa" | "po"`) sur l'interface
`BoardColumn` dans `src/main.ts`. Étendre `DerivedStatusConfig` avec trois groupes dérivés
(`devStatuses`, `qaStatuses`, `poStatuses`) calculés par `deriveStatusConfig()` en filtrant
les colonnes par `role`. Mettre à jour `mergeColumns()` pour préserver le champ `role` lors
d'un `autoconfig --apply`. Documenter la propriété dans `board.example.yaml`. Aucune métrique
existante n'est modifiée — le champ est purement additif.

## Estimation

**Bucket** : S

**Justification** : 2 fichiers impactés (`src/main.ts`, `board.example.yaml`). Pattern
identique à l'extension `devStart` déjà en place. Pas de migration DB. 3–4 scénarios de
test pour `deriveStatusConfig` + `mergeColumns`.

## Statut

**livré**
