# Guide pour demander un test automatisé Eudonet

## Objectif

Ce guide explique comment décrire un parcours Eudonet afin qu'il puisse être automatisé avec le moins d'allers-retours possible.

Une bonne demande doit permettre de répondre sans ambiguïté à cinq questions :

1. Où commence le scénario ?
2. Quelles actions l'utilisateur réalise-t-il ?
3. Comment identifier précisément chaque élément ?
4. Quelles données doivent être utilisées ?
5. Quelle preuve confirme que le test a réussi ?

## Informations indispensables

### 1. Définir le point de départ

Préciser :

- L'URL ou l'environnement : recette, préproduction ou production.
- La page visible au début du test.
- Si la session utilisateur est déjà sauvegardée.
- Le menu ou la rubrique depuis laquelle le parcours commence.
- La taille de navigateur souhaitée.

Exemple :

```text
Environnement : recette Eudonet.
Point de départ : page d'accueil après authentification.
Session : utiliser authentification/eudonet-session.json.
Taille du navigateur : 1400 x 900.
```

### 2. Décrire les actions dans leur ordre exact

Utiliser une instruction par étape. Mentionner les actions intermédiaires, même si elles semblent évidentes.

Bon exemple :

```text
1. Survoler le menu Contacts.
2. Attendre l'affichage du menu déroulant.
3. Cliquer dans son champ de recherche.
4. Saisir "Test".
5. Attendre la mise à jour des résultats.
6. Cliquer sur Nouveau.
7. Dans la fenêtre qui apparaît, cliquer sur Ajouter.
```

Éviter :

```text
Ouvrir un nouveau contact.
```

Cette formulation ne permet pas de savoir quels menus, fenêtres ou boutons doivent être utilisés.

### 3. Décrire le comportement de chaque champ

Pour chaque champ, préciser :

- Son libellé visible.
- Sa position ou sa section si le libellé existe plusieurs fois.
- Son type : texte, date, téléphone, référentiel simple ou catalogue multiple.
- Les actions nécessaires.
- La valeur à utiliser.
- Le résultat visible attendu.

Exemple :

| Champ | Type | Actions | Valeur | Résultat attendu |
| --- | --- | --- | --- | --- |
| Nom Contact | Texte | Cliquer, vider, saisir | Contact-Test | La valeur saisie est visible |
| Pays de résidence | Référentiel simple | Ouvrir, filtrer, sélectionner | France | Le champ contient FRANCE |
| Nationalité | Catalogue multiple | Rechercher, sélectionner, transférer, valider | France | Le champ contient FRANCE |

## Décrire précisément un référentiel

Les référentiels Eudonet n'ont pas tous le même comportement. Ne pas supposer qu'une logique utilisée sur un champ s'applique automatiquement aux autres.

### Référentiel simple

Préciser les étapes suivantes :

```text
1. Cliquer sur le champ pour ouvrir la liste.
2. Cliquer dans le champ de recherche de la liste.
3. Saisir la valeur.
4. Attendre que les résultats soient filtrés.
5. Vérifier que la valeur exacte est présente.
6. Cliquer sur cette valeur.
7. Vérifier que la liste disparaît.
8. Vérifier que le champ contient la valeur attendue.
```

Exemples actuels : Pays de résidence et Pays.

### Catalogue multiple

Préciser :

- Le nom de la popup.
- Le sélecteur du champ de recherche.
- Le tableau des valeurs disponibles.
- Le tableau des valeurs sélectionnées.
- L'action de transfert entre les tableaux.
- Le bouton de validation de la popup.

Exemple actuel pour Nationalité :

```text
1. Cliquer sur Nationalité.
2. Vérifier que la popup Catalogue nationalité apparaît.
3. Saisir France dans #eTxtSrch.
4. Vérifier FRANCE dans #eCEDValues #tbCatVal.
5. Cliquer sur la ligne FRANCE.
6. Cliquer sur #BtnSelect.
7. Vérifier FRANCE dans #eCEDSelValues #tbCatSelVal.
8. Cliquer sur div#ok[ednmodalbtn="1"].
9. Vérifier que la popup disparaît.
10. Vérifier que le champ Nationalité contient FRANCE.
```

