const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const { getCampaign, findSchool, findSchoolsByStructureGroup } = require('./campaignConfig');
const { resolveSchoolProfile } = require('./formProfiles');

const projectRoot = path.resolve(__dirname, '..');
const reportsRoot = path.join(projectRoot, 'reports');
const businessRoot = path.join(reportsRoot, 'business');
const jddRoot = path.join(projectRoot, 'data', 'jdd');
const tempJddRoot = path.join(projectRoot, 'data', '.campaign-jdd');
const executionLockPath = path.join(projectRoot, 'data', '.campaign-execution-lock.json');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(raw);
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(target, source) {
  if (!isPlainObject(target) || !isPlainObject(source)) {
    return source;
  }

  const merged = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (isPlainObject(value) && isPlainObject(merged[key])) {
      merged[key] = deepMerge(merged[key], value);
    } else {
      merged[key] = value;
    }
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

function sanitizeName(value) {
  return String(value || '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function relativeToProject(absPath) {
  return path.relative(projectRoot, absPath).replace(/\\/g, '/');
}

function getFunctionalSchoolStatus(summary, exitCode) {
  if (summary?.success) {
    return 'PASSÉ';
  }

  if (summary?.blockedStep && summary.blockedStep !== 'Paiement') {
    return 'BLOQUÉ';
  }

  if (summary?.paymentStatus === 'refused') {
    return 'KO';
  }

  if (summary?.blockedStep === 'Paiement') {
    return 'KO';
  }

  if (exitCode !== 0) {
    return 'KO';
  }

  return 'PASSÉ';
}

function getFunctionalMotif(summary) {
  if (!summary) {
    return '';
  }

  if (summary.success) {
    return 'Succès';
  }

  if (summary.blockedStep && summary.blockedStep !== 'Paiement') {
    return summary.errorMessage
      ? `Bloqué à ${summary.blockedStep} : ${summary.errorMessage}`
      : `Bloqué à ${summary.blockedStep}`;
  }

  if (summary.paymentStatus === 'refused') {
    return summary.errorMessage ? `Paiement refusé : ${summary.errorMessage}` : 'Paiement refusé';
  }

  if (summary.blockedStep === 'Paiement') {
    return summary.errorMessage
      ? `Échec paiement : ${summary.errorMessage}`
      : 'Échec paiement';
  }

  if (summary.errorMessage) {
    return summary.errorMessage;
  }

  return 'Échec inconnu';
}

function isPidRunning(pid) {
  const numericPid = Number(pid);
  if (!numericPid) return false;
  try {
    process.kill(numericPid, 0);
    return true;
  } catch {
    return false;
  }
}

function releaseExecutionLock() {
  try {
    if (!fs.existsSync(executionLockPath)) return;
    const current = readJson(executionLockPath);
    if (Number(current?.pid) === process.pid) {
      fs.rmSync(executionLockPath, { force: true });
    }
  } catch {
    // ignore lock cleanup failure
  }
}

function acquireExecutionLock(campaign, schools, options) {
  ensureDir(path.dirname(executionLockPath));

  if (fs.existsSync(executionLockPath)) {
    try {
      const current = readJson(executionLockPath);
      if (current && isPidRunning(current.pid)) {
        const labels = Array.isArray(current.schools) ? current.schools.join(', ') : 'inconnues';
        throw new Error(
          `Une execution est deja en cours sur ce poste (PID ${current.pid}) pour ${labels}. Attends la fin avant de relancer.`
        );
      }
      fs.rmSync(executionLockPath, { force: true });
    } catch (error) {
      if (/Une execution est deja en cours/.test(String(error?.message || error))) {
        throw error;
      }
      try {
        fs.rmSync(executionLockPath, { force: true });
      } catch {
        // ignore
      }
    }
  }

  writeJson(executionLockPath, {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    campaignId: campaign.id,
    autoPayment: Boolean(options.autoPayment),
    schools: schools.map((school) => school.slug),
  });
}

function parseArgs(argv) {
  const result = {
    campaignId: 'tnr-front-recette',
    baseJdd: 'candidat-01.json',
    schools: [],
    structureGroup: '',
    autoPayment: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--campaign' && argv[index + 1]) {
      result.campaignId = argv[index + 1];
      index += 1;
    } else if (token === '--base-jdd' && argv[index + 1]) {
      result.baseJdd = argv[index + 1];
      index += 1;
    } else if (token === '--schools' && argv[index + 1]) {
      result.schools = String(argv[index + 1])
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean);
      index += 1;
    } else if (token === '--structure-group' && argv[index + 1]) {
      result.structureGroup = String(argv[index + 1]).trim().toLowerCase();
      index += 1;
    } else if (token === '--no-payment') {
      result.autoPayment = false;
    }
  }

  return result;
}

function resolveSchools(campaign, requestedSlugs, structureGroup) {
  if (structureGroup) {
    return findSchoolsByStructureGroup(campaign.id, structureGroup)
      .filter((school) => school.automationEnabled !== false);
  }

  if (!requestedSlugs.length) {
    return campaign.schools.filter((school) => school.automationEnabled !== false);
  }

  const schools = [];
  for (const requestedSlug of requestedSlugs) {
    const school = findSchool(campaign.id, requestedSlug);
    if (school) {
      if (school.automationEnabled === false) {
        console.warn(`[WARNING] Ecole laissee de cote pour l'instant: ${school.label} (${school.skipReason || 'variante non traitee'})`);
      } else {
        schools.push(school);
      }
    } else {
      console.warn(`[WARNING] Ecole non reconnue dans la campagne: ${requestedSlug}`);
    }
  }
  return schools;
}

