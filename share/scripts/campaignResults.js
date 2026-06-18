const fs = require('fs');
const path = require('path');

const { getCampaign } = require('./campaignConfig');

const PAGE_ORDER = ['page1', 'page2', 'page3', 'page4'];

function getProjectRoot() {
  return path.resolve(__dirname, '..');
}

function getBusinessRoot(projectRoot = getProjectRoot()) {
  return path.join(projectRoot, 'reports', 'business');
}

function getManualScenarioRoot(projectRoot = getProjectRoot()) {
  return path.join(projectRoot, 'data', '.manual-scenarios');
}

function readJsonIfExists(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function listRunResults(businessRoot = getBusinessRoot()) {
  if (!fs.existsSync(businessRoot)) return [];

  return fs.readdirSync(businessRoot)
    .map((name) => path.join(businessRoot, name))
    .filter((fullPath) => {
      try {
        return fs.statSync(fullPath).isDirectory() && path.basename(fullPath).toLowerCase() !== 'latest';
      } catch {
        return false;
      }
    })
    .map((dirPath) => {
      const payload = readJsonIfExists(path.join(dirPath, 'resultat.json'));
      if (!payload) return null;
      return {
        ...payload,
        __dirPath: dirPath,
        __dirName: path.basename(dirPath),
      };
    })
    .filter(Boolean)
    .sort((left, right) => String(right.startedAt || '').localeCompare(String(left.startedAt || '')));
}

function runTimestamp(run) {
  return Date.parse(run?.finishedAt || run?.startedAt || run?.createdAt || '') || Number(run?.__mtimeMs || 0) || 0;
}

function listManualScenarioResults(projectRoot = getProjectRoot()) {
  const manualRoot = getManualScenarioRoot(projectRoot);
  if (!fs.existsSync(manualRoot)) return [];

  return fs.readdirSync(manualRoot)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      const filePath = path.join(manualRoot, name);
      const payload = readJsonIfExists(filePath);
      if (!payload) return null;
      let stat = null;
      try {
        stat = fs.statSync(filePath);
      } catch {
        stat = null;
      }
      return {
        ...payload,
        schoolSlug: payload.scenarioConfig?.schoolSlug || payload.results?.[0]?.schoolSlug || '',
        startedAt: payload.createdAt || payload.startedAt || '',
        finishedAt: payload.finishedAt || '',
        __manualJobFile: filePath,
        __mtimeMs: stat?.mtimeMs || 0,
      };
    })
    .filter(Boolean)
    .sort((left, right) => runTimestamp(right) - runTimestamp(left));
}

function inferLegacySchoolSlug(run) {
  if (run.schoolSlug) return run.schoolSlug;
  if (run.jdd === 'candidat-01.json') return 'bachelorsinseec';
  return '';
}

function getRunSchoolSlug(run) {
  return String(run?.schoolSlug || inferLegacySchoolSlug(run) || '').trim().toLowerCase();
}

function classifyRunStatus(run) {
  if (!run) return 'pending';
  if (run.__manualJobFile) {
    const rowStatus = String(run.results?.[0]?.status || '').toLowerCase();
    if (rowStatus === 'passed' || run.status === 'completed') return 'passed';
    if (rowStatus === 'blocked' || run.status === 'stopped') return 'blocked';
    return 'failed';
  }
  if (run.success) return 'passed';

  const text = `${run.errorMessage || ''} ${run.guidance?.title || ''} ${run.guidance?.detail || ''}`.toLowerCase();

  if (run.paymentStatus === 'refused') return 'failed';
  if (/timeout|timed out|network|net::|dns|econn|ehost|503|502|504|service|environnement|environment|indisponible|unavailable/.test(text)) {
    return 'blocked';
  }
  if (run.blockedStep === 'Accueil' && run.steps?.accueil !== 'ok') {
    return 'blocked';
  }

  return 'failed';
}

