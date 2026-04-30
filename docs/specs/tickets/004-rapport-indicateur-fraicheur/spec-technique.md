# Spec technique — Rapport : indicateur de fraîcheur des données

## Impact fichiers

| Fichier | Modification |
|---|---|
| `src/db/store.ts` | Nouvelle fonction `getLastSyncDate(db, projectKey)` |
| `src/report/generate.ts` | Lire la date de sync, l'injecter dans `RenderInput`, afficher dans le HTML |
| `src/main.ts` | Passer `config.jira.projectKey` à `generateReport` (déjà présent — vérifier) |

---

## 1. `src/db/store.ts` — `getLastSyncDate`

```typescript
// Retourne la date ISO du dernier sync réussi pour ce project_key, ou null si aucun.
export function getLastSyncDate(db: Database.Database, projectKey: string): string | null {
  const row = db.prepare(
    "SELECT MAX(synced_at) as last FROM sync_log WHERE project_key = ?"
  ).get(projectKey) as { last: string | null };
  return row?.last ?? null;
}
```

---

## 2. `src/report/generate.ts`

### Import

```typescript
import { getLastSyncDate } from "../db/store";
```

### Dans `generateReport`

```typescript
const STALE_THRESHOLD_DAYS = 7;

const lastSyncAt = getLastSyncDate(db, projectKey);
const isSyncStale = lastSyncAt === null
  || (Date.now() - new Date(lastSyncAt).getTime()) > STALE_THRESHOLD_DAYS * 86_400_000;
```

### Interface `RenderInput`

```typescript
interface RenderInput {
  // ... champs existants ...
  lastSyncAt: string | null;
  isSyncStale: boolean;
}
```

### Dans `renderHtml` — ligne de métadonnées

```typescript
// Avant
`<p class="meta">Généré le ${escapeHtml(input.generatedAt)} · Dernière fenêtre hebdo : ${escapeHtml(input.lastSnapshotDate)}</p>`

// Après
const syncLabel = input.lastSyncAt
  ? `Données Jira du ${escapeHtml(input.lastSyncAt.slice(0, 16).replace("T", " "))}`
  : "Données Jira : jamais synchronisé";

`<p class="meta">Généré le ${escapeHtml(input.generatedAt)} · ${syncLabel} · Dernière fenêtre hebdo : ${escapeHtml(input.lastSnapshotDate)}</p>`
```

### Bandeau d'avertissement (CSS + HTML)

CSS à ajouter dans le `<style>` :

```css
.stale-warning {
  background: #fff3cd;
  border: 1px solid #f59e0b;
  color: #92400e;
  padding: 0.6rem 1rem;
  border-radius: 6px;
  margin-bottom: 1.5rem;
  font-size: 0.9rem;
}
```

HTML conditionnel, placé après `<p class="meta">...</p>` :

```typescript
const staleBanner = input.isSyncStale
  ? `<div class="stale-warning">⚠ Données potentiellement périmées — dernier sync ${input.lastSyncAt ? `le ${input.lastSyncAt.slice(0, 10)}` : "jamais effectué"}. Lancer <code>npm run sync</code>.</div>`
  : "";
```

Insérer `${staleBanner}` entre la balise `<p class="meta">` et le premier `<h2>`.

---

## Ordre d'implémentation

1. Ajouter `getLastSyncDate` dans `store.ts`
2. Lire la date et calculer `isSyncStale` dans `generateReport`
3. Ajouter `lastSyncAt` et `isSyncStale` à `RenderInput` + l'objet passé à `renderHtml`
4. Mettre à jour `renderHtml` : métadonnées + CSS + bandeau conditionnel