function buildCampaignJdd(basePayload, campaign, school) {
  const cloned = JSON.parse(JSON.stringify(basePayload));
  const payload = school.jddOverrides ? deepMerge(cloned, school.jddOverrides) : cloned;
  const sourceId = cloned.id || 'candidat-01';
  const profile = resolveSchoolProfile(school);

  payload.id = `${sourceId}-${school.slug}`;
  payload.url = school.url;
  payload.school = {
    slug: school.slug,
    label: school.label,
    url: school.url,
    profileId: profile.id,
    journeyGroup: school.journeyGroup || profile.journeyGroup || '',
    structureGroup: school.structureGroup || '',
    page1SelectionMode: school.page1SelectionMode || 'strict-jdd',
    paymentMode: profile.paymentMode || 'paytweak-card',
    startConfig: school.startConfig || null,
  };
  payload.campaign = {
    id: campaign.id,
    title: campaign.title,
    environment: campaign.environment,
    browser: campaign.browser,
    tool: campaign.tool,
  };

  return payload;
}

function spawnRunBusiness(jddPath, autoPayment, campaignStamp) {
  return new Promise((resolve) => {
    const args = [path.join(projectRoot, 'scripts', 'runBusiness.js'), '--jdd-path', jddPath];
    if (!autoPayment) {
      args.push('--no-payment');
    }

    const env = {
      ...process.env,
      CAMPAIGN_RUN_STAMP: campaignStamp,
    };

    const child = spawn(process.execPath, args, {
      cwd: projectRoot,
      env,
      stdio: 'inherit',
    });

    child.on('close', (code) => resolve(code));
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const campaign = getCampaign(options.campaignId);
  const schools = resolveSchools(campaign, options.schools, options.structureGroup);

  if (!schools.length) {
    throw new Error('Aucune ecole a executer dans la campagne.');
  }

  acquireExecutionLock(campaign, schools, options);
  ensureDir(tempJddRoot);
  ensureDir(businessRoot);

  const campaignStamp = nowStamp();
  const campaignSummary = {
    createdAt: new Date().toISOString(),
    campaignId: campaign.id,
    campaignTitle: campaign.title,
    campaignEnvironment: campaign.environment,
    baseJdd: options.baseJdd,
    autoPayment: options.autoPayment,
    schools: [],
  };

  const failures = [];
  for (let schoolIndex = 0; schoolIndex < schools.length; schoolIndex += 1) {
    const school = schools[schoolIndex];
    const baseJddName = school.baseJdd || options.baseJdd;
    const baseJddPath = path.join(jddRoot, baseJddName);
    if (!fs.existsSync(baseJddPath)) {
      throw new Error(`JDD de base introuvable: ${baseJddPath}`);
    }

    const basePayload = readJson(baseJddPath);
    const tempPayload = buildCampaignJdd(basePayload, campaign, school);
    const tempJddPath = path.join(tempJddRoot, `${school.slug}.json`);
    writeJson(tempJddPath, tempPayload);

    console.log('');
    console.log(`=== Campagne ${campaign.title} ===`);
    console.log(`[QUEUE] ${schoolIndex + 1}/${schools.length} ${school.label} (${school.slug})`);
    console.log(`[SCHOOL] ${school.label} (${school.slug})`);
    console.log(`[URL] ${school.url}`);

    const exitCode = await spawnRunBusiness(tempJddPath, options.autoPayment, campaignStamp);
    const reportDir = path.join(businessRoot, `${campaignStamp}-${sanitizeName(school.slug)}`);
    const resultPath = path.join(reportDir, 'resultat.json');
    const resultSummary = fs.existsSync(resultPath) ? readJson(resultPath) : null;
    const functionalStatus = getFunctionalSchoolStatus(resultSummary, exitCode);
    const motif = getFunctionalMotif(resultSummary);

    campaignSummary.schools.push({
      slug: school.slug,
      label: school.label,
      url: school.url,
      reportDir: relativeToProject(reportDir),
      status: exitCode === 0 ? 'OK' : 'KO',
      functionalStatus,
      motif,
      exitCode,
    });

    if (exitCode !== 0) {
      failures.push(school.slug);
      console.log(`[DONE] ${school.label} (${school.slug}) => KO`);
    } else {
      console.log(`[DONE] ${school.label} (${school.slug}) => OK`);
    }
  }

  try {
    fs.rmSync(tempJddRoot, { recursive: true, force: true });
  } catch {
    // ignore cleanup failure
  }

  const campaignSummaryPath = path.join(businessRoot, `campaign-summary-${campaignStamp}.json`);
  const latestSummaryPath = path.join(businessRoot, 'latest', 'campaign-summary.json');
  try {
    fs.writeFileSync(campaignSummaryPath, JSON.stringify(campaignSummary, null, 2), 'utf8');
    ensureDir(path.join(businessRoot, 'latest'));
    fs.writeFileSync(latestSummaryPath, JSON.stringify(campaignSummary, null, 2), 'utf8');
    console.log(`
[INFO] Résumé campagne : ${relativeToProject(campaignSummaryPath)}`);
    console.log(`[INFO] Résumé dernière campagne : ${relativeToProject(latestSummaryPath)}`);
  } catch {
    // ignore summary write failure
  }

  releaseExecutionLock();

  if (failures.length) {
    console.log('');
    console.log(`[WARNING] La campagne a termine avec ${failures.length} ecole(s) en echec: ${failures.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  console.log('');
  console.log(`[OK] Campagne terminee pour ${schools.length} ecole(s).`);
}

main().catch((error) => {
  releaseExecutionLock();
  console.error(error.message || error);
  process.exitCode = 1;
});

process.on('exit', releaseExecutionLock);
process.on('SIGINT', () => {
  releaseExecutionLock();
  process.exit(130);
});
process.on('SIGTERM', () => {
  releaseExecutionLock();
  process.exit(143);
});
