# Example Mapping — Rapport Cockpit

## Règle 1 — Statut du verdict global

**Le statut verdict prend la valeur la plus sévère parmi les 8 KPIs : `alert` si ≥1 KPI rouge, `watch` si aucun rouge mais ≥1 orange, `ok` sinon.**

```gherkin
Scenario: tous les KPIs verts ou sans signal → statut sain
  Given un rapport généré avec lead 5j (vert), cycle 1.5j (vert), throughput 18 (vert)
  And aucun seuil configuré pour les autres KPIs (signal "none")
  When je consulte le bandeau verdict
  Then le statut affiché est "✓ SAIN"
  And la phrase est "Tous les indicateurs dans la zone verte."
  And la bordure latérale du bandeau est verte

Scenario: au moins un KPI rouge → statut alerte
  Given un rapport généré avec lead 14j (rouge, seuil crit 12), WIP 30 (rouge, seuil crit 25)
  And cycle 3.3j (orange)
  When je consulte le bandeau verdict
  Then le statut affiché est "⚠ ALERTE"
  And la phrase mentionne "Lead time 14.0j" et "WIP 30"
  And la bordure latérale du bandeau est rouge

Scenario: aucun rouge mais oranges présents → statut vigilance
  Given un rapport généré avec lead 11j (orange), cycle 3.3j (orange)
  And tous les autres KPIs verts ou sans signal
  When je consulte le bandeau verdict
  Then le statut affiché est "◐ VIGILANCE"
  And la phrase mentionne les 2 KPIs orange
  And la bordure latérale du bandeau est ambre
```

---

## Règle 2 — Top-3 actions auto-générées

**Le bloc "Top-3 actions" liste jusqu'à 3 issues triées par âge décroissant : d'abord les `critical`, puis complétées par les `at-risk` si moins de 3 critical disponibles. Si aucune issue critical ou at-risk, afficher une carte verte unique.**

```gherkin
Scenario: 5 critical disponibles → 3 plus anciens listés
  Given aging WIP avec 5 issues critical (âges 72j, 64j, 30j, 20j, 19j) et 2 at-risk
  When je consulte le bloc Top-3 actions
  Then la carte 01 affiche l'issue 72j critical
  And la carte 02 affiche l'issue 64j critical
  And la carte 03 affiche l'issue 30j critical
  And aucune issue at-risk n'apparaît dans le bloc

Scenario: 1 critical seulement → complété par at-risk
  Given aging WIP avec 1 issue critical (âge 30j) et 4 at-risk (12j, 11j, 11j, 10j)
  When je consulte le bloc Top-3 actions
  Then la carte 01 affiche l'issue 30j critical (bordure rouge)
  And la carte 02 affiche l'issue 12j at-risk (bordure ambre)
  And la carte 03 affiche l'issue 11j at-risk (bordure ambre)

Scenario: aucun critical ni at-risk → carte verte unique
  Given aging WIP avec uniquement des issues "watch" et "ok"
  When je consulte le bloc Top-3 actions
  Then une seule carte est affichée
  And elle indique "✓ Aucun ticket en zone critique"
  And sa bordure latérale est verte

Scenario: chaque carte action contient un lien Jira cliquable
  Given une issue critical avec issueKey "SWNGF-5444"
  When je consulte la carte action correspondante
  Then la carte contient un <a href="https://jira.cloud.nexpublica.com/browse/SWNGF-5444" target="_blank">
  And l'attribut rel="noopener" est présent
```

---

## Règle 3 — Calcul du delta 4 sem sur les KPIs

**Le delta 4 sem affiché sous chaque KPI est `((curr - ref) / ref) × 100` où `ref` est la moyenne des 4 dernières semaines avant la semaine courante. Si l'historique a moins de 5 points, le delta est masqué.**

```gherkin
Scenario: historique riche → delta calculé
  Given une série lead time avec 12 valeurs [..., 10, 10, 10, 10, 12.4]
  When je consulte la cellule KPI "Lead median"
  Then la valeur affichée est "12.4"
  And le delta affiché est "▲ 24% / 4 sem" (ref = avg(10,10,10,10) = 10)
  And la couleur du delta est rouge (lead = lowerIsBetter, ↑ = mauvais)

Scenario: historique court → delta masqué
  Given une série throughput avec seulement 3 valeurs [12, 14, 13]
  When je consulte la cellule KPI "Throughput / 7j"
  Then la valeur affichée est "13"
  And aucun delta n'est affiché (ou affiché "—")

Scenario: variation positive sur higher-is-better → vert
  Given une série throughput avec [..., 8, 8, 8, 8, 13]
  When je consulte la cellule KPI "Throughput / 7j"
  Then le delta est "▲ 63% / 4 sem"
  And la couleur du delta est verte (throughput = higherIsBetter, ↑ = bon)

Scenario: variation < 1% → classe flat (gris)
  Given une série lead time avec [..., 10, 10.05, 10.02, 10.01, 10.04]
  When je consulte la cellule KPI "Lead median"
  Then le delta est affiché avec la classe "flat"
  And la couleur est grise neutre
```

