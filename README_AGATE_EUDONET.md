# Automatisation Eudonet vers Agate

## Prerequis

- Node.js installe.
- Google Chrome installe.
- Acces Eudonet recette.
- Acces Agate/FELIX recette.
- Connexion reseau/VPN active si necessaire.

## Installation

```bash
npm install
```

## Initialiser les sessions locales

Chaque utilisateur doit creer ses propres sessions. Les fichiers de session ne doivent pas etre partages.

```bash
npm run eudonet:session
npm run agate:session
```

Attendre que la page cible soit bien ouverte avant la sauvegarde :

- Eudonet : ancienne interface ou page principale Eudonet chargee.
- Agate : page Agate/FELIX candidat chargee.

## Lancer le parcours Eudonet complet

Creation du contact, creation de la candidature et identification.

```bash
npm run agate:eudonet
```

Le dernier candidat utilise est enregistre ici :

```txt
authentification/eudonet-contact-data-used.json
```

## Lancer la recherche/import Agate

```bash
npm run agate:search
```

## Preuves generees localement

Les captures, logs, rapports et sessions sont generes dans :

```txt
authentification/
```

Ces fichiers sont locaux et ne doivent pas etre committes.

## Etat actuel connu

- Le parcours Eudonet est operationnel pour creer un contact et une candidature.
- Agate ouvre la page candidat, clique l'import Eudonet et recherche par nom/prenom.
- Le candidat peut encore ne pas remonter cote Agate selon le parametrage campagne/ecole/annee universitaire.
- Le filtre "Toutes les ecoles" reste un point a fiabiliser selon le composant Agate.
