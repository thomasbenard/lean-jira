# Spec technique — Rapport : lisibilité par groupement thématique

## Impact fichiers

| Fichier | Modification |
|---|---|
| `src/report/generate.ts` | Réorganisation du HTML dans `renderHtml()` + CSS accordéon |

---

## 1. `src/report/generate.ts` — structure HTML

### Découpage actuel (à remplacer)

```
<h2>État actuel (fenêtre 30j glissante)</h2>
  <div class="kpis">  ← 8 KPIs mélangés

<h2>Tendances hebdomadaires</h2>
  <div class="charts">  ← 10 graphes indifférenciés

<h2>Distribution cycle time</h2>
<h2>Forecast Monte Carlo</h2>
<h2>Aging WIP</h2>
<h2>Par taille</h2>
```

### Nouvelle structure cible

```html
<h2>Livraison</h2>
<div class="kpis">
  <!-- 4 KPIs : lead time médian, cycle time médian, throughput, WIP -->
</div>
<div class="charts">
  <!-- 5 graphes : leadTime, cycleTime, throughput, throughputWeighted, wip -->
</div>
<h3>Distribution cycle time</h3>
<!-- histogram chart card -->
<h3>Par taille</h3>
<!-- by-size tables -->
<details class="advanced-section">
  <summary>Métriques avancées ▾</summary>
  <div class="charts">
    <!-- graphes : cycleNormalized, leadNormalized, flowEfficiency -->
  </div>
  <div class="by-size-trends">
    <!-- by-size trend charts avec bucket selector -->
  </div>
</details>

<h2>Bugs &amp; dette qualité</h2>
<div class="kpis">
  <!-- 3 KPIs : bugs livrés, bug cycle médian, bug ratio -->
</div>
<div class="charts">
  <!-- 3 graphes : bugThroughput, bugCycleTime, devTimeAllocation -->
</div>

<h2>Capacité &amp; prévision</h2>
<p class="meta"><!-- forecast meta --></p>
<!-- forecast table -->
<h3>Aging WIP</h3>
<!-- aging scatter + table -->
```

### CSS à ajouter (dans le bloc `<style>`)

```css
details.advanced-section {
  margin-top: 1.5rem;
  border: 1px solid #e3e3e3;
  border-radius: 6px;
  background: #f9fafb;
}
details.advanced-section > summary {
  padding: 0.75rem 1rem;
  cursor: pointer;
  font-weight: 600;
  font-size: 0.95rem;
  color: #374151;
  list-style: none;
  user-select: none;
}
details.advanced-section > summary::-webkit-details-marker { display: none; }
details.advanced-section > summary:hover { color: #2563eb; }
details.advanced-section > :not(summary) {
  padding: 0 1rem 1rem;
}
```

---

## Ordre d'implémentation

1. Ajouter le CSS `.advanced-section` dans le bloc `<style>` de `renderHtml()`
2. Scinder la grille KPIs en deux (4 livraison + 3 bugs) avec les `helpBtn` correspondants
3. Déplacer les 5 graphes livraison dans leur propre `<div class="charts">`
4. Envelopper histogram + by-size tables dans la section Livraison (sous les graphes)
5. Créer le `<details class="advanced-section">` avec les graphes normalisés + by-size trends
6. Créer la section `<h2>Bugs &amp; dette qualité</h2>` avec KPIs bugs + 3 graphes
7. Créer la section `<h2>Capacité &amp; prévision</h2>` avec forecast + aging
8. Vérifier visuellement `npm run report && open report.html`