## Fournir les identifiants techniques

Lorsqu'un comportement est ambigu, fournir un extrait HTML ou les informations suivantes :

- `id`
- `class`
- `name`
- `title`
- `role`
- attribut `onclick`
- texte visible
- conteneur parent utile

Exemple :

```html
<div ednmodalbtn="1" class="button-green" id="ok">
  <div class="button-green-mid" id="ok-mid">Valider</div>
</div>
```

Préciser quelle partie est réellement cliquable :

```text
Cliquer sur le conteneur div#ok[ednmodalbtn="1"], et non uniquement sur son texte interne.
```

Un extrait HTML est particulièrement utile lorsque :

- Plusieurs boutons portent le même texte.
- Un champ visible est en lecture seule.
- La vraie zone cliquable est un parent.
- Une popup contient plusieurs tableaux.
- Un clic simple et un double-clic ont des effets différents.
- Le libellé est éloigné du champ dans le DOM.

## Définir les données de test

Fournir un tableau contenant :

- Le nom du champ.
- La règle métier.
- Une valeur d'exemple.
- Le caractère obligatoire ou facultatif.
- La nécessité d'une donnée unique.

Exemple :

| Champ | Règle | Exemple | Unique |
| --- | --- | --- | --- |
| Nom Contact | Lettres, espaces et tirets | Contact-Test | Oui |
| Prénom | Lettres, espaces et tirets | Jean Bernard | Non |
| Courriel | Adresse valide | Généré depuis le nom | Oui |
| Date de naissance | `dd/mm/yyyy` | 21/06/2005 | Non |

### Données uniques

Indiquer explicitement quels champs doivent changer à chaque exécution.

Exemple :

```text
À chaque test :
- Générer un Nom Contact unique.
- Générer un courriel unique à partir du nom et du prénom.
- Conserver les autres valeurs du fichier modèle.
- Enregistrer le jeu réellement utilisé pour faciliter le diagnostic.
```

Le scénario Contact actuel utilise :

```json
{
  "donneesUniques": true,
  "nomContact": "Contact-Test",
  "prenom": "Jean Bernard",
  "paysResidence": "France",
  "nationalite": "France",
  "dateNaissance": "21/06/2005",
  "courriel": "",
  "portable": "09 48 57 46 32",
  "pays": "France"
}
```

## Définir le critère de réussite

Un clic sur Valider n'est pas une preuve de réussite. Décrire ce qui doit être observé après l'action.

Critères possibles :

- La popup disparaît.
- Le formulaire disparaît ou passe en mode consultation.
- Un message de succès apparaît.
- Aucun message d'erreur n'est visible.
- Une recherche retrouve la nouvelle fiche.
- Le nombre de résultats augmente entre avant et après.
- La fiche trouvée possède un identifiant Eudonet.
- Les valeurs enregistrées correspondent aux valeurs saisies.

Exemple robuste :

```text
Avant la création, rechercher le nom et compter les résultats.
Après validation, refaire la même recherche.
Le test réussit seulement si le nombre de résultats augmente et si la fiche
retrouvée contient le nom et le prénom attendus.
```

## Préciser si le test peut modifier les données

Toujours indiquer le mode souhaité :

- `Sans soumission` : remplir et vérifier, mais ne pas cliquer sur le bouton final.
- `Avec soumission` : créer réellement la fiche.
- `Avec nettoyage` : créer, vérifier puis supprimer ou archiver la donnée.

Exemple :

```text
Le test peut créer une vraie fiche dans l'environnement de recette.
Ne pas la supprimer automatiquement ; je la supprimerai ensuite.
```

## Indiquer les preuves attendues

Préciser ce que le test doit produire :

- Capture avant validation.
- Capture après création.
- Journal détaillé.
- Données effectivement utilisées.
- Identifiant de la fiche créée.
- Résumé des contrôles.

Le scénario actuel produit :

```text
authentification/eudonet-new-contact.log
authentification/eudonet-new-contact.png
authentification/eudonet-contact-created.png
authentification/eudonet-contact-data-used.json
```

