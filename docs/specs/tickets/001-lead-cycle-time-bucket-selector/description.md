# Ticket 001 — Lead/cycle time par taille : séries temporelles avec sélecteur de bucket

## User story

En tant que lead technique ou responsable d'équipe, je veux visualiser l'évolution dans le temps du lead time et du cycle time pour chaque catégorie de taille de ticket (XS, S, M, L, XL, BUG), afin de détecter si les grandes stories dérivent, si les petits tickets restent rapides, et d'identifier des tendances de régression par taille avant qu'elles n'impactent les engagements.

## Solution retenue

Deux graphiques de séries temporelles (lead time par taille / cycle time par taille), placés dans la section "Par taille" du rapport HTML. Chaque graphique affiche des boutons de sélection de bucket (XS / S / M / L / XL / BUG / UNESTIMATED — uniquement les buckets ayant des données). Clic sur un bouton → affiche trois courbes P50 / P85 / P95 pour ce bucket sur toute la fenêtre historique des snapshots. Interactif côté client uniquement, pas de rechargement de page.

## Statut

**To be implemented**
