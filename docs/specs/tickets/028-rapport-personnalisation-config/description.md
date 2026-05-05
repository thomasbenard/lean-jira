# Ticket 028 — Rapport HTML personnalisable via config YAML

## User story

En tant que lead technique, je veux personnaliser l'apparence et le contenu du rapport HTML
via `board.yaml`, afin d'adapter le livrable à mon équipe (logo, police, onglets non pertinents
masqués) sans toucher au code TypeScript.

## Solution retenue

Ajout d'une section `report:` optionnelle dans `board.yaml` (et donc dans `BoardFileConfig`)
supportant cinq clés :

| Clé | Type | Effet |
|---|---|---|
| `title` | `string` | Remplace "Rapport Lean" dans `<title>` et le header |
| `logoUrl` | `string` | Chemin local ou URL ; si local, lu et embarqué en base64 dans la balise `<img>` |
| `fontUrl` | `string` | Remplace le `<link>` Google Fonts ; si absent, police IBM Plex conservée |
| `customCssPath` | `string` | Chemin vers un fichier `.css` ; lu et injecté inline après le bloc `<style>` défaut |
| `excludeTabs` | `string[]` | Onglets à masquer : `delivery`, `quality`, `roles`, `forecast`, `advanced` |

`generateReport()` lit et résout les ressources locales (`logoUrl`, `customCssPath`) avant
d'appeler `renderHtml()`, qui reçoit un objet `ReportPersonalization` dans `RenderInput`.
Le HTML produit reste auto-suffisant (pas de dépendances locales non embarquées).

## Estimation

**Bucket** : M

**Justification** : 2 fichiers modifiés (`main.ts` pour le type + `generate.ts` pour la
lecture des ressources et le rendu conditionnel). Pattern existant clair. 5-6 scénarios de
test. Aucune migration DB.

## Statut

**à faire**
