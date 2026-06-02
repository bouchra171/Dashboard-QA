const { splitCsv } = require('./config');

function normalizeStatus(value) {
  return String(value || '').trim().toLowerCase();
}

function extractScenarios(payload, selectedLot, config) {
  const statusFilter = splitCsv(config.SQUASH_EXECUTION_STATUS_FILTER, ['À exécuter', 'Bloqué', 'Échec'])
    .map(normalizeStatus);
  const environment = (selectedLot.environments || [])
    .find((item) => String(item.nom).toLowerCase() === String(selectedLot.environnement).toLowerCase());

  if (!environment) return [];

  const scenarios = [];
  for (const campagne of environment.campagnes || []) {
    for (const scenario of campagne.scenarios || []) {
      if (!statusFilter.includes(normalizeStatus(scenario.statutSquash))) continue;
      scenarios.push({
        domaine: payload.domaine,
        lot: selectedLot.nomLot,
        idLot: selectedLot.idLot,
        environment: environment.nom,
        campagne: campagne.nomCampagne,
        idScenarioSquash: scenario.idScenarioSquash || '',
        nomScenarioSquash: scenario.nomScenarioSquash || '',
        statutSquash: scenario.statutSquash || '',
        ecole: scenario.ecole || '',
        page: scenario.page || '',
        priorite: scenario.priorite || '',
        tags: Array.isArray(scenario.tags) ? [...scenario.tags] : [],
        expectedPayment: scenario.expectedPayment,
        squashInstructions: scenario.squashInstructions || null,
        testPlanItems: Array.isArray(scenario.testPlanItems) ? scenario.testPlanItems : [],
      });
    }
  }
  return scenarios;
}

module.exports = {
  extractScenarios,
};
