const { loadConfig, parseArgs } = require('./config');
const { loadSquashData } = require('./squashClient');
const { selectLot } = require('./lotSelector');
const { extractScenarios } = require('./scenarioExtractor');
const { analyzeScenarios } = require('./scenarioAnalyzer');
const { mapScenarios } = require('./testMapper');
const { runMappedScenarios } = require('./runPlaywright');
const { normalizeAnomaly } = require('./anomalyNormalizer');
const { classify } = require('./anomalyDetector');
const { buildReport } = require('./reportBuilder');

function isDryRun(options, config) {
  return Boolean(options.dryRun || options['dry-run'] || String(config.QA_PROCESS_DRY_RUN || '') === '1');
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function filterScenarios(scenarios, options) {
  const campaignFilter = normalizeText(options.campaign || options.campaignName || '');
  const scenarioFilter = normalizeText(options.scenario || options.scenarioId || '');

  return scenarios.filter((scenario) => {
    if (campaignFilter && !normalizeText(scenario.campagne).includes(campaignFilter)) return false;
    if (scenarioFilter) {
      const id = normalizeText(scenario.idScenarioSquash);
      const name = normalizeText(scenario.nomScenarioSquash);
      if (!id.includes(scenarioFilter) && !name.includes(scenarioFilter)) return false;
    }
    return true;
  });
}

async function main() {
  const config = loadConfig();
  const options = parseArgs(process.argv.slice(2));
  const dryRun = isDryRun(options, config);

  console.log('[QA] Chargement Squash ou fallback local...');
  const { source, payload } = await loadSquashData(config, options);

  console.log('[QA] Selection du lot...');
  const selectedLot = selectLot(payload, options, config);
  console.log(`[QA] Lot selectionne: ${selectedLot.nomLot} (${selectedLot.modeSelection})`);
  console.log(`[QA] Environnement: ${selectedLot.environnement}`);

  console.log('[QA] Extraction scenarios...');
  const extracted = extractScenarios(payload, selectedLot, config);
  const filtered = filterScenarios(extracted, options);
  const analyzed = analyzeScenarios(filtered);
  const mapped = mapScenarios(analyzed);

  console.log(`[QA] Scenarios recuperes: ${mapped.length}`);
  if (!mapped.length) {
    console.log('[QA] Aucun scenario a executer pour ce lot/environnement/statut/filtre.');
  }

  console.log(dryRun ? '[QA] Execution en dry-run...' : '[QA] Execution Playwright...');
  const executed = await runMappedScenarios(mapped, { dryRun });

  const enriched = executed.map((scenario) => {
    if (!['KO', 'Bloque'].includes(scenario.statutExecution)) return scenario;
    const normalized = normalizeAnomaly(scenario);
    return {
      ...scenario,
      anomalieNormalisee: normalized,
      suiviAnomalie: classify(normalized, scenario),
    };
  });

  const { reportPath } = buildReport({
    payload,
    selectedLot,
    source,
    scenarios: enriched,
  });

  console.log(`[QA] Rapport genere: ${reportPath}`);
}

main().catch((error) => {
  console.error(`[QA][ERREUR] ${error.message || error}`);
  process.exitCode = 1;
});