function mapCurrentPage(run) {
  if (!run) return 'page1';
  if (run.success) return 'page4';

  if (run.blockedStep === 'Page 1' || run.blockedStep === 'Accueil') return 'page1';
  if (run.blockedStep === 'Page 2') return 'page2';
  if (run.blockedStep === 'Page 3') return 'page3';
  if (run.blockedStep === 'Paiement') return 'page4';

  if (run.steps?.page3 === 'ok') return 'page4';
  if (run.steps?.page2 === 'ok') return 'page3';
  if (run.steps?.page1 === 'ok') return 'page2';
  return 'page1';
}

function buildPageStates(run, status) {
  const states = {
    page1: 'pending',
    page2: 'pending',
    page3: 'pending',
    page4: 'pending',
  };

  if (!run) return states;

  if (run.steps?.page1 === 'ok') states.page1 = 'passed';
  if (run.steps?.page2 === 'ok') states.page2 = 'passed';
  if (run.steps?.page3 === 'ok') states.page3 = 'passed';

  if (run.success) {
    states.page4 = 'passed';
    return states;
  }

  const failingPage = mapCurrentPage(run);
  const tone = status === 'blocked' ? 'blocked' : 'failed';
  states[failingPage] = tone;
  return states;
}

function buildSummary(run, status) {
  if (!run) {
    return 'Aucune execution disponible pour cette ecole dans l historique local.';
  }

  if (status !== 'passed' && run.errorMessage) {
    return String(run.errorMessage).replace(/^Navigation failed:\s*[^|]+\|\s*/i, '').trim();
  }

  if (run.guidance?.detail) {
    return run.guidance.detail;
  }

  if (status === 'passed') {
    return 'Le parcours candidat est termine sans anomalie fonctionnelle detectee.';
  }

  return run.errorMessage || 'Le run doit etre relu par le QA.';
}

function buildSuspectedCause(run, status) {
  if (!run) {
    return 'Scenario non encore execute sur cette ecole.';
  }

  const text = String(run.errorMessage || '').trim();
  if (text) {
    return text.replace(/^Navigation failed:\s*[^|]+\|\s*/i, '').trim();
  }

  if (status === 'blocked') {
    return 'Blocage de recette a confirmer: environnement, donnee, dependance ou indisponibilite de service.';
  }

  if (status === 'failed') {
    return 'Ecart fonctionnel a analyser par le QA avant confirmation du bug.';
  }

  return 'Aucune anomalie constatee.';
}

function buildProofLabel(run) {
  if (!run) return 'Aucune preuve disponible';

  const artifactCount = Array.isArray(run.artifacts) ? run.artifacts.length : 0;
  if (artifactCount > 0) {
    return `${artifactCount} artefact(s) Playwright`;
  }
  return 'Resume fonctionnel';
}

function toApiFileHref(relativePath) {
  if (!relativePath) return '';
  return `/api/file?path=${encodeURIComponent(String(relativePath).replace(/\\/g, '/'))}`;
}

function artifactHref(run, pattern) {
  const artifacts = Array.isArray(run?.artifacts) ? run.artifacts : [];
  const found = artifacts.find((artifact) => pattern.test(String(artifact || '')));
  return found ? toApiFileHref(found) : '';
}

function buildScenarioProofs(run) {
  const artifacts = Array.isArray(run?.artifacts) ? run.artifacts : [];
  return artifacts
    .filter((artifact) => /manual|eudonet|document-replaced|validation-page-2/i.test(String(artifact || '')))
    .slice(0, 12)
    .map((artifact) => ({
      label: /manual-scenario-finished/i.test(artifact)
        ? 'Fin du scenario personnalise'
        : /document-replaced/i.test(artifact)
          ? 'Remplacement de PJ'
          : /eudonet/i.test(artifact)
            ? 'Controle Eudonet'
            : 'Preuve scenario',
      url: toApiFileHref(artifact),
      type: /\.(png|jpg|jpeg|webp)$/i.test(artifact) ? 'image' : 'file',
    }));
}

