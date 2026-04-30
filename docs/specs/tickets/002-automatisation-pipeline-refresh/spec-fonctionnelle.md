# Spec fonctionnelle — Automatisation du pipeline refresh

## Contexte

Générer un rapport à jour nécessite actuellement 3 commandes séquentielles : `npm run sync`, `npm run snapshots`, `npm run report`. L'ordre est obligatoire et non documenté pour un nouvel utilisateur. Aucune automatisation planifiée n'est fournie. En pratique, le rapport n'est régénéré qu'à la demande, ce qui rend les métriques souvent périmées.

## Comportement attendu

### Commande `npm run refresh`

- Enchaîne dans l'ordre : `sync` → `snapshots` → `report`
- Si une étape échoue (code de sortie non zéro), les étapes suivantes ne s'exécutent pas
- La sortie console est celle de chaque sous-commande, sans buffering supplémentaire
- Produit le fichier `report.html` à la racine (comportement par défaut de `npm run report`)

### Workflow GitHub Actions `.github/workflows/refresh.yml`

- Déclenchement : `schedule` (cron hebdomadaire, ex. chaque lundi à 07h00 UTC) + `workflow_dispatch` (déclenchement manuel depuis l'UI GitHub)
- Étapes : checkout → setup Node → `npm ci` → `npm run refresh`
- Les secrets Jira (`JIRA_EMAIL`, `JIRA_API_TOKEN`) sont lus depuis les secrets du dépôt GitHub ; le `config.yaml` généré dynamiquement dans le workflow à partir des secrets et des variables d'environnement
- Le rapport HTML généré est uploadé comme artefact GitHub Actions (rétention 30 jours)

### Documentation crontab

- Exemple de ligne `crontab` commenté dans le workflow YAML (en header) pour usage hors GitHub Actions
- Exemple : `0 7 * * 1 cd /path/to/lean-jira && npm run refresh`

## Cas limites

- `sync` échoue (Jira inaccessible, token expiré) → `snapshots` et `report` ne sont pas lancés ; le rapport existant n'est pas écrasé
- Première exécution sans DB existante → `sync` crée la DB, `snapshots` la peuple, `report` génère le fichier ; comportement identique au flux manuel
- `report.html` déjà existant → écrasé sans confirmation (comportement actuel de `npm run report`)

## Ce qui ne change pas

- Les commandes individuelles `npm run sync`, `npm run snapshots`, `npm run report` restent inchangées
- La logique applicative (sync, calcul de métriques, génération HTML) n'est pas modifiée
- Le chemin de sortie du rapport (`./report.html`) reste la valeur par défaut ; `-o` reste disponible via `npm run report` mais pas exposé dans `refresh`
