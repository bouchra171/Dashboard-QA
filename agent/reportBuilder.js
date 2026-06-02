const fs = require('fs');
const path = require('path');

const { projectRoot } = require('./config');

function countWhere(items, predicate) {
  return items.filter(predicate).length;
}

function isAutomatedStatus(value) {
  const text = String(value || '');
  return !/^non\b/i.test(text.trim()) && /automatis|automated/i.test(text);
}

function isBlockedStatus(value) {
  return /bloqu|blocked/i.test(String(value || ''));
}

function buildFunctionalSummary(scenario) {
  if (scenario.statutExecution === 'OK') {
    return `Scenario execute avec succes pour ${scenario.ecole}.`;
  }
  if (!isAutomatedStatus(scenario.statutAutomatisation)) {
    return `Scenario Squash identifie mais aucun script automatise n'est disponible pour ${scenario.ecole}.`;
  }
  if (isBlockedStatus(scenario.statutExecution)) {
    return `Scenario bloque sur ${scenario.derniereEtapeAtteinte || scenario.page || 'une etape non determinee'}.`;
  }
  return `Scenario en echec sur ${scenario.derniereEtapeAtteinte || scenario.page || 'une etape non determinee'}.`;
}

function formatScenario(scenario) {
  const matched = scenario.suiviAnomalie?.anomalieRapprochee || {};
  return {
    domaine: scenario.domaine,
    lot: scenario.lot,
    environment: scenario.environment,
    campagne: scenario.campagne,
    idScenarioSquash: scenario.idScenarioSquash,
    nomScenarioSquash: scenario.nomScenarioSquash,
    statutSquash: scenario.statutSquash,
    ecole: scenario.ecole,
    page: scenario.page,
    priorite: scenario.priorite,
    expectedPayment: scenario.expectedPayment,
    squashInstructions: scenario.squashInstructions || null,
    scriptPlaywright: scenario.scriptPlaywright || '',
    statutAutomatisation: scenario.statutAutomatisation,
    statutExecution: scenario.statutExecution,
    derniereEtapeAtteinte: scenario.derniereEtapeAtteinte || '',
    resumeFonctionnel: buildFunctionalSummary(scenario),
    preuves: scenario.preuves || {},
    suiviAnomalie: scenario.suiviAnomalie ? {
      classification: scenario.suiviAnomalie.classification,
      idAnomalieProche: matched.idAnomalie || '',
      titreAnomalieProche: matched.titre || '',
      scoreSimilarite: scenario.suiviAnomalie.score || 0,
      raisons: scenario.suiviAnomalie.raisons || [],
    } : {
      classification: '',
      idAnomalieProche: '',
      titreAnomalieProche: '',
      scoreSimilarite: 0,
      raisons: [],
    },
  };
}

function buildReport({ payload, selectedLot, source, scenarios }) {
  const formatted = scenarios.map(formatScenario);
  const report = {
    domaine: payload.domaine,
    lotSelectionMode: selectedLot.modeSelection,
    lot: selectedLot.nomLot,
    idLot: selectedLot.idLot,
    environment: selectedLot.environnement,
    source,
    dateExecution: new Date().toISOString(),
    resumeGlobal: {
      totalScenarios: formatted.length,
      automatises: countWhere(formatted, (item) => isAutomatedStatus(item.statutAutomatisation)),
      nonAutomatises: countWhere(formatted, (item) => !isAutomatedStatus(item.statutAutomatisation)),
      ok: countWhere(formatted, (item) => item.statutExecution === 'OK'),
      ko: countWhere(formatted, (item) => item.statutExecution === 'KO'),
      bloques: countWhere(formatted, (item) => isBlockedStatus(item.statutExecution)),
      suspicionRegression: countWhere(formatted, (item) => item.suiviAnomalie.classification === 'Suspicion de regression'),
      nouvellesAnomalies: countWhere(formatted, (item) => item.suiviAnomalie.classification === 'Nouvelle anomalie'),
    },
    ecolesCiblees: [...new Set(formatted.map((item) => item.ecole).filter(Boolean))],
    scenarios: formatted,
  };

  const reportsDir = path.join(projectRoot, 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });
  const reportPath = path.join(reportsDir, 'qa-execution-summary.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  return { report, reportPath };
}

module.exports = {
  buildReport,
};
