const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

const { projectRoot } = require('./config');

function buildArgs(scenario) {
  if (/runCampaign\.js$/i.test(scenario.scriptPlaywright || '')) {
    const args = ['--campaign', 'tnr-front-recette'];
    if (scenario.schoolSlug) args.push('--schools', scenario.schoolSlug);
    if (scenario.expectedPayment === false) args.push('--no-payment');
    return args;
  }
  return [];
}

function isAutomatedStatus(value) {
  const text = String(value || '');
  return !/^non\b/i.test(text.trim()) && /automatis|automated/i.test(text);
}

function inferExecutionStatus(code, stderr) {
  if (code === 0) return 'OK';
  if (/bloqu|blocked/i.test(stderr || '')) return 'Bloque';
  return 'KO';
}

function readLatestBusinessResult() {
  const resultPath = path.join(projectRoot, 'share', 'reports', 'business', 'latest', 'resultat.json');
  try {
    if (!fs.existsSync(resultPath)) return null;
    return JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  } catch {
    return null;
  }
}

function runOne(scenario, options = {}) {
  return new Promise((resolve) => {
    if (!isAutomatedStatus(scenario.statutAutomatisation)) {
      resolve({
        statutExecution: 'Non automatise',
        erreurTechnique: scenario.mappingError || '',
        derniereEtapeAtteinte: '',
        preuves: {},
      });
      return;
    }

    if (options.dryRun) {
      resolve({
        statutExecution: 'OK',
        erreurTechnique: '',
        derniereEtapeAtteinte: scenario.page || 'Parcours complet',
        dryRun: true,
        preuves: {
          rapportHtml: 'share/reports/business/latest/index.html',
          screenshots: 'share/reports/business/',
          traces: 'share/reports/business/',
        },
      });
      return;
    }

    const scriptPath = path.join(projectRoot, scenario.scriptPlaywright);
    const args = buildArgs(scenario);
    let stderr = '';
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: path.dirname(scriptPath),
      env: process.env,
      shell: false,
    });

    child.stdout.on('data', (chunk) => process.stdout.write(chunk));
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(chunk);
    });

    child.on('close', (code) => {
      const businessResult = readLatestBusinessResult();
      const blockedStep = businessResult?.blockedStep || '';
      const errorMessage = businessResult?.errorMessage || '';
      const executionStatus = businessResult?.success
        ? 'OK'
        : (blockedStep ? 'Bloque' : inferExecutionStatus(code, stderr));

      resolve({
        statutExecution: executionStatus,
        erreurTechnique: errorMessage || (code === 0 ? '' : stderr.slice(0, 2000)),
        derniereEtapeAtteinte: blockedStep || scenario.page || '',
        preuves: {
          rapportHtml: 'share/reports/business/latest/index.html',
          screenshots: 'share/reports/business/',
          traces: 'share/reports/business/',
        },
      });
    });
  });
}

async function runMappedScenarios(scenarios, options = {}) {
  const results = [];
  for (const scenario of scenarios) {
    const execution = await runOne(scenario, options);
    results.push({ ...scenario, ...execution });
  }
  return results;
}

module.exports = {
  runMappedScenarios,
};
