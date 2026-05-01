# Spec fonctionnelle — Inférence active/queue par mots-clés sur nom de colonne

## Contexte

Le ticket 010 (`autoconfig`) infère toutes les colonnes intermédiaires en `type: active` par défaut. La distinction `active` vs `queue` est pourtant essentielle à `flow-efficiency` : une colonne "Code Review" qui attend un relecteur est du temps de queue, pas du temps actif. Sans ce ticket, l'utilisateur doit corriger manuellement chaque colonne d'attente après `autoconfig`.

## Comportement attendu

### Liste de mots-clés

Mots-clés déclencheurs (insensibles à la casse, correspondance partielle) :

```
review, validation, valider, attente, wait, waiting, approval, approuver, staging, qa
```

La liste est **conservative** : uniquement des termes dont la sémantique de queue est quasi-universelle. Les termes ambigus (ex: "test", "recette") sont exclus.

### Inférence

Pour chaque colonne intermédiaire (ni première ni dernière) :

1. Vérifier si le nom contient un mot-clé (toLowerCase + includes)
2. Si oui → `type: queue`, conserver le mot-clé déclencheur
3. Si non → `type: active` (comportement ticket 010 inchangé)

La première colonne intermédiaire de type `active` (après application des mots-clés) reçoit `devStart: true`.

### Sortie YAML

Chaque colonne dont le type a été inféré par mot-clé reçoit un commentaire inline :

```yaml
    - name: "Code Review"
      type: queue   # inféré depuis le mot-clé "review" — vérifier
      statuses:
        - "In Review"

    - name: "À valider"
      type: queue   # inféré depuis le mot-clé "valider" — vérifier
      statuses:
        - "To Be Validated"
```

Les colonnes `active` sans match conservent le commentaire du ticket 010 :
```yaml
      type: active   # changer en "queue" si temps d'attente
```

## Cas limites

- **Nom contient plusieurs mots-clés** → utiliser le premier match ; un seul commentaire affiché
- **Colonne `devStart: true` matchée comme queue** → impossible par construction (devStart est sur la première colonne `active` ; si la première colonne intermédiaire match queue, devStart passe sur la suivante `active`)
- **Toutes les colonnes intermédiaires matchent queue** → aucune colonne n'est `active`, donc `devStart: true` absent + avertissement existant du ticket 010 affiché
- **Nom de colonne vide** → pas de match, type `active` par défaut

## Ce qui ne change pas

- L'heuristique position (première = `todo`, dernière = `done`) — inchangée
- Le comportement de `--apply`
- Les commandes autres qu'`autoconfig`
- Le schéma `config.yaml`
- L'avertissement pour colonnes intermédiaires avec `statusCategory='done'` (ticket 010)
