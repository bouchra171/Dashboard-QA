const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const { projectRoot } = require('../../agent/config');
const { prepareEudonetForAgate } = require('./eudonetPreparationRunner');

const agateSearchScriptPath = path.join(projectRoot, 'share', 'scripts', 'searchAgateCandidate.js');
const defaultCandidatePath = path.join(projectRoot, 'authentification', 'eudonet-contact-data-used.json');
const agateReportPath = path.join(projectRoot, 'authentification', 'agate-search-report.json');

function runCommand(scriptPath, args = [], env = process.env) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: projectRoot,
      env,
      shell: false,
    });

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(chunk);
    });
    child.on('close', (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}

function readJsonIfExists(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

function mapAgateStatus(report, execution) {
  if (report?.status === 'found') return 'OK';
  if (report?.status === 'not-found') return 'Bloque';
  if (execution.exitCode !== 0) return 'KO';
  return 'Bloque';
}

async function runAgate(executionPlan = {}, options = {}) {
  const shouldPrepareEudonet = Boolean(
    options.prepareEudonet
    || executionPlan.prepareEudonet
    || executionPlan.target?.prepareEudonet
  );

  let eudonetPreparation = null;
  if (shouldPrepareEudonet) {
    eudonetPreparation = await prepareEudonetForAgate(options.eudonet || {});
    if (eudonetPreparation.status !== 'OK') {
      return {
        application: 'agate',
        status: 'Bloque',
        lastStep: 'preparation-eudonet',
        error: eudonetPreparation.error || 'Preparation Eudonet impossible.',
        eudonetPreparation,
        evidence: eudonetPreparation.evidence || {},
      };
    }
  }

  const candidatePath = options.candidatePath
    || executionPlan.target?.candidatePath
    || defaultCandidatePath;
  const searchArgs = ['--candidate', candidatePath];
  if (options.headless) searchArgs.push('--headless');
  if (options.keepOpenMs !== undefined) searchArgs.push('--keep-open-ms', String(options.keepOpenMs));

  const execution = await runCommand(agateSearchScriptPath, searchArgs, process.env);
  const report = readJsonIfExists(agateReportPath);
  const status = mapAgateStatus(report, execution);

  return {
    application: 'agate',
    status,
    exitCode: execution.exitCode,
    lastStep: report?.status === 'found' ? 'dossier-trouve' : 'recherche-dossier',
    error: report?.blockingReason || execution.stderr.slice(0, 2000),
    eudonetPreparation,
    candidate: report?.candidate || readJsonIfExists(candidatePath),
    evidence: {
      report: 'authentification/agate-search-report.json',
      screenshot: 'authentification/agate-search-candidate.png',
      candidateData: path.relative(projectRoot, candidatePath).replace(/\\/g, '/'),
    },
    agateReport: report,
  };
}

module.exports = {
  runAgate,
};
