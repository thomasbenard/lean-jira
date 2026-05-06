# Spec fonctionnelle — Infra DB + sync changements de champs

## Contexte

Le sync actuel extrait uniquement les changements de statut depuis le changelog Jira (`item.field === "status"`). Les changements de description, titre, story points et sprint sont présents dans les mêmes historiques (`ChangelogHistory`) mais ignorés. Sans cette donnée en base, il est impossible de calculer des métriques de dérive de périmètre.

## Comportement attendu

### Champs surveillés

Les champs suivants sont extraits du changelog et persistés :

| `item.field` Jira | Signification |
|---|---|
| `description` | Contenu de la spec/user story |
| `summary` | Titre du ticket |
| `Story Points` | Estimation (valeur Jira Cloud standard) |
| `Sprint` | Assignation à un sprint |

Tout autre champ est ignoré silencieusement.

### Extraction

À chaque sync (full ou incrémental), pour chaque issue :
- Parcourir `changelog.histories`
- Pour chaque `ChangelogItem` dont `field` est dans la liste surveillée, créer un `FieldChange`
- Remplacer intégralement les entrées existantes en base pour l'issue (même stratégie que `replaceAllTransitions`)

### Données stockées

Pour chaque changement : `issue_key`, `field_name` (valeur brute de `item.field`), `from_value` (`item.fromString`), `to_value` (`item.toString`), `changed_at` (horodatage de l'histoire).

Les valeurs `from_value` / `to_value` sont stockées brutes (pas de parsing). Le ticket 032 appliquera la logique de diff.

### Log de sync

Aucun log supplémentaire requis. Le comptage existant (`${rawIssues.length} issues stockées`) reste inchangé.

## Cas limites

- `item.fromString` null → stocker `NULL` en base (première assignation de sprint, premier ajout de description)
- `item.toString` null → stocker `NULL` (suppression d'un champ)
- Sync incrémental : `replaceAllFieldChanges` recouvre les entrées pour les issues resyncées ; les issues non touchées conservent leurs données
- `customfield_10016` (story points Jira Server) : pas dans le scope de ce ticket (ticket 030 gère Jira Server/DC)

## Ce qui ne change pas

- La table `transitions` et tout son pipeline ne sont pas modifiés
- `fetchAllIssues` dans `client.ts` n'est pas modifié (le changelog est déjà fetché)
- Aucune métrique existante n'est affectée
- Le champ `description` n'est **pas** ajouté aux `fields` de la requête REST — seul le changelog nous intéresse (valeur courante inutile ici)