function buildJddRows(run) {
  const candidate = run?.programChoice?.candidate || {};
  const rows = [
    ['Candidat genere - prenom', candidate.prenom || run?.inputData?.page1?.prenom || ''],
    ['Candidat genere - nom', candidate.nom || run?.inputData?.page1?.nom || ''],
    ['Candidat genere - email', candidate.email || run?.inputData?.page1?.email || ''],
    ['Telephone', candidate.telephone || run?.inputData?.page1?.telephone || ''],
    ['JDD utilise', run?.jddPath || run?.jdd || ''],
  ];
  return rows
    .filter(([, value]) => value)
    .map(([champ, valeur]) => ({ champ, valeur }));
}

function statusToManualScenarioStatus(status) {
  if (status === 'passed') return 'OK';
  if (status === 'blocked') return 'BLOQUE';
  if (status === 'failed') return 'KO';
  return 'NON_LANCE';
}

function normalizeManualStepKey(step) {
  return String(step?.text || step?.actionLabel || step?.action || step?.actionId || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function uniqueManualScenarioSteps(steps = []) {
  const seen = new Set();
  const unique = [];
  for (const step of steps) {
    const key = normalizeManualStepKey(step);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    unique.push(step);
  }
  return unique;
}

function checkpointArtifactUrl(run, checkpoint) {
  const id = String(checkpoint?.id || '').replace(/[^a-z0-9-]+/gi, '.*');
  if (id) {
    const url = artifactHref(run, new RegExp(`eudonet.*${id}`, 'i'));
    if (url) return url;
  }
  return artifactHref(run, /eudonet-manual/i);
}

function buildManualScenarioSummary(run, status) {
  const config = run?.manualScenarioConfig
    || run?.executionPlan?.manualInstructions
    || run?.scenarioConfig?.manualScenario
    || null;
  const plan = run?.scenarioConfig?.understoodPlan || null;
  if (!config && !plan) return null;

  const actions = config?.actions || plan?.actions || {};
  const steps = uniqueManualScenarioSteps(Array.isArray(config?.steps)
    ? config.steps
    : (Array.isArray(plan?.steps) ? plan.steps : []));
  const scenarioStatus = statusToManualScenarioStatus(status);
  const checkpoints = Array.isArray(actions.checkpoints) ? actions.checkpoints : [];
  const issueMessage = run?.results?.[0]?.message || run?.errorMessage || run?.guidance?.detail || run?.blockedStep || '';
  const firstResult = Array.isArray(run?.results) ? run.results[0] : null;
  const eudonetSkipped = /eudonet.+(non lance|ignore|pas lance)/i.test(issueMessage)
    || (firstResult?.newformStatus === 'failed' && (!firstResult?.eudonetStatus || firstResult.eudonetStatus === 'pending'));
  const visibleCheckpoints = eudonetSkipped ? [] : checkpoints;

  return {
    title: config?.title || run?.scenarioConfig?.scenario || run?.executionPlan?.scenarioName || 'Scenario personnalise',
    description: config?.description || config?.rawText || run?.scenarioConfig?.customScenario || '',
    dataToUse: config?.dataToUse || '',
    comment: config?.comment || '',
    status: scenarioStatus,
    businessConclusion: scenarioStatus === 'OK'
      ? 'Scenario personnalise termine avec succes. Les actions demandees ont ete interpretees et les preuves sont disponibles.'
      : (issueMessage || 'Scenario personnalise termine avec anomalie.'),
    actionFlags: Object.fromEntries(
      Object.entries(actions).filter(([key, value]) => key !== 'checkpoints' && value === true)
    ),
    steps: steps.map((step, index) => ({
      order: step.order || index + 1,
      text: step.text || step.actionLabel || '-',
      actionId: step.actionId || step.action || '',
      actionLabel: step.actionLabel || step.action || step.actionId || '',
      status: step.supported === false ? 'non supportee' : 'supportee',
    })),
    eudonetCheckpoints: visibleCheckpoints.map((checkpoint) => ({
      id: checkpoint.id || '',
      label: checkpoint.label || 'Controle Eudonet du scenario',
      status: scenarioStatus === 'OK' ? 'OK' : scenarioStatus,
      candidate: run?.programChoice?.candidate?.email || run?.candidateId || '',
      issueCount: scenarioStatus === 'OK' ? 0 : 1,
      url: checkpointArtifactUrl(run, checkpoint),
    })),
    pointsToTreat: scenarioStatus === 'OK' ? [] : [{
      label: run?.blockedStep || 'Point a traiter',
      checkpoint: eudonetSkipped ? 'NewForm' : (checkpoints[0]?.label || 'Scenario personnalise'),
      detail: issueMessage || 'Relire le rapport de scenario personnalise.',
      status: scenarioStatus,
    }],
    replacementProofUrl: artifactHref(run, /document-replaced/i),
    finishedProofUrl: artifactHref(run, /manual-scenario-finished/i),
  };
}

function getLatestRunsBySchool(campaign, businessRoot = getBusinessRoot()) {
  const results = listRunResults(businessRoot);
  const latestBySchool = new Map();
  const activeSchools = campaign.schools.filter((school) => school.automationEnabled !== false);

  for (const run of results) {
    const schoolSlug = getRunSchoolSlug(run);
    if (!schoolSlug) continue;
    if (!activeSchools.some((school) => school.slug === schoolSlug)) continue;
    if (!latestBySchool.has(schoolSlug)) {
      latestBySchool.set(schoolSlug, run);
    }
  }

  return latestBySchool;
}

function hasManualScenarioRun(run) {
  return Boolean(run?.manualScenarioConfig || run?.executionPlan?.manualInstructions || run?.scenarioConfig?.manualScenario);
}

function getLatestManualScenarioRunsBySchool(campaign, businessRoot = getBusinessRoot()) {
  const results = listRunResults(businessRoot);
  const latestBySchool = new Map();
  const activeSchools = campaign.schools.filter((school) => school.automationEnabled !== false);

  for (const run of results) {
    if (!hasManualScenarioRun(run)) continue;
    const schoolSlug = getRunSchoolSlug(run);
    if (!schoolSlug) continue;
    if (!activeSchools.some((school) => school.slug === schoolSlug)) continue;
    if (!latestBySchool.has(schoolSlug)) {
      latestBySchool.set(schoolSlug, run);
    }
  }

  return latestBySchool;
}

function getLatestManualScenarioJobsBySchool(campaign, projectRoot = getProjectRoot()) {
  const results = listManualScenarioResults(projectRoot);
  const latestBySchool = new Map();
  const activeSchools = campaign.schools.filter((school) => school.automationEnabled !== false);

  for (const run of results) {
    if (!hasManualScenarioRun(run)) continue;
    const schoolSlug = getRunSchoolSlug(run);
    if (!schoolSlug) continue;
    if (!activeSchools.some((school) => school.slug === schoolSlug)) continue;
    if (!latestBySchool.has(schoolSlug)) {
      latestBySchool.set(schoolSlug, run);
    }
  }

  return latestBySchool;
}

function buildTestRecord(school, run, manualRun = null) {
  const status = classifyRunStatus(run);
  const pageStates = buildPageStates(run, status);
  const currentPage = mapCurrentPage(run);
  const primaryProof = run ? (run.primaryArtifact || `${run.runDir || ''}/resume-fonctionnel.html`) : '';
  const resumePath = run?.runDir ? `${run.runDir}/resume-fonctionnel.html` : '';
  const jsonPath = run?.runDir ? `${run.runDir}/resultat.json` : '';
  const scenarioRun = hasManualScenarioRun(run)
    ? run
    : (manualRun && (!run || runTimestamp(manualRun) >= runTimestamp(run)) ? manualRun : null);
  const manualScenario = buildManualScenarioSummary(scenarioRun, classifyRunStatus(scenarioRun));

  return {
    id: school.slug,
    school: school.label,
    schoolSlug: school.slug,
    schoolUrl: school.url,
    journeyGroup: school.journeyGroup || '',
    scenario: 'Parcours candidat standard',
    status,
    currentPage,
    durationSec: run?.durationSeconds ? Math.round(run.durationSeconds) : 0,
    candidateRef: run?.candidateId || school.slug,
    candidateEmail: run?.programChoice?.candidate?.email || run?.inputData?.page1?.email || '',
    summary: buildSummary(run, status),
    suspectedCause: buildSuspectedCause(run, status),
    proofLabel: buildProofLabel(run),
    jiraKey: '',
    owner: 'QA front',
    pageStates,
    proofUrl: toApiFileHref(primaryProof),
    resumeUrl: toApiFileHref(resumePath),
    jsonUrl: toApiFileHref(jsonPath),
    executedAt: run?.startedAt || '',
    executedAtHuman: run?.startedAtHuman || '',
    attachmentsLabel: run?.attachmentsLabel || '',
    blockedStep: run?.blockedStep || '',
    paymentStatus: run?.paymentStatus || 'unknown',
    notes: run?.guidance?.action || '',
    manualScenario,
    manualScenarioConfig: scenarioRun?.manualScenarioConfig || scenarioRun?.scenarioConfig?.manualScenario || null,
    executionPlan: scenarioRun?.executionPlan || null,
    proofs: buildScenarioProofs(scenarioRun),
    jddData: { rows: buildJddRows(run) },
  };
}

function buildCampaignPayload(projectRoot = getProjectRoot(), campaignId = 'tnr-front-recette') {
  const campaign = getCampaign(campaignId);
  const businessRoot = getBusinessRoot(projectRoot);
  const latestBySchool = getLatestRunsBySchool(campaign, businessRoot);
  const latestManualFromReports = getLatestManualScenarioRunsBySchool(campaign, businessRoot);
  const latestManualFromJobs = getLatestManualScenarioJobsBySchool(campaign, projectRoot);
  const latestManualBySchool = new Map(latestManualFromReports);
  for (const [schoolSlug, manualJob] of latestManualFromJobs.entries()) {
    const current = latestManualBySchool.get(schoolSlug);
    if (!current || runTimestamp(manualJob) >= runTimestamp(current)) {
      latestManualBySchool.set(schoolSlug, manualJob);
    }
  }
  const activeSchools = campaign.schools.filter((school) => school.automationEnabled !== false);
  const skippedSchools = campaign.schools.filter((school) => school.automationEnabled === false);

  const tests = activeSchools.map((school) => buildTestRecord(
    school,
    latestBySchool.get(school.slug) || null,
    latestManualBySchool.get(school.slug) || null
  ));
  const latestExecutedAt = tests
    .map((test) => test.executedAt)
    .filter(Boolean)
    .sort((left, right) => String(right).localeCompare(String(left)))[0] || '';

  const configuredCount = activeSchools.length;
  // "Missing schools" should mean "missing from scope definition" (not "skipped from automation"),
  // otherwise we double-count skipped schools in the note.
  const definedCount = activeSchools.length + skippedSchools.length;
  const expectedCount = Number(campaign.expectedSchoolCount || definedCount);
  const missingCount = Math.max(0, expectedCount - definedCount);
  const skipNote = skippedSchools.length
    ? `${skippedSchools.length} ecole(s) laissee(s) de cote temporairement: ${skippedSchools.map((school) => school.label).join(', ')}.`
    : '';
  const missingNote = missingCount ? `${missingCount} ecole(s) manquante(s) dans la liste source pour atteindre le perimetre de 14.` : '';
  const scopeNote = [skipNote, missingNote].filter(Boolean).join(' ');

  return {
    id: campaign.id,
    title: campaign.title,
    environment: campaign.environment,
    browser: campaign.browser,
    tool: campaign.tool,
    scope: `${configuredCount} ecole(s) configuree(s)`,
    scopeNote,
    executedAt: latestExecutedAt || new Date().toISOString(),
    tests,
  };
}

function getSchoolSlugsByStatus(projectRoot, campaignId, status) {
  const payload = buildCampaignPayload(projectRoot, campaignId);
  return payload.tests.filter((test) => test.status === status).map((test) => test.schoolSlug);
}

module.exports = {
  buildCampaignPayload,
  getBusinessRoot,
  getLatestRunsBySchool,
  getLatestManualScenarioJobsBySchool,
  getLatestManualScenarioRunsBySchool,
  getSchoolSlugsByStatus,
  listRunResults,
  readJsonIfExists,
};
