# Spec fonctionnelle — Onboarding : config example + validate-config

## Contexte

Démarrer lean-jira sur un nouveau projet Jira nécessite de connaître les noms exacts des statuts du workflow, l'ID du board, et la structure complète de `config.yaml`. Aucun fichier d'exemple n'existe. En cas d'erreur de nom de statut, les métriques sont silencieusement faussées (ex. : cycle time à 0 si `devStartStatuses` ne matche aucune transition). Le diagnostic actuel est uniquement possible en inspectant la DB manuellement.

## Comportement attendu

### `config.example.yaml`

- Fichier à la racine du projet, versionné dans le dépôt
- Contient tous les champs de la structure `AppConfig` (`jira.*`, `metrics.*`, `db.*`)
- Chaque champ est précédé d'un commentaire YAML expliquant : son rôle, le type attendu, et comment le trouver dans Jira
- Valeurs fictives réalistes (ex. `your-domain.atlassian.net`, `PROJ`, `123`)
- Sections `activeStatuses` et `queueStatuses` présentes avec commentaire expliquant qu'elles sont optionnelles (uniquement pour `flow-efficiency`)

### Commande `lean-jira validate-config` / `npm run validate`

**Pré-requis** : la DB doit exister et avoir été peuplée par au moins un `sync` (table `statuses` non vide).

**Comportement :**

1. Charge `config.yaml` (option `-c` disponible comme les autres commandes)
2. Lit la table `statuses` en base
3. Pour chaque liste de statuts du config (`todoStatuses`, `devStartStatuses`, `inProgressStatuses`, `doneStatuses`, `activeStatuses`, `queueStatuses`) :
   - Affiche le nom de la liste
   - Pour chaque statut : `✓ Nom du statut` si trouvé en DB, `✗ Nom du statut` si absent
4. Si au moins un statut est introuvable :
   - Affiche la liste complète des statuts disponibles en DB (nom + catégorie)
   - Retourne un code de sortie non zéro
5. Si tous les statuts sont valides : affiche `✓ Config valide.` et retourne code 0

**Sortie exemple (erreur) :**
```
todoStatuses
  ✓ À faire
  ✗ Backlog  ← introuvable en base

Statuts disponibles en base :
  À faire           (new)
  En cours          (indeterminate)
  En revue          (indeterminate)
  À valider         (done)
  Livré             (done)

1 statut(s) introuvable(s). Vérifier config.yaml.
```

## Cas limites

- DB inexistante ou `statuses` vide → message d'erreur explicite : `Base vide. Lancer npm run sync d'abord.`
- Liste optionnelle (`activeStatuses`, `queueStatuses`) absente du config → sauter silencieusement (pas d'erreur)
- Même statut listé dans deux sections → validé une fois par section, pas de déduplication silencieuse
- Statut présent dans `doneStatuses` du config mais absent de la DB `statuses` (statut legacy) → marqué ✗ avec note `(statut legacy — absent de l'API Jira actuelle, mais accepté pour l'historique)`

## Ce qui ne change pas

- Aucune modification du flux sync, metrics, snapshots, report
- La commande est read-only : elle ne modifie pas la DB ni le config
