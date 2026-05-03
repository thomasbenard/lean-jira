# Ticket 014 — Rapport : lisibilité par groupement thématique

## User story

En tant que lead technique, je veux que le rapport HTML organise ses métriques en sections
thématiques avec les métriques avancées repliées par défaut, afin de lire l'essentiel en
un coup d'œil sans être noyé par 10 graphes au même niveau visuel.

## Solution retenue

Réorganisation pure du HTML de `renderHtml()` dans `src/report/generate.ts` en 3 sections H2 :
**Livraison**, **Bugs & dette qualité**, **Capacité & prévision**. Les métriques secondaires
(lead/cycle normalisés, by-size trends, flow-efficiency) sont regroupées dans un bloc
`<details>/<summary>` fermé par défaut à l'intérieur de la section Livraison. Aucun
changement de logique TypeScript, de calcul ou de schéma DB.

## Estimation

**Bucket** : S

**Justification** : 1 fichier touché (`generate.ts`), réorganisation HTML + CSS uniquement,
accordéon via `<details>/<summary>` natif (aucun JS custom), 2-3 scénarios de test UI.
Risque principal : régression visuelle sur les graphes déplacés — vérifiable visuellement.

## Statut

**livré**
