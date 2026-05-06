# Ticket 032 — Métrique : détection de changement de périmètre

## User story

En tant que lead technique, je veux une métrique `scope-change-rate` qui identifie les issues dont la description ou l'estimation a changé significativement après leur entrée en sprint, afin de mesurer la dérive de périmètre par sprint et d'en évaluer l'impact sur la vélocité.

## Solution retenue

Nouvelle métrique `scope-change-rate` implémentant `Metric<ScopeChangeResult>`. Elle interroge `issue_field_changes` en jointure avec `sprints` pour isoler les changements survenus après le `start_date` du premier sprint auquel l'issue a été assignée. Un filtre de diff intelligent (`normalizeText` + ratio d'édition) élimine les changements triviaux (reformatage, fautes de frappe) sur les champs texte. Les changements de story points sont toujours significatifs (sauf `null → valeur` = première estimation). La sortie est agrégée par sprint (`bySprint`) pour corrélation dans le rapport.

## Estimation

**Bucket** : M

**Justification** : 1 nouveau fichier métrique, algorithme de diff (edit distance sans dépendance externe), jointure SQL multi-tables, agrégation par sprint. Dépend du ticket 031 (table `issue_field_changes`). ~6-8 scénarios de test (diff triviale, diff significative, premier sprint, changement story points, issue sans sprint).

## Statut

**livré**
