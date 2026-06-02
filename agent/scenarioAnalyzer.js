function addTag(tags, tag) {
  return tags.includes(tag) ? tags : [...tags, tag];
}

function analyzeScenario(scenario) {
  const name = String(scenario.nomScenarioSquash || '').toLowerCase();
  const analyzed = {
    ...scenario,
    page: scenario.page || 'Parcours complet',
    priorite: scenario.priorite || 'Moyenne',
    tags: Array.isArray(scenario.tags) ? [...scenario.tags] : [],
  };

  if (/paiement|cb|mercanet|paytweak/.test(name)) {
    analyzed.page = 'Page 4 - Paiement';
    analyzed.priorite = 'Haute';
    analyzed.tags = addTag(analyzed.tags, 'paiement');
  }

  if (/pi[eè]ce jointe|document|upload|\bpj\b/.test(name)) {
    analyzed.page = 'Page 2 - Documents';
    analyzed.tags = addTag(analyzed.tags, 'documents');
  }

  if (/r[eé]capitulatif|recap/.test(name)) {
    analyzed.page = 'Page 3 - Récapitulatif';
    analyzed.tags = addTag(analyzed.tags, 'recapitulatif');
  }

  if (!analyzed.page) analyzed.page = 'Parcours complet';
  return analyzed;
}

function analyzeScenarios(scenarios) {
  return scenarios.map(analyzeScenario);
}

module.exports = {
  analyzeScenario,
  analyzeScenarios,
};
