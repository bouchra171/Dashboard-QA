const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const { projectRoot } = require('../../agent/config');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function runCommand(scriptPath, args) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: projectRoot,
      env: process.env,
      shell: false,
    });
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      process.stderr.write(chunk);
    });
    child.on('close', (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}

async function runEudonet(executionPlan, options = {}) {
  const contextPath = options.contextPath;
  if (!contextPath) {
    return {
      application: 'eudonet',
      status: 'Bloque',
      lastStep: 'Contexte candidat absent',
      error: 'Le runner Eudonet exige options.contextPath.',
      evidence: {},
    };
  }

  const scriptPath = path.join(projectRoot, 'share', 'scripts', 'updateEudonetCandidature.js');
  const args = [
    '--context', contextPath,
    '--initial-statut', executionPlan.target.eudonet.initialStatut,
    '--initial-etape', executionPlan.target.eudonet.initialEtape,
    '--target-statut', executionPlan.target.eudonet.targetStatut,
    '--target-etape', executionPlan.target.eudonet.targetEtape,
  ];
  const execution = await runCommand(scriptPath, args);
  const resultPath = path.join(path.dirname(contextPath), 'eudonet-result.json');
  const result = fs.existsSync(resultPath) ? readJson(resultPath) : null;

  return {
    application: 'eudonet',
    status: result?.success ? 'OK' : 'KO',
    exitCode: execution.exitCode,
    lastStep: result?.success ? 'Candidature mise a jour' : 'Mise a jour Candidature',
    error: result?.error || execution.stderr.slice(0, 2000),
    evidence: {
      resultPath: path.relative(projectRoot, resultPath).replace(/\\/g, '/'),
      screenshotPath: result?.screenshotPath
        ? path.relative(projectRoot, result.screenshotPath).replace(/\\/g, '/')
        : '',
      logPath: result?.logPath
        ? path.relative(projectRoot, result.logPath).replace(/\\/g, '/')
        : '',
    },
    eudonetResult: result,
  };
}

module.exports = {
  runEudonet,
};
