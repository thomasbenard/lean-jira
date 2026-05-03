# Spec fonctionnelle — autoconfig : préservation du config existant

## Contexte

`autoconfig --apply` écrase `board.columns` à chaque exécution. Après un renommage de colonne Jira ou l'ajout d'un nouveau statut au board, relancer la commande détruit les `legacyStatuses`, les surcharges de `type` (ex. `queue`), et le `devStart` positionné manuellement. L'utilisateur doit tout reconfirmer à la main.

## Comportement attendu

### Détection du mode

- **Config sans `board.columns`** (premier lancement, section absente ou vide) → génération complète depuis l'API, comportement actuel inchangé.
- **Config avec `board.columns` existants** → mode fusion : chaque colonne API est réconciliée avec la config existante.

### Fusion colonne par colonne (match par nom)

Pour chaque colonne retournée par l'API Jira :

| Cas | Comportement |
|---|---|
| Nom présent en config existante | Préserver `type`, `devStart`, `legacyStatuses`. Mettre à jour `statuses` (liste courante depuis l'API). |
| Nom absent de config existante (nouvelle colonne board) | Inférer `type` par position relative dans le board actuel. Ajouter à la liste. Warning stdout : `⚠ Nouvelle colonne détectée : "<nom>" — vérifier type et devStart`. |

Pour chaque colonne présente en config mais absente de l'API :

| Cas | Comportement |
|---|---|
| Colonne config non trouvée dans l'API | Conserver dans la config telle quelle. Warning stdout : `⚠ Colonne absente du board Jira : "<nom>" — supprimée du board ou renommée ?`. |

### legacyDoneStatuses

Fusion (union sans doublon) entre `board.legacyDoneStatuses` existants et les nouvelles valeurs détectées par `enrichWithLegacyStatuses`. Ne jamais écraser les entrées existantes.

### Mode aperçu (sans --apply)

Même logique de fusion appliquée au rendu stdout. Les warnings sont émis identiquement.

## Cas limites

- Config avec `board.columns: []` (liste vide explicite) → traité comme absent → génération complète.
- Colonne renommée dans Jira → apparaît comme « nouvelle » + l'ancienne comme « absente du board ». Les deux warnings guident l'utilisateur.
- `legacyStatuses` d'une colonne matchée → toujours préservés intégralement, même si certains noms n'existent plus dans les transitions récentes.
- `devStart: true` sur une colonne matchée → préservé même si la position dans le board a changé.
- Toutes les colonnes renommées (cas SWNGF complet) → toutes traitées comme « nouvelles » + toutes les anciennes en warning. Comportement dégradé mais transparent.

## Ce qui ne change pas

- La logique `inferBoardColumns()` — inchangée, utilisée pour les nouvelles colonnes.
- `enrichWithLegacyStatuses()` — inchangée.
- Le backup `config.yaml.bak` avant `--apply`.
- Le délai de 3s avant `--apply`.
- `legacyStatuses` inférés automatiquement par `enrichWithLegacyStatuses` sur les nouvelles colonnes.
