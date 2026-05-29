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

function buildTestRecord(school, run) {
  const status = classifyRunStatus(run);
  const pageStates = buildPageStates(run, status);
  const currentPage = mapCurrentPage(run);
  const primaryProof = run ? (run.primaryArtifact || `${run.runDir || ''}/resume-fonctionnel.html`) : '';
  const resumePath = run?.runDir ? `${run.runDir}/resume-fonctionnel.html` : '';
  const jsonPath = run?.runDir ? `${run.runDir}/resultat.json` : '';

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
  };
}

function buildCampaignPayload(projectRoot = getProjectRoot(), campaignId = 'tnr-front-recette') {
  const campaign = getCampaign(campaignId);
  const businessRoot = getBusinessRoot(projectRoot);
  const latestBySchool = getLatestRunsBySchool(campaign, businessRoot);
  const activeSchools = campaign.schools.filter((school) => school.automationEnabled !== false);
  const skippedSchools = campaign.schools.filter((school) => school.automationEnabled === false);

  const tests = activeSchools.map((school) => buildTestRecord(school, latestBySchool.get(school.slug) || null));
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
  getSchoolSlugsByStatus,
  listRunResults,
  readJsonIfExists,
};
