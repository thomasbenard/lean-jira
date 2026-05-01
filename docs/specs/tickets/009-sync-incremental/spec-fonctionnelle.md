# Spec fonctionnelle — Sync incrémental

## Contexte

`npm run sync` récupère l'intégralité des issues du board à chaque exécution via l'API Jira. Sur un projet avec plusieurs centaines d'issues, cela représente de nombreux appels paginés (200ms de délai entre chaque). La plupart de ces issues n'ont pas changé depuis le sync précédent. La table `sync_log` enregistre déjà la date de chaque sync — cette information n'est pas exploitée.

## Comportement attendu

### Premier sync (aucune entrée dans `sync_log`)

- Comportement identique à l'actuel : récupération complète de toutes les issues du board
- Console : `Premier sync — récupération complète`

### Syncs suivants (entrée dans `sync_log`)

- Seules les issues dont le champ `updated` Jira est postérieur ou égal à la date du dernier sync sont récupérées
- Console : `Sync incrémental depuis <ISO date du dernier sync>`
- Le nombre d'issues affichées dans la console reflète uniquement les issues récupérées, pas le total du board
- Les issues non récupérées (non modifiées) restent inchangées en base

### Invariants maintenus dans les deux cas

- `fetchAllStatuses()` et `fetchAllSprints()` s'exécutent toujours en entier (appels légers, données susceptibles de changer indépendamment des issues)
- `upsertIssues()` et `replaceAllTransitions()` sont appelés uniquement sur les issues récupérées
- `logSync()` est appelé en fin de sync avec le nombre d'issues effectivement récupérées

## Cas limites

- Aucune issue modifiée depuis le dernier sync → `rawIssues` vide → `upsertIssues([])` et `replaceAllTransitions([])` sans erreur ; `logSync` enregistre 0
- Issue supprimée dans Jira depuis le dernier sync → reste en base (hors scope ; les métriques l'ignorent dès qu'elle n'a plus de transition `done`)
- Date du dernier sync très ancienne (ex. > 6 mois) → comportement identique à un sync normal sur la fenêtre filtrée ; aucun traitement spécial nécessaire

## Ce qui ne change pas

- Les commandes individuelles `npm run sync` et `npm run refresh` restent inchangées côté usage
- Le schéma DB n'est pas modifié
- La logique de `replaceAllTransitions` (DELETE + INSERT par issue) reste inchangée
- Les métriques et snapshots ne sont pas affectés
