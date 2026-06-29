const fs = require('fs');
const path = require('path');

const { loadConfig, parseArgs, projectRoot } = require('./config');
const { loadSquashData } = require('./squashClient');
const { selectLot } = require('./lotSelector');
const { extractScenarios } = require('./scenarioExtractor');
const { interpretScenario, normalizeText } = require('./scenarioInterpreter');
const { runNewform } = require('../apps/newform/newformRunner');
const { runEudonet } = require('../apps/eudonet/eudonetRunner');
const { runIris } = require('../apps/iris/irisRunner');
const { runYpareo } = require('../apps/ypareo/ypareoRunner');
const { runAgate } = require('../apps/agate/agateRunner');

const RUNNERS = {
  newform: runNewform,
  eudonet: runEudonet,
  iris: runIris,
  ypareo: runYpareo,
};

function isDryRun(options, config) {
  return Boolean(options.dryRun || options['dry-run'] || String(config.QA_PROCESS_DRY_RUN || '') === '1');
}

function filterScenarios(scenarios, options) {
  const campaignFilter = normalizeText(options.campaign || options.campaignName || options.campagne || '');
  const scenarioFilter = normalizeText(options.scenario || options.scenarioId || '');

  return scenarios.filter((scenario) => {
    if (campaignFilter && !normalizeText(scenario.campagne).includes(campaignFilter)) return false;
    if (scenarioFilter) {
      const text = normalizeText(`${scenario.idScenarioSquash} ${scenario.nomScenarioSquash}`);
      if (!text.includes(scenarioFilter)) return false;
    }
    return true;
  });
}

function listAvailableCampaigns(scenarios) {
  return [...new Set(scenarios.map((scenario) => scenario.campagne).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'fr'));
}

function aggregateStatus(results) {
  if (results.some((result) => result.status === 'KO')) return 'KO';
  if (results.some((result) => result.status === 'Bloque')) return 'Bloque';
  if (results.every((result) => result.status === 'OK')) return 'OK';
  return 'Bloque';
}

async function runExecutionPlan(executionPlan, options) {
  const appResults = [];
  for (const appName of executionPlan.target.apps) {
    const runner = RUNNERS[appName];
    if (!runner) {
      appResults.push({
        application: appName,
        status: 'Bloque',
        lastStep: 'Runner introuvable',
        error: `Aucun runner declare pour ${appName}.`,
        evidence: {},
      });
      continue;
    }

    const result = await runner(executionPlan, options);
    appResults.push(result);
    if (result.status !== 'OK') break;
  }

  return {
    ...executionPlan,
    status: aggregateStatus(appResults),
    appResults,
  };
}

function buildReport({ source, selectedLot, scenarios, executions }) {
  const report = {
    source,
    dateExecution: new Date().toISOString(),
    lot: selectedLot.nomLot,
    idLot: selectedLot.idLot,
    environment: selectedLot.environnement,
    resumeGlobal: {
      totalScenarios: executions.length,
      ok: executions.filter((item) => item.status === 'OK').length,
      ko: executions.filter((item) => item.status === 'KO').length,
      bloques: executions.filter((item) => item.status === 'Bloque').length,
    },
    scenariosLus: scenarios.map((scenario) => ({
      idScenarioSquash: scenario.idScenarioSquash,
      nomScenarioSquash: scenario.nomScenarioSquash,
      campagne: scenario.campagne,
      ecole: scenario.ecole,
      statutSquash: scenario.statutSquash,
      squashInstructions: scenario.squashInstructions || null,
    })),
    executions: executions.map((execution) => ({
      scenarioSquash: {
        id: execution.scenarioId,
        name: execution.scenarioName,
        campaign: execution.campaignName,
        sourceStatus: execution.sourceStatus,
      },
      interpretation: execution.target,
      status: execution.status,
      appResults: execution.appResults,
      squashInstructions: execution.squashInstructions,
    })),
  };

  const reportsDir = path.join(projectRoot, 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });
  const reportPath = path.join(reportsDir, 'squash-orchestration-summary.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(path.join(reportsDir, 'qa-execution-summary.json'), JSON.stringify(report, null, 2), 'utf8');
  return { report, reportPath };
}

async function main() {
  const config = loadConfig();
  const options = parseArgs(process.argv.slice(2));
  const dryRun = isDryRun(options, config);

  console.log('[ORCH] Lecture Squash...');
  const { source, payload } = await loadSquashData(config, options);
  const selectedLot = selectLot(payload, options, config);
  console.log(`[ORCH] Lot: ${selectedLot.nomLot}`);
  console.log(`[ORCH] Environnement: ${selectedLot.environnement}`);

  const extracted = extractScenarios(payload, selectedLot, config);
  const scenarios = filterScenarios(extracted, options);
  console.log(`[ORCH] Scenarios Squash retenus: ${scenarios.length}`);
  if (!scenarios.length) {
    const campaignFilter = options.campaign || options.campaignName || options.campagne || '';
    const availableCampaigns = listAvailableCampaigns(extracted);
    const availableText = availableCampaigns.length ? availableCampaigns.join(', ') : 'aucune campagne exploitable';
    throw new Error(`Aucun scenario Squash retenu${campaignFilter ? ` pour la campagne "${campaignFilter}"` : ''}. Campagnes lues: ${availableText}`);
  }

  const executions = [];
  for (const scenario of scenarios) {
    const executionPlan = interpretScenario(scenario);
    console.log(`[ORCH] Scenario ${executionPlan.scenarioId} -> ${executionPlan.target.application}/${executionPlan.target.schoolSlug || 'ecole inconnue'} (${executionPlan.target.candidateType})`);
    executions.push(await runExecutionPlan(executionPlan, { dryRun }));
  }

  const { reportPath } = buildReport({ source, selectedLot, scenarios, executions });
  console.log(`[ORCH] Rapport genere: ${reportPath}`);
}

main().catch((error) => {
  console.error(`[ORCH][ERREUR] ${error.message || error}`);
  process.exitCode = 1;
});
