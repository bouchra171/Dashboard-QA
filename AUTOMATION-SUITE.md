# Suite automatisation QA

## Objectif

Faire evoluer l'automatisation actuelle, centree sur le formulaire de candidature, vers un parcours metier multi-applications :

1. Creer ou valider une candidature depuis le front.
2. Controler les pieces jointes et les donnees transmises.
3. Verifier la suite du traitement dans Eudonet.
4. Ajouter ensuite les autres applications du processus sans melanger les responsabilites.

## Etat actuel

- Le formulaire front est pilote par Playwright via `share/scripts/runBusiness.js`.
- Une campagne multi-ecoles existe via `share/scripts/runCampaign.js`.
- Le dashboard local lit les resultats de campagne et permet les relances.
- Les pieces jointes du projet sont utilisees comme fixtures d'exemple pour tester le transfert et la visibilite cote back-office.
- Meme quand les fixtures sont factices, elles doivent rester identifiees comme donnees de test et ne jamais etre remplacees par de vrais documents candidat.

## Nouvelle organisation

Le niveau "processus" est ajoute au-dessus des campagnes avec :

- `share/scripts/processConfig.js` : declaration des etapes metier.
- `share/scripts/runProcess.js` : orchestrateur sequentiel des etapes.

Processus initial :

- `front-candidature` : lance la campagne formulaire existante.
- `edunote-check` : placeholder desactive, a activer quand les acces et controles Eudonet seront connus.

Commandes utiles :

```bash
npm run run:process:dry
npm run run:process:front:dry
npm run run:process:front
node scripts/runProcess.js --until front-candidature --schools bachelorsinseec --no-payment
```

## Eudonet

URL de recette identifiee :

```text
https://test-omnes.eudonet.com/test
```

Cette URL redirige vers une authentification SAML Microsoft :

```text
https://login.microsoftonline.com/.../saml2
```

Avant de coder l'etape Eudonet, il faut figer :

- Methode d'authentification SSO Microsoft compatible automatisation.
- Donnees de connexion et leur stockage en secrets.
- Critere de recherche candidat : email, nom/prenom, numero candidature ou autre identifiant.
- Etats attendus apres soumission du formulaire.
- Controle des pieces jointes : presence, type, nom, statut de validation.
- Temps d'attente acceptable entre candidature front et disponibilite dans Eudonet.

Controle attendu pour les informations NewForm dans Eudonet :

1. Identite candidat : nom, prenom, date de naissance, pays, nationalite.
2. Contacts candidat : email, telephone.
3. Contacts parent/responsable si presents : email parent, telephone parent.
4. Choix de formation : ecole, campus, session, niveau d'admission, programme, specialisation ou option si presente.
5. Etudes : niveau d'etude, type d'etude, etablissement, session d'admission et champs specifiques par ecole.
6. Statut candidature : candidature creee, transmise, en attente, validee ou autre statut Eudonet.
7. Paiement si applicable : paiement requis, paiement accepte/refuse, reference ou statut visible.

Controle attendu pour les pieces jointes :

1. Lire les pieces declarees dans le JDD `page2.attachments`.
2. Apres soumission front, rechercher le candidat dans Eudonet.
3. Ouvrir le dossier candidat ou admission.
4. Verifier que chaque categorie attendue est visible cote Eudonet.
5. Verifier le statut de chaque piece : presente, ouvrable, rejetee ou absente.
6. Remonter le detail dans le resultat JSON avec le libelle front, le fichier fixture et le libelle Eudonet trouve.

L'etape Eudonet devra produire un resultat JSON standard :

```json
{
  "status": "OK",
  "candidateFound": true,
  "checkedFields": [],
  "checkedAttachments": [
    {
      "frontLabel": "Curriculum vitae",
      "fixturePath": "attachments/cv/cv.pdf",
      "eudonetLabel": "Curriculum vitae",
      "status": "present"
    }
  ],
  "evidence": []
}
```

## Pipeline plus tard

Le pipeline est volontairement reporte.

Il manque encore d'autres applications dans le parcours metier. La priorite actuelle est donc :

1. Stabiliser le parcours local NewForm.
2. Verifier les donnees et pieces jointes dans Eudonet.
3. Identifier les autres applications a ajouter au processus.
4. Standardiser les resultats de chaque etape.
5. Revenir au pipeline seulement quand le parcours complet sera clair.

Secrets a prevoir :

- `EUDONET_URL`
- `EUDONET_USERNAME`
- `EUDONET_PASSWORD`
- `PAYMENT_TEST_CARD`
- `PAYMENT_TEST_EXP`
- `PAYMENT_TEST_CVV`

Ne jamais stocker ces valeurs dans le repo.

## Prochaine implementation

1. Stabiliser le run formulaire jusqu'a la fin attendue pour 1 ou 2 ecoles pilotes.
2. Ajouter `share/scripts/apps/eudonet/checkCandidate.js`.
3. Faire retourner un JSON standard par l'etape Eudonet.
4. Brancher Eudonet dans `runProcess.js`.
5. Exposer le statut processus complet dans le dashboard.
