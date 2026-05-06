# Spec fonctionnelle — Métrique scope-change-rate

## Contexte

Un changement de périmètre survient quand une US est modifiée après que l'équipe s'y est engagée (entrée en sprint). Ces changements dégradent la prévisibilité, allongent les cycles et expliquent les sprints ratés. La métrique vise à quantifier ce phénomène par sprint pour permettre une corrélation avec le throughput et le cycle time.

## Comportement attendu

### Population

Toutes les issues ayant été assignées à au moins un sprint (présence d'au moins un `FieldChange` avec `field_name = "Sprint"`), sans restriction de type ni de statut. Issues sans sprint ignorées silencieusement.

### Définition d'un changement "après entrée en sprint"

Un changement de champ est **post-sprint** si `changed_at > sprint.start_date` pour le premier sprint auquel l'issue a été assignée. Le premier sprint est celui dont le `sprint.start_date` est le plus ancien parmi les sprints référencés dans les `FieldChange` de l'issue.

### Filtrage des changements triviaux

#### Champs texte (`description`, `summary`)

1. Normaliser `from_value` et `to_value` : minuscules, collapse whitespace, supprimer les marqueurs Markdown courants (`*`, `_`, `#`, `>`, backticks)
2. Calculer le ratio de similarité : `1 - levenshtein(norm_from, norm_to) / max(len(norm_from), len(norm_to))`
3. Si similarité ≥ **0,85** → changement trivial, ignoré
4. Si `from_value` est null → ignoré (première saisie, pas une modification)

#### Champ `Story Points`

- Tout changement `from_value → to_value` où les deux sont non-null est **significatif**
- `null → valeur` (première estimation) → ignoré

#### Champ `Sprint`

- Changement de sprint = **signal de reprogrammation** (catégorie séparée `sprintChange`)
- Toujours significatif si `from_value` est non-null

### Sortie par sprint

Pour chaque sprint (identifié par son nom) ayant au moins 1 issue :

```
{
  totalIssues: number,       // issues assignées à ce sprint
  changedIssues: number,     // issues avec ≥1 changement significatif post-sprint
  changeRatio: number,       // changedIssues / totalIssues
  byChangeType: {
    description: number,     // issues avec changement description significatif
    storyPoints: number,     // issues avec changement story points
    sprintChange: number,    // issues reprogrammées vers autre sprint
  }
}
```

### Sortie globale

```
{
  totalIssues: number,
  changedIssues: number,
  changeRatio: number,
  bySprint: Record<string, SprintScopeStats>,  // clé = sprint name
  changedIssueKeys: string[],                  // liste des issues modifiées (tous sprints)
}
```

## Cas limites

- Issue sans sprint → exclue silencieusement
- Sprint sans `start_date` en base → changements de cette issue ignorés (impossible de déterminer "après sprint start")
- `from_value` et `to_value` identiques après normalisation → ignoré même si les chaînes brutes diffèrent
- Issue assignée successivement à plusieurs sprints → on utilise le premier sprint (date de start la plus ancienne) comme référence d'engagement
- Changement de description de 2 caractères sur texte de 500 → ratio ≥ 0,99 → trivial → ignoré

## Ce qui ne change pas

- Aucune métrique existante n'est modifiée
- Le seuil de similarité (0,85) est une constante interne, pas configurable via `board.yaml` (peut évoluer dans un ticket ultérieur)
- Les buckets de taille (`XS/S/M/L/XL`) ne s'appliquent pas à cette métrique
