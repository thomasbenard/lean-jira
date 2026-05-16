# WIP (Work In Progress)

[← Index](../metrics-formulas.md)

> **Loi de Little** ([Little, 1961](https://doi.org/10.1287/opre.9.3.383)) : dans un système stable, `WIP = throughput × cycle_time`. Inversement, `cycle_time = WIP / throughput`. Les trois métriques `wip`, `throughput` et `cycle-time` ne sont pas indépendantes — réduire le WIP réduit mécaniquement le cycle time sans modifier le throughput.

## `wip` — snapshot courant

**Définition** : issues simultanément en cours dans le sprint actif au moment de l'exécution.

**Algorithme** :
```
sprint_actif = SELECT id, name FROM sprints WHERE state = 'active'
               ORDER BY start_date DESC LIMIT 1

wip = SELECT key FROM issues
      WHERE current_sprint_id = sprint_actif.id
        AND current_status IN inProgressStatuses    -- ! déjà filtré contre done-category
        AND issue_type NOT IN excludeIssueTypes     -- si configuré
```

Retourne `{currentWip:0, sprintName:null, issueKeys:[]}` si aucun sprint actif.

**Choix implicite — `LIMIT 1` sur sprint actif** : si plusieurs sprints sont marqués `state='active'` simultanément (rare mais possible Jira-side), on garde celui dont `start_date` est la plus récente. Les WIP des autres sprints actifs sont invisibles.

**Note importante** : `inProgressStatuses` est filtré au runtime par `buildMetricConfig` contre l'union des statuts done (DB + config). Sur KECK : `À valider` (statusCategory='done') et `To Be Validated` (legacy renommé) sont automatiquement retirés du WIP.

**Sortie** : `{currentWip, sprintName, issueKeys[]}`.

---

## WIP historique (snapshots uniquement)

Utilisé par `backfillSnapshots` pour reconstituer le WIP à une date passée D.

**Problème** : les sprints historiques ne sont pas tracés dans `issues.current_sprint_id` (seul le sprint actif courant est stocké). Le WIP historique est donc calculé **sans scoping sprint**.

**Algorithme** :
```
Pour chaque issue :
  last_status_before_D = to_status WHERE transitioned_at <= D, MAX(transitioned_at)

wip_at_D = COUNT(issues) WHERE
  last_status_before_D IN inProgressStatuses    -- déjà filtré contre done-category
  AND (resolved_at IS NULL OR resolved_at > D)  -- garde-fou résolution Jira
```

SQL : voir `computeHistoricWip` dans `src/snapshots/compute.ts`. `inProgressStatuses` reçu est déjà strippé du done-set par `buildMetricConfig`.

---

## `wip-per-role`

**Définition** : nombre d'issues dont `current_status` appartient aux statuts du rôle (dev/qa/po), à l'instant T. Sans scoping sprint, sans `cutoffDate`, sans fenêtre temporelle — pure photo point-in-time.

**Algorithme** :
```
Pour chaque rôle R ∈ {dev, qa, po} configuré :
  wipRole[R] = SELECT key FROM issues WHERE current_status IN roleStatuses[R]
```

**Cas aucun rôle configuré** : émet `console.warn("wip-per-role : aucune colonne avec role:dev|qa|po dans board.yaml")` puis retourne `{ byRole: {dev: {count:0,issueKeys:[]}, ...} }`.

**Divergence vs `wip`** : `roleStatuses[R]` n'est **pas** filtré contre les statuts done-category au runtime (contrairement à `inProgressStatuses`). Si une colonne `type: done` est annotée `role: po` dans `board.yaml`, ses issues compteront dans `wip-per-role.po` mais pas dans `wip.currentWip`. Risque silencieux à arbitrer board-side.

**Snapshot** : `computeHistoricWipPerRole` reconstruit le statut à la date D via `last_status_before_D` (même logique que WIP historique, garde-fou `resolved_at` inclus). Stocke `count` par bucket rôle (`"dev"` / `"qa"` / `"po"`).

**Sortie** : `{ byRole: {dev: WipRoleSlice, qa: WipRoleSlice, po: WipRoleSlice} }` où `WipRoleSlice = {count, issueKeys[]}`.
