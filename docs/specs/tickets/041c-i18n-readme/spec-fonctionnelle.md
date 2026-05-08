# Spec fonctionnelle — Réécriture README en anglais

## Contexte

Le `README.md` actuel est intégralement en français. C'est le premier fichier lu par
un visiteur GitHub ou npm. Pour l'adoption internationale, il doit être en anglais.
Les utilisateurs francophones existants ont besoin d'un accès rapide à la version française.

## Comportement attendu

### Structure des fichiers

- `README.md` → contenu en anglais (même structure que l'actuel)
- `README.fr.md` → contenu français actuel (renommage de l'actuel `README.md`)

### Header du README anglais

Première ligne après le titre : lien vers la version française.

```markdown
# lean-jira

> 🇫🇷 [Version française](README.fr.md)

CLI that syncs a Jira Kanban board, computes Lean flow metrics and generates an
interactive HTML report with time trends.
```

### Contenu traduit

Même plan de sections que l'actuel :
1. Ce que ça produit → What it produces
2. Prérequis → Prerequisites
3. Installation
4. Configuration (`config.yaml` + `board.yaml`, exemples YAML inchangés)
5. Utilisation → Usage
6. Catalogue des métriques → Metric catalog
7. Rapport HTML → HTML report
8. Développement → Development
9. Architecture

Les noms de commandes, options CLI, clés YAML et noms de métriques restent identiques
(ce ne sont pas des textes traduits — ce sont des identifiants).

## Cas limites

- Les exemples de code YAML dans le README (configs, commandes shell) sont copiés tels
  quels — pas traduits, ils seraient cassés sinon.
- Les commentaires dans les blocs YAML d'exemple peuvent être traduits si pertinents.

## Ce qui ne change pas

- Contenu technique (commandes, options, schéma architecture, tableau métriques)
- Fichiers `config.example.yaml` et `board.example.yaml` (hors scope)
