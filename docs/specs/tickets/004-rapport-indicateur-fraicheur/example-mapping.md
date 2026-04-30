# Example Mapping — Rapport : indicateur de fraîcheur des données

## Règle 1 — Affichage de la date du dernier sync

**La date du dernier sync réussi s'affiche dans la ligne de métadonnées du rapport.**

```gherkin
Scenario: Sync récent — date affichée normalement
  Given la table sync_log contient un enregistrement avec synced_at = "2026-04-28T10:30:00Z"
  And le rapport est généré le 2026-04-30
  When l'utilisateur ouvre report.html
  Then la ligne de méta affiche "Données Jira du 2026-04-28 10:30"
  And aucun bandeau d'avertissement n'est visible

Scenario: Aucun sync en base
  Given la table sync_log est vide
  When l'utilisateur ouvre report.html
  Then la ligne de méta affiche "Données Jira : jamais synchronisé"
  And un bandeau d'avertissement orange est affiché
```

---

## Règle 2 — Seuil d'avertissement à 7 jours calendaires

**Un bandeau orange s'affiche si le dernier sync date de plus de 7 jours.**

```gherkin
Scenario: Sync il y a exactement 7 jours — pas d'avertissement
  Given le rapport est généré le 2026-04-30
  And le dernier sync a eu lieu le 2026-04-23
  When l'utilisateur ouvre report.html
  Then aucun bandeau d'avertissement n'est visible

Scenario: Sync il y a 8 jours — bandeau affiché
  Given le rapport est généré le 2026-04-30
  And le dernier sync a eu lieu le 2026-04-22
  When l'utilisateur ouvre report.html
  Then un bandeau d'avertissement orange est affiché
  And le bandeau mentionne la date du dernier sync

Scenario: Sync aujourd'hui — pas d'avertissement
  Given le rapport est généré le 2026-04-30
  And le dernier sync a eu lieu le 2026-04-30
  When l'utilisateur ouvre report.html
  Then aucun bandeau d'avertissement n'est visible
```

---

## Règle 3 — Robustesse si sync_log contient plusieurs projets

**Seul le sync du project_key courant est considéré.**

```gherkin
Scenario: Deux projets en base, sync récent pour l'autre
  Given sync_log contient un sync AUTRE le 2026-04-29 et un sync PROJ le 2026-04-01
  And le rapport est généré pour PROJ le 2026-04-30
  When l'utilisateur ouvre report.html
  Then la date affichée est 2026-04-01
  And un bandeau d'avertissement est affiché (> 7 jours)
```
