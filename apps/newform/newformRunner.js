const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const { projectRoot } = require('../../agent/config');
const { getCampaign, findSchool } = require('../../share/scripts/campaignConfig');
const { resolveSchoolProfile } = require('../../share/scripts/formProfiles');

const shareRoot = path.join(projectRoot, 'share');
const tempRoot = path.join(shareRoot, 'data', '.squash-jdd');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function writeJson(filePath, payload) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(target, source) {
  if (!isPlainObject(target) || !isPlainObject(source)) return source;
  const merged = { ...target };
  for (const [key, value] of Object.entries(source)) {
    merged[key] = isPlainObject(value) && isPlainObject(merged[key])
      ? deepMerge(merged[key], value)
      : value;
  }
  return merged;
}

function nowStamp(date = new Date()) {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

function buildNameSuffixToken(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(-10);
  return digits
    .split('')
    .map((digit) => String.fromCharCode(65 + Number(digit)))
    .join('');
}

function loadBusinessResult() {
  const resultPath = path.join(shareRoot, 'reports', 'business', 'latest', 'resultat.json');
  try {
    if (!fs.existsSync(resultPath)) return null;
    return readJson(resultPath);
  } catch {
    return null;
  }
}

function buildJdd(executionPlan) {
  const campaign = getCampaign('tnr-front-recette');
  const school = findSchool(campaign.id, executionPlan.target.schoolSlug);
  if (!school) {
    throw new Error(`Ecole NewForm non reconnue: ${executionPlan.target.schoolSlug || executionPlan.target.schoolLabel}`);
  }

  const baseName = school.baseJdd || 'candidat-01.json';
  const basePath = path.join(shareRoot, 'data', 'jdd', baseName);
  const basePayload = readJson(basePath);
  const profile = resolveSchoolProfile(school);
  const merged = school.jddOverrides ? deepMerge(basePayload, school.jddOverrides) : { ...basePayload };
  if (executionPlan.target.page1) {
    merged.page1 = deepMerge(merged.page1 || {}, executionPlan.target.page1);
  }
  merged.generation = {
    ...(merged.generation || {}),
    age: Number(executionPlan.target.candidateAge || 20),
  };
  const id = `${basePayload.id || 'candidat-01'}-${school.slug}-squash-${executionPlan.scenarioId}`;

  merged.id = id;
  merged.url = school.url;
  merged.school = {
    slug: school.slug,
    label: school.label,
    url: school.url,
    profileId: profile.id,
    journeyGroup: school.journeyGroup || profile.journeyGroup || '',
    structureGroup: school.structureGroup || profile.structureGroup || '',
    page1SelectionMode: school.page1SelectionMode || 'strict-jdd',
    paymentMode: profile.paymentMode || 'paytweak-card',
    startConfig: executionPlan.target.startConfig || school.startConfig || null,
  };
  merged.campaign = {
    id: campaign.id,
    title: campaign.title,
    environment: campaign.environment,
    browser: campaign.browser,
    tool: campaign.tool,
  };
  merged.squash = {
    scenarioId: executionPlan.scenarioId,
    scenarioName: executionPlan.scenarioName,
    campaignName: executionPlan.campaignName,
    candidateType: executionPlan.target.candidateType,
    expectedPayment: executionPlan.target.expectedPayment,
  };

  return { school, payload: merged };
}

function runCommand(scriptPath, args, env) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: shareRoot,
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

async function runNewform(executionPlan, options = {}) {
  const { payload } = buildJdd(executionPlan);
  const jddPath = path.join(tempRoot, `${payload.id}.json`);
  const contextPath = options.contextPath
    || path.join(projectRoot, 'authentification', 'process', payload.id, 'candidate-context.json');
  writeJson(jddPath, payload);

  if (options.dryRun) {
    return {
      application: 'newform',
      status: 'OK',
      dryRun: true,
      lastStep: 'dry-run',
      error: '',
      evidence: { jddPath: path.relative(projectRoot, jddPath).replace(/\\/g, '/') },
    };
  }

  const scriptPath = path.join(shareRoot, 'scripts', 'runBusiness.js');
  const args = ['--jdd-path', jddPath];
  if (executionPlan.target.expectedPayment === false) args.push('--no-payment');

  const env = {
    ...process.env,
    CAMPAIGN_RUN_STAMP: nowStamp(),
    SQUASH_SCENARIO_ID: executionPlan.scenarioId,
    SQUASH_CANDIDATE_TYPE: executionPlan.target.candidateType,
    STOP_AFTER_PAGE: String(executionPlan.target.stopAfterPage || ''),
    CANDIDATE_CONTEXT_PATH: contextPath,
    PW_CHANNEL: process.env.PW_CHANNEL || 'chrome',
    NAME_SUFFIX_TOKEN: buildNameSuffixToken(executionPlan.scenarioId),
  };

  const execution = await runCommand(scriptPath, args, env);
  const result = loadBusinessResult();
  const status = result?.success ? 'OK' : (result?.blockedStep ? 'Bloque' : 'KO');
  const candidateContext = fs.existsSync(contextPath) ? readJson(contextPath) : null;

  return {
    application: 'newform',
    status,
    exitCode: execution.exitCode,
    lastStep: result?.blockedStep || (result?.success ? 'Termine' : ''),
    error: result?.errorMessage || execution.stderr.slice(0, 2000),
    evidence: {
      resultPath: 'share/reports/business/latest/resultat.json',
      reportHtml: 'share/reports/business/latest/resume-fonctionnel.html',
      primaryArtifact: result?.primaryArtifact || '',
      runDir: result?.runDir || '',
      jddPath: path.relative(projectRoot, jddPath).replace(/\\/g, '/'),
      contextPath: path.relative(projectRoot, contextPath).replace(/\\/g, '/'),
    },
    businessResult: result,
    candidateContext,
  };
}

module.exports = {
  runNewform,
};
