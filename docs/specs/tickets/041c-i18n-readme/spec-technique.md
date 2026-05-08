# Spec technique — Réécriture README en anglais

## Impact fichiers

| Fichier | Modification |
|---|---|
| `README.md` | Réécriture complète en anglais |
| `README.fr.md` | Nouveau — copie de l'actuel `README.md` |

Aucun fichier `src/` touché. Aucune migration DB. Aucun test.

---

## Ordre d'implémentation

1. Copier `README.md` → `README.fr.md` (git mv pour préserver l'historique)
2. Réécrire `README.md` en anglais section par section
3. Ajouter le lien `> 🇫🇷 [Version française](README.fr.md)` en haut du README anglais
4. Ajouter le lien symétrique `> 🇬🇧 [English version](README.md)` en haut de `README.fr.md`

```bash
git mv README.md README.fr.md
# Écrire README.md en anglais
```
