# Spec fonctionnelle — Rapport : métriques role-aware

## Contexte

Les tickets 021–025 ajoutent 5 métriques role-aware qui décrivent comment le flux se distribue entre dev, qa et po. Elles sont calculées et snapshotées mais absentes du rapport HTML. Un lead technique qui veut identifier un goulot (QA débordée, rework excessif, FTR faible) doit aujourd'hui lancer `npm run metrics` en CLI. Ce ticket les intègre dans le rapport.

## Nouvelle section : "Flux par rôle"

Positionnement : après la section "Capacité & prévision", avant la balise `</body>`. La section est **toujours visible** (pas dans un `<details>`) car ces métriques sont centrales pour un lead technique.

### Condition d'affichage

Si aucun rôle n'est configuré dans `board.yaml` (pas de colonne avec `role: dev|qa|po`), la section affiche un message d'avertissement et aucun graphique.

---

### 1. Stage time breakdown (`stage-time-breakdown`)

**KPI cards** (ligne de 3) :
- Temps médian dev (dernière snapshot)
- Temps médian qa (dernière snapshot)
- Temps médian po (dernière snapshot)

**Graphique "Temps médian par rôle (jours)"** : barres groupées par rôle (dev / qa / po), une barre médiane + une barre P85 pour chaque rôle. Axe X = dates de snapshot. Affiche la part relative de chaque rôle dans le cycle time.

**Donut "Répartition moyenne du cycle time"** : `avgShare` dev/qa/po sur la dernière snapshot. Affiché à côté du graphique de tendance.

---

### 2. WIP par rôle (`wip-per-role`)

**KPI cards** (ligne de 3) :
- WIP dev (dernière snapshot)
- WIP qa (dernière snapshot)
- WIP po (dernière snapshot)

**Graphique "WIP par rôle"** : courbes dev / qa / po en multi-séries sur le temps.

---

### 3. Stage throughput gap (`stage-throughput-gap`)

**Graphique "Flux net par rôle (entrées − sorties)"** : barres groupées par rôle pour chaque semaine. Barres positives = plus d'entrées que de sorties (backlog de rôle grossit), barres négatives = plus de sorties. Axe Y peut être négatif.

Pas de KPI card (la valeur prise isolément est peu lisible sans le contexte temporel).

---

### 4. Handoff rework (`handoff-rework`)

**KPI cards** (ligne de 2) :
- % tickets avec rework (dernière snapshot)
- Reworks moyens par ticket (dernière snapshot)

**Graphique "Taux de rework"** : courbe `reworkRatio` (%) sur le temps.

**Graphique "Reworks par type"** : barres groupées `qaToDev` / `poToQa` / `poDev` par snapshot.

---

### 5. First-time-right rate (`first-time-right`)

**KPI cards** (ligne de 3) :
- FTR dev % (dernière snapshot)
- FTR qa % (dernière snapshot)
- FTR po % (dernière snapshot)

**Graphique "First-time-right rate par rôle"** : courbes dev / qa / po en multi-séries. Axe Y = 0–100%.

---

## Cas limites

- Rôle non configuré dans board.yaml → `byRole[role].count === 0` dans snapshot → graphique affiche "Aucune donnée" pour ce rôle ; pas d'erreur JS.
- Tickets 022–025 non encore implémentés → aucune snapshot pour ces métriques → graphiques absents (canvas non rendu si série vide), section affiche uniquement les métriques disponibles.
- `stage-time-breakdown` implémenté (021) mais 022–025 pas encore livrés → section partiellement peuplée, comportement correct.
- Un seul point de snapshot disponible → graphiques de tendance affichent un seul point sans erreur.
- `avgShare` tous à 0 (aucune issue avec rôle connu) → donut non rendu.

## Ce qui ne change pas

- Logique de calcul des métriques (aucune modification dans `src/metrics/`).
- Structure de la table `metric_snapshots` (aucune migration DB).
- Sections existantes du rapport (Livraison, Bugs, Capacité).
- Commande `npm run snapshots` : aucun changement d'interface, uniquement de nouvelles branches internes.
