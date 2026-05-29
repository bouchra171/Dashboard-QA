# Version stable Dashboard QA

Date de validation : 2026-05-29

Etat :
- Le dashboard demarre correctement sur `http://127.0.0.1:4173/`.
- Le health check repond avec `{"ok":true}`.
- Cette version sert de base avant la suite de l'automatisation des donnees saisies et des pieces justificatives.

Notes importantes :
- Le depot Git exclut `tools/` et `share/node_modules/` car ces dossiers contiennent des binaires lourds non adaptes a GitHub.
- Une archive locale complete doit etre conservee pour garder une copie executable telle quelle avec le runtime portable.
