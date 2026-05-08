# Spec fonctionnelle — Traduction rapport HTML

## Contexte

Après le ticket 041a, les messages CLI sont localisés mais le rapport HTML reste intégralement
en français (~200 chaînes dans `generate.ts`). Ce ticket traduit tout le rapport. La langue
peut être fixée par `--lang` (CLI, prioritaire) ou par `report.lang` dans `board.yaml` (persistée
dans le projet, pratique pour les squads francophones).

## Comportement attendu

### Déclenchement de la langue du rapport

Priorité décroissante :
1. `--lang en|fr` sur la commande `report` ou `refresh`
2. `report.lang: fr` dans `board.yaml`
3. Défaut : `en`

```yaml
# board.yaml — optionnel, force le français pour toutes les exécutions sans --lang
report:
  lang: fr
```

### Surfaces traduites

- **Titres de sections** : "Livraison", "Bugs & dette qualité", "Capacité & prévision",
  "Flux par rôle", "Dérive de périmètre" → "Delivery", "Bugs & quality debt", etc.
- **Labels Chart.js** : "Médiane", "P85", "Issues livrées", "WIP courant", etc.
- **Tooltips d'aide** (`HELP_TEXTS`) : les 18 entrées avec `title` + `body`
- **Messages KPI** : "Données insuffisantes", "Aucun snapshot", signaux de santé
- **Aging WIP** : colonnes "Ticket", "Statut", "Âge", niveaux de risque "OK", "À surveiller",
  "À risque", "Critique"
- **Bannières** : alerte stale sync, alerte scope change active

### Ce qui N'est PAS traduit

- Noms de métriques (`lead-time`, `cycle-time`, etc.) — identifiants techniques
- Clés de configuration dans `board.yaml`
- Noms des colonnes board (ce sont des statuts Jira définis par l'utilisateur)
- Dates, nombres, pourcentages (format invariant)

## Cas limites

- `report.lang` absent de `board.yaml` → défaut `en` (comportement 041a)
- `report.lang: de` → warning + fallback `en` (même règle que `--lang`)
- Rapport généré sans snapshots → message d'erreur traduit aussi

## Ce qui ne change pas

- Format du fichier HTML généré (autonome, Chart.js CDN)
- Données numériques (même calcul, même format)
- Structure des sections et onglets
- Signature publique de `generateReport()` sauf ajout du paramètre `lang` optionnel
