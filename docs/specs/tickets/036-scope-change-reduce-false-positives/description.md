# Ticket 036 — scope-change-rate : réduire les faux positifs

## User story

En tant que lead technique, je veux que `scope-change-rate` n'alerte que sur des dérives de périmètre réelles, afin d'éliminer le bruit causé par les enrichissements progressifs, le reformatage et les changements cosmétiques qui polluent le signal.

## Solution retenue

Cinq filtres appliqués dans `scopeChange.ts` :

1. **First vs last** : comparer la description au moment de l'entrée en sprint contre son état final, par champ (`description` / `summary`) indépendamment. Les modifications intermédiaires ne sont plus évaluées une par une ; seul le delta cumulé compte.
2. **Grace period** : ignorer les changements intervenant dans les N premières heures après le début du sprint (défaut 0h, configurable via `board.yaml` → `MetricConfig`). Couvre le nettoyage de description fait pendant le sprint planning.
3. **Strip macros Jira** : étendre `normalizeText` pour supprimer `{panel:…}`, `{color:…}`, `{noformat}`, `{code:…}`, `!image.png!` et convertir `[texte|URL]` → `texte`. Les changements purement structurels deviennent invisibles après normalisation.
4. **Whitespace guard** : déjà partiellement couvert par `normalizeText` (collapse `\s+`). Explicitement : si les textes normalisés sont identiques après tous les strips, `similarityRatio` retourne 1.0 → pas de détection.
5. **Additions pures** : si `levenshtein(a, b) === len(b) − len(a)` et `len(b) > len(a)` (seuls des caractères ajoutés, aucune substitution/suppression), traiter comme non-modifié. Supprime les enrichissements par appending.

`MetricConfig` reçoit un champ optionnel `scopeChangeGracePeriodHours?: number`. `main.ts` le câble depuis `board.yaml` (`metrics.scopeChangeGracePeriodHours`). Aucune migration DB.

## Estimation

**Bucket** : M

**Justification** : 3 fichiers src (`scopeChange.ts`, `types.ts`, `main.ts`) + 1 fichier test. Algorithme de détection entièrement restructuré (first-vs-last par champ), 5 règles indépendantes à couvrir en TDD, 8-10 scénarios attendus. Pas de migration DB, pas de changement d'interface publique.

## Statut

**à faire**
