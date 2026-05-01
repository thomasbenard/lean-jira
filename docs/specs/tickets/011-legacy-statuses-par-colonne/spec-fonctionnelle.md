# Spec fonctionnelle — `legacyStatuses` par colonne

## Contexte

Quand Jira renomme des statuts, l'historique des transitions conserve les anciens noms. `config.yaml` doit donc lister ces anciens noms pour que les métriques couvrent l'historique complet. Aujourd'hui, ces noms historiques vont dans `statuses` de la colonne — et `validate-config` les signale comme absents de la table `statuses` (qui ne contient que les noms courants de l'API Jira). Résultat : 24 faux-positifs sur le projet SWNGF, et `validate-config` sort en erreur même quand la config est correcte.

`legacyDoneStatuses` résout ce problème pour les statuts done depuis le ticket 005. Ce ticket étend le mécanisme aux colonnes non-done (`todo`, `active`, `queue`).

## Comportement attendu

### Nouveau champ `legacyStatuses` dans `config.yaml`

Chaque colonne peut déclarer une liste optionnelle d'anciens noms :

```yaml
board:
  columns:
    - name: "Développement"
      type: active
      devStart: true
      statuses:
        - "Développement en cours"
        - "En cours"
      legacyStatuses:
        - "Dev in progress"
        - "Design in progress"
        - "In Progress"
```

### Comportement de `deriveStatusConfig`

Les `legacyStatuses` d'une colonne sont inclus dans les mêmes listes dérivées que ses `statuses` : une colonne `active + devStart` avec `legacyStatuses` contribue à `devStartStatuses`, `activeStatuses` et `inProgressStatuses`. Le comportement pour `doneStatuses` ne change pas (`legacyDoneStatuses` au niveau board reste le mécanisme dédié pour les statuts done).

### Comportement de `validate-config`

Un statut listé dans `legacyStatuses` d'une colonne et absent de la table `statuses` est affiché avec le suffixe `(statut legacy — accepté pour l'historique)` — identique au traitement actuel des `legacyDoneStatuses` — et n'est **pas** comptabilisé dans `missingCount`. Un statut listé dans `legacyStatuses` **mais présent** en base est affiché `✓` normalement.

La commande retourne exit 0 si `missingCount == 0` (même si des statuts legacy sont absents de la DB).

## Cas limites

- `legacyStatuses` absent ou `[]` → comportement identique à l'actuel (aucune régression)
- Même nom dans `statuses` et `legacyStatuses` → dédupliqué dans les listes dérivées (via `unique()` existant)
- Statut dans `legacyStatuses` d'une colonne `done` → fonctionne mais `legacyDoneStatuses` au niveau board reste la convention recommandée pour les statuts done
- Statut legacy présent en DB (ancienne config API redevenue active) → affiché `✓`, non legacy

## Ce qui ne change pas

- L'interface `BoardConfig` et `legacyDoneStatuses` — non touchés
- Le comportement de `validateStatusConfig` pour `doneStatuses` — la logique `LEGACY_SECTION_LABEL` reste inchangée
- Les métriques — elles consomment `DerivedStatusConfig` qui inclut déjà les legacy names
- Le schéma DB — aucune lecture/écriture DB ajoutée
