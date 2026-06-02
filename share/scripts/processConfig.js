const PROCESS_DEFINITIONS = {
  'candidature-to-edunote': {
    id: 'candidature-to-edunote',
    title: 'Parcours candidature jusqu a Edunote',
    environment: 'Recette',
    steps: [
      {
        id: 'front-candidature',
        title: 'Creer et valider la candidature front',
        type: 'node-script',
        script: 'runCampaign.js',
        defaultArgs: ['--campaign', 'tnr-front-recette'],
        produces: ['reports/business/latest/campaign-summary.json'],
      },
      {
        id: 'edunote-check',
        title: 'Verifier la candidature dans Eudonet',
        type: 'manual-placeholder',
        enabled: false,
        reason: 'A automatiser quand les acces SSO Microsoft, les donnees attendues et les regles de controle Eudonet seront confirmes.',
        needs: ['front-candidature'],
        urlEnv: 'EUDONET_URL',
        defaultUrl: 'https://test-omnes.eudonet.com/test',
        expectedDataGroups: [
          'candidate_identity',
          'candidate_contacts',
          'program_choice',
          'studies',
          'attachments',
          'application_status',
          'payment_status',
        ],
      },
    ],
  },
};

function getProcess(processId = 'candidature-to-edunote') {
  const definition = PROCESS_DEFINITIONS[processId];
  if (!definition) {
    throw new Error(`Processus introuvable: ${processId}`);
  }
  return definition;
}

module.exports = {
  PROCESS_DEFINITIONS,
  getProcess,
};
