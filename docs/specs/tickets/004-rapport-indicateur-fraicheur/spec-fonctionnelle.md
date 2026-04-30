# Spec fonctionnelle — Rapport : indicateur de fraîcheur des données

## Contexte

Le rapport HTML affiche uniquement sa date de génération (`Généré le 2026-04-30 14:32`). Si le `sync` a été lancé il y a 3 semaines, toutes les métriques sont silencieusement périmées. L'utilisateur n'a aucun moyen visuel de détecter ce problème depuis le rapport. La table `sync_log` enregistre déjà chaque sync réussi avec un timestamp.

## Comportement attendu

### En-tête du rapport

La ligne de métadonnées actuelle :
```
Généré le 2026-04-30 14:32 · Dernière fenêtre hebdo : 2026-04-28
```

Devient :
```
Généré le 2026-04-30 14:32 · Données Jira du 2026-04-28 · Dernière fenêtre hebdo : 2026-04-28
```

- Format de la date du dernier sync : `YYYY-MM-DD HH:MM` (ISO tronqué, même format que la date de génération)
- Si aucun sync en base : afficher `Données Jira : jamais synchronisé`

### Bandeau d'avertissement (données > 7 jours)

- Si `NOW - lastSyncDate > 7 jours` : afficher un bandeau pleine largeur sous l'en-tête
- Contenu : `⚠ Données potentiellement périmées — dernier sync il y a {N} jours. Lancer npm run sync.`
- Style : fond `#fff3cd` (jaune), bordure `#f59e0b` (orange), texte `#92400e` (marron foncé)
- Toujours visible (pas de bouton fermer) pour que le lecteur ne puisse pas l'ignorer

### Seuil d'avertissement

- 7 jours calendaires (pas ouvrés)
- Le seuil est une constante dans `generate.ts`, pas dans la config

## Cas limites

- Aucun sync en base (`sync_log` vide) → afficher `jamais synchronisé` + bandeau d'avertissement (traité comme > 7j)
- Sync effectué aujourd'hui → aucun bandeau
- Sync effectué il y a exactement 7 jours → aucun bandeau (seuil strict `>`)
- Sync effectué il y a 8 jours → bandeau affiché

## Ce qui ne change pas

- Aucune modification du schéma DB ni de `sync.ts`
- Le calcul des métriques n'est pas affecté
- La date de génération du rapport reste inchangée
