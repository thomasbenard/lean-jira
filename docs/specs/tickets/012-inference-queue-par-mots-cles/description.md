# Ticket 012 — Inférence active/queue par mots-clés sur nom de colonne

## Dépendance

**Nécessite le ticket 010 livré** — ce ticket étend `inferBoardColumns()` et `renderBoardColumnsYaml()` introduits dans le ticket 010.

## User story

En tant que développeur utilisant `autoconfig` sur un board inconnu, je veux que les colonnes d'attente courantes (review, validation, staging…) soient automatiquement identifiées comme `type: queue`, afin d'obtenir une config `flow-efficiency` exploitable sans ajustement manuel systématique.

## Solution retenue

Ajouter une liste conservative de mots-clés (`QUEUE_KEYWORDS`) dans `src/main.ts`. Pour chaque colonne intermédiaire, si son nom contient un mot-clé (insensible à la casse), le type inféré est `queue` au lieu de `active` par défaut. Le mot-clé déclencheur est toujours affiché en commentaire inline dans la sortie YAML, pour que l'utilisateur puisse valider ou corriger. Aucune inférence silencieuse.

## Estimation

**Bucket** : S (~0.5j)

**Justification** : 1 fichier (`src/main.ts`), ~25 lignes ajoutées dans deux fonctions existantes (`inferBoardColumns`, `renderBoardColumnsYaml`). Logique triviale (includes + toLowerCase). 3-4 scénarios de test. Pas de migration DB.

## Statut

**à faire**