---

## Règle 4 — Switch d'onglets

**Un seul `.tab-panel` est visible à la fois. Le clic sur un `.tab` retire la classe `.active` de tous les boutons et panels, puis l'ajoute au bouton cliqué et au panel correspondant via `data-tab`.**

```gherkin
Scenario: chargement initial → onglet Livraison actif
  Given le rapport vient d'être chargé
  When j'observe les onglets
  Then le bouton "Livraison" a la classe "active"
  And le panel "tab-delivery" a la classe "active" et est visible
  And les 4 autres panels ont display:none

Scenario: clic sur "Qualité & bugs" → switch
  Given je suis sur l'onglet Livraison
  When je clique sur le bouton "Qualité & bugs"
  Then le bouton "Livraison" perd la classe "active"
  And le bouton "Qualité & bugs" gagne la classe "active"
  And le panel "tab-delivery" devient invisible
  And le panel "tab-quality" devient visible

Scenario: les charts du panel caché restent rendus en mémoire
  Given je suis sur l'onglet Livraison où "leadTimeChart" est rendu
  When je passe à l'onglet "Qualité & bugs" puis je reviens à "Livraison"
  Then "leadTimeChart" est toujours présent dans le DOM
  And aucune erreur Chart.js dans la console
```

---

## Règle 5 — Préservation des fonctionnalités existantes

**Les `?` (help-btn), le bouton zoom (zoom-btn) et les tooltips Chart.js restent fonctionnels après la refonte.**

```gherkin
Scenario: survol d'un ? sur un KPI → popover affiché
  Given le KPI "Lead median" possède un helpKey "leadTime"
  When je survole le bouton "?" à côté du libellé
  Then le popover ".help-popover" apparaît au-dessus du bouton
  And le popover contient le titre "Lead time"
  And le popover contient la description complète depuis HELP_TEXTS

Scenario: clic sur le bouton zoom → modal ouvert avec re-render
  Given le chart "leadTimeChart" est rendu dans une .chart-card
  When je clique sur le bouton ".zoom-btn" en haut-droite
  Then l'overlay ".chart-modal-overlay" devient visible (classe "open")
  And un nouveau chart est instancié dans #chartModalCanvas avec les mêmes données
  And le titre du modal correspond au H3 de la chart-card source
  And la description provient de HELP_TEXTS via CANVAS_KEY

Scenario: fermeture du modal par Escape
  Given le modal de zoom est ouvert
  When j'appuie sur la touche Escape
  Then l'overlay perd la classe "open"
  And le chart instancié dans #chartModalCanvas est détruit (Chart.destroy)
  And document.body.style.overflow est réinitialisé

Scenario: survol d'une courbe → tooltip Chart.js avec valeur
  Given je suis sur le chart "leadTimeChart" rendu en mode line
  When je survole un point de la courbe à la date 2026-04-19
  Then un tooltip Chart.js apparaît
  And il affiche "2026-04-19" et la valeur médiane correspondante (ex. "P50: 17.0")
  And le style du tooltip utilise la palette sombre (fond #0c0d12)

Scenario: chart dual-axis → tooltip aligne toutes les séries sur la même date
  Given je suis sur le chart "devTimeAllocationChart" (interaction.mode "index")
  When je survole une barre de la semaine 2026-04-19
  Then le tooltip affiche les 3 valeurs : Features (j), Bugs (j), Bug ratio (%)
  And toutes correspondent à la même date 2026-04-19
```

---

## Règle 6 — Suppression du toggle thème

**Le rapport est exclusivement sombre. Plus aucune référence à `localStorage.lean-theme` ni à la classe `html.dark`.**

```gherkin
Scenario: chargement à froid → directement en thème sombre
  Given un navigateur sans entrée localStorage "lean-theme"
  When je charge report.html
  Then la balise <html> n'a pas la classe "dark"
  And le fond <body> est de couleur sombre (#08090c)
  And aucun bouton "Clair / Sombre" n'est visible dans le header

Scenario: localStorage existant ne casse rien
  Given localStorage["lean-theme"] = "dark" (résidu de l'ancien rapport)
  When je charge report.html
  Then aucune erreur JS dans la console
  And l'apparence reste identique au scenario précédent
```
