# Design : Index des tickets + script update-ticket.sh

**Date :** 2026-05-09  
**Statut :** approuvé

## Contexte

41 tickets spécifiés dans `docs/specs/tickets/`. Aucun fichier d'index. Découverte du backlog = `ls` manuel. Les skills `/ticket-spec` et `/implement-ticket` ne maintiennent pas de registre centralisé.

## Objectif

- Un fichier `docs/specs/tickets/INDEX.md` : tableau markdown de référence (tous tickets, statut, description, lien).
- Un script bash `scripts/update-ticket.sh` : maintient INDEX.md et `description.md` en cohérence automatiquement.
- Les skills `/ticket-spec` et `/implement-ticket` appellent le script — zéro mise à jour manuelle.

## Fichier INDEX.md

**Emplacement :** `docs/specs/tickets/INDEX.md`

**Structure :**

```markdown
# Index des tickets

| N° | Description | Statut |
|---|---|---|
| [001](001-lead-cycle-time-bucket-selector/description.md) | Lead/cycle time par taille : sélecteur de bucket | livré |
...
```

**Colonnes :**
- `N°` : numéro du ticket, lien relatif vers `description.md`
- `Description` : une ligne (user story condensée)
- `Statut` : `à faire` | `en cours` | `livré`

**Ordre :** chronologique (001 → 041c). Tickets multi-lettre (039a, 039b…) insérés dans l'ordre alphanumérique naturel.

## Script `scripts/update-ticket.sh`

### Commande `add`

```bash
bash scripts/update-ticket.sh add <num> <slug> "<description>"
```

- Insère une ligne dans INDEX.md au bon rang (trié par numéro)
- Statut initial : `à faire`
- Idempotent : ne duplique pas si la ligne existe déjà

### Commande `status`

```bash
bash scripts/update-ticket.sh status <num> <statut>
```

- Met à jour la cellule statut dans INDEX.md (sed sur la ligne du ticket)
- Met à jour la ligne `Statut:` dans `description.md` du ticket
- Trouve le dossier du ticket via glob `docs/specs/tickets/<num>-*/`
- Valeurs acceptées : `à faire`, `en cours`, `livré`

### Appel manuel

```bash
bash scripts/update-ticket.sh status 028 livré
```

Utilisable sans passer par un skill (correction ad hoc).

## Modifications des skills

### `/ticket-spec` — étape ajoutée en fin de checklist

> Après création des fichiers du ticket, appeler :
> ```bash
> bash scripts/update-ticket.sh add <num> <slug> "<description one-line>"
> ```

### `/implement-ticket` — remplacement de l'étape manuelle

L'étape actuelle "écrire `Statut: **livré**` dans description.md" est remplacée par :

> ```bash
> bash scripts/update-ticket.sh status <num> livré
> ```
>
> Le script met à jour description.md ET INDEX.md atomiquement.

## Non inclus (hors scope)

- Colonne "zone fonctionnelle" : différée, catégorisation manuelle à ajouter plus tard
- Régénération complète de INDEX.md : pas nécessaire avec le script incrémental
- Intégration CI : pas demandée