## Signaler les contraintes temporelles

Eudonet peut afficher un voile de chargement ou mettre à jour ses listes avec un délai.

Préciser si nécessaire :

- Le délai habituel d'ouverture d'une popup.
- Si une recherche démarre à chaque caractère.
- Si les résultats sont chargés de façon asynchrone.
- Si un bouton reste temporairement bloqué.
- Le délai maximal acceptable avant échec.

Préférer :

```text
Après la saisie, attendre que FRANCE apparaisse dans le tableau avant de cliquer.
```

Éviter :

```text
Attendre deux secondes puis cliquer.
```

L'attente d'un état visible est plus fiable qu'un délai fixe.

## Modèle de demande prêt à copier

```markdown
# Nom du scénario

## Objectif
[Décrire en une phrase le résultat métier attendu.]

## Environnement
- URL :
- Environnement :
- Session à utiliser :
- Taille du navigateur :

## Point de départ
[Décrire la page et l'état visibles au lancement.]

## Données de test
| Champ | Type | Règle | Valeur | Unique |
| --- | --- | --- | --- | --- |
| | | | | |

## Étapes
1. [Action précise]
2. [État à attendre]
3. [Action suivante]

## Champs référentiels
### [Nom du champ]
1. [Ouverture]
2. [Recherche]
3. [Contrôle du résultat]
4. [Sélection]
5. [Contrôle de la valeur finale]

## Identifiants techniques
- Champ :
- Sélecteur :
- Extrait HTML :
- Élément réellement cliquable :

## Validation finale
- Bouton :
- Sélecteur :
- Action :

## Critères de réussite
- [Preuve 1]
- [Preuve 2]
- [Preuve 3]

## Mode d'exécution
- [ ] Sans soumission
- [ ] Avec création réelle
- [ ] Avec suppression automatique

## Preuves attendues
- [ ] Capture avant validation
- [ ] Capture après validation
- [ ] Journal
- [ ] Identifiant créé
- [ ] Données utilisées
```

## Exemple de formulation complète

```text
Dans Eudonet recette, avec la session sauvegardée et une fenêtre 1400 x 900,
créer un nouveau contact depuis le menu Contacts.

Utiliser un nom et un courriel uniques à chaque exécution. Conserver le prénom
Jean Bernard, la date 21/06/2005 et le téléphone 09 48 57 46 32.

Pour Pays de résidence et Pays, ouvrir la liste intégrée, saisir France,
attendre la proposition FRANCE, cliquer dessus, vérifier la fermeture de la
liste puis contrôler la valeur finale du champ.

Pour Nationalité, ouvrir la popup Catalogue nationalité, rechercher France dans
#eTxtSrch, vérifier FRANCE dans #eCEDValues, sélectionner la ligne, cliquer sur
#BtnSelect, vérifier FRANCE dans #eCEDSelValues puis cliquer sur
div#ok[ednmodalbtn="1"]. Vérifier ensuite que le champ contient FRANCE.

Avant la validation finale, relire les huit champs et comparer leurs valeurs
avec le jeu de données. Cliquer ensuite sur Valider.

Le test réussit si le formulaire est enregistré sans erreur et si une recherche
du nom unique retourne un résultat supplémentaire avec un identifiant Eudonet.
Conserver le journal, les captures et le jeu de données réellement utilisé.
```

## Checklist avant d'envoyer une demande

- Le point de départ est-il clair ?
- Chaque clic est-il décrit dans son ordre réel ?
- Les popups et listes sont-elles distinguées ?
- Les valeurs attendues sont-elles fournies ?
- Les champs uniques sont-ils indiqués ?
- Les sélecteurs ou extraits HTML ambigus sont-ils fournis ?
- Le mode avec ou sans création réelle est-il explicite ?
- Le critère de réussite est-il observable et vérifiable ?
- Le comportement attendu en cas d'erreur est-il précisé ?
- Les preuves à conserver sont-elles listées ?

Plus ces éléments sont fournis dès le départ, plus l'automatisation peut être développée, testée et validée en une seule boucle.
