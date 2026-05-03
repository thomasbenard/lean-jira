# Example Mapping — Rapport : lisibilité par groupement thématique

## Règle 1 — Accordéon fermé par défaut au chargement

**Au premier affichage, les métriques avancées sont invisibles sans action de l'utilisateur.**

```gherkin
Scenario: chargement initial du rapport
  Given le rapport HTML est ouvert dans un navigateur
  When la page se charge
  Then le bloc "Métriques avancées" est fermé
  And les graphes lead normalisé, cycle normalisé, flow efficiency, by-size trends ne sont pas visibles

Scenario: ouverture manuelle de l'accordéon
  Given le rapport est chargé et l'accordéon est fermé
  When l'utilisateur clique sur "Métriques avancées ▾"
  Then le bloc s'ouvre et les graphes avancés deviennent visibles

Scenario: rechargement de la page remet l'accordéon fermé
  Given l'utilisateur a ouvert l'accordéon
  When il recharge la page
  Then l'accordéon est à nouveau fermé
```

---

## Règle 2 — Séparation des grilles KPI

**Les KPIs de livraison et de bugs sont dans deux grilles distinctes, chacune dans sa section.**

```gherkin
Scenario: KPIs livraison dans la section Livraison
  Given le rapport est chargé
  Then la section "Livraison" contient exactement : lead time médian, cycle time médian, throughput, WIP
  And ne contient pas les KPIs bugs

Scenario: KPIs bugs dans la section Bugs
  Given le rapport est chargé
  Then la section "Bugs & dette qualité" contient : bugs livrés, bug cycle médian, bug ratio
  And ne contient pas les KPIs livraison
```
