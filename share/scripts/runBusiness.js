const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const reportsRoot = path.join(projectRoot, 'reports');
const businessRoot = path.join(reportsRoot, 'business');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
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

function parseArgs(argv) {
  const result = {
    jdd: 'candidat-01.json',
    jddPath: '',
    autoPayment: true,
    refreshOnly: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--jdd' && argv[i + 1]) {
      result.jdd = argv[i + 1];
      i += 1;
    } else if (token === '--jdd-path' && argv[i + 1]) {
      result.jddPath = argv[i + 1];
      i += 1;
    } else if (token === '--no-payment') {
      result.autoPayment = false;
    } else if (token === '--refresh-dashboard') {
      result.refreshOnly = true;
    }
  }

  return result;
}

function listRootReportFiles() {
  if (!fs.existsSync(reportsRoot)) return [];
  return fs.readdirSync(reportsRoot)
    .map((name) => path.join(reportsRoot, name))
    .filter((fullPath) => fs.existsSync(fullPath) && fs.statSync(fullPath).isFile())
    .sort((left, right) => path.basename(left).localeCompare(path.basename(right), 'fr'));
}

function moveFilesToDir(files, destinationDir) {
  ensureDir(destinationDir);
  const moved = [];
  for (const filePath of files) {
    if (!fs.existsSync(filePath)) continue;
    const target = path.join(destinationDir, path.basename(filePath));
    fs.renameSync(filePath, target);
    moved.push(target);
  }
  return moved;
}

function inferBlockedStep(errorMessage, steps) {
  const text = String(errorMessage || '').toLowerCase();
  if (/paiement|payment|mercanet|carte/.test(text)) return 'Paiement';
  if (/page 3|recap|recapitulatif/.test(text)) return 'Page 3';
  if (/page 2|pieces jointes|documents|pj|etudes/.test(text)) return 'Page 2';
  if (/page 1|programme|informations personnelles/.test(text)) return 'Page 1';
  if (/accueil|demarrer|formulaire/.test(text)) return 'Accueil';

  if (steps.page3 === 'ok') return 'Paiement';
  if (steps.page2 === 'ok') return 'Page 3';
  if (steps.page1 === 'ok') return 'Page 2';
  if (steps.accueil === 'ok') return 'Page 1';
  return 'Accueil';
}

function shouldEchoLine(line) {
  return [
    /Demarrage\s*:/i,
    /\[OK\]\s*Page accueil/i,
    /Page 1\/4/i,
    /Page 2\/4/i,
    /Page 3\/4/i,
    /\[RESULT\].*PJ obligatoires chargees/i,
    /\[RETRY\]/i,
    /Paiement refuse detecte/i,
    /Paiement test accepte/i,
    /Etape finale sans paiement atteinte/i,
    /Statut detecte apres retour/i,
    /Page paiement atteinte/i,
    /Page finale atteinte/i,
    /termine !/i,
    /^Error:/i,
    /\[WARNING\]/i,
    /\[DEBUG\]/i,
  ].some((pattern) => pattern.test(line));
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatStepStatus(status) {
  return status === 'ok' ? 'OK' : 'non confirme';
}

function formatPaymentLabel(summary) {
  if (summary.paymentStatus === 'accepted') return 'Paiement accepte';
  if (summary.paymentStatus === 'refused') return 'Paiement refuse';
  if (summary.paymentStatus === 'not-required') return 'Sans paiement (non requis)';
  return summary.autoPayment ? 'Paiement non confirme' : 'Paiement non lance';
}

function buildFunctionalGuidance(summary) {
  if (summary.success && summary.paymentStatus === 'not-required') {
    return {
      title: 'Parcours termine avec succes',
      detail: 'La candidature a ete remplie jusqu au bout. Cette ecole ne demande pas de paiement sur la derniere etape.',
      action: 'Aucune action immediate. Vous pouvez partager ce resultat comme preuve du bon fonctionnement.',
    };
  }

  if (summary.success && summary.autoPayment) {
    return {
      title: 'Parcours termine avec succes',
      detail: 'La candidature a ete remplie jusqu au bout et le paiement de test a ete accepte.',
      action: 'Aucune action immediate. Vous pouvez partager ce resultat comme preuve du bon fonctionnement.',
    };
  }

  if (summary.success && !summary.autoPayment) {
    return {
      title: 'Parcours termine jusqu a la page de paiement',
      detail: 'La candidature a ete remplie et validee. Le run s est arrete avant le paiement car cette option etait desactivee.',
      action: 'Si besoin, relancer un run avec paiement pour verifier toute la chaine.',
    };
  }

  if (summary.paymentStatus === 'refused') {
    return {
      title: 'Blocage au paiement',
      detail: 'Le formulaire est alle jusqu a la page de paiement, mais le prestataire a refuse ou n a pas confirme la carte de test.',
      action: 'Verifier la carte de test utilisee, puis relancer un run avec une carte de recette attendue comme acceptee.',
    };
  }

  if (summary.blockedStep === 'Page 3') {
    return {
      title: 'Blocage sur le recapitulatif',
      detail: 'Le formulaire n a pas valide la page de verification avant paiement.',
      action: 'Ouvrir la capture de la page 3 et verifier le message visible ou les champs encore obligatoires.',
    };
  }

  if (summary.blockedStep === 'Page 2') {
    return {
      title: 'Blocage sur les etudes ou les pieces jointes',
      detail: 'La page des etudes et des documents n a pas ete acceptee par le formulaire.',
      action: 'Verifier d abord le statut des pieces jointes dans le resume, puis ouvrir la capture de la page 2 pour voir le message fonctionnel.',
    };
  }

  if (summary.blockedStep === 'Page 1') {
    return {
      title: 'Blocage sur les informations du candidat',
      detail: 'Le formulaire n a pas valide la premiere page de saisie.',
      action: 'Verifier le programme, les informations personnelles et les champs obligatoires signales dans la capture.',
    };
  }

  return {
    title: 'Blocage au lancement du parcours',
    detail: 'Le run s est arrete avant de terminer le parcours de candidature.',
    action: 'Ouvrir le resume HTML puis la capture la plus recente pour identifier le message fonctionnel affiche a l ecran.',
  };
}

function pickPrimaryArtifact(summary, artifactPaths) {
  const screenshots = artifactPaths.filter((filePath) => /\.png$/i.test(filePath));
  if (!screenshots.length) return '';

  if (summary.success) {
    return screenshots.find((filePath) => /success-final-full/i.test(path.basename(filePath)))
      || screenshots.find((filePath) => /payment-after-finalize/i.test(path.basename(filePath)))
      || screenshots.find((filePath) => /final/i.test(path.basename(filePath)))
      || screenshots[screenshots.length - 1];
  }

  if (summary.blockedStep === 'Paiement') {
    return screenshots.find((filePath) => /blocked-full/i.test(path.basename(filePath)))
      || screenshots.find((filePath) => /payment-after-submit/i.test(path.basename(filePath)))
      || screenshots.find((filePath) => /payment/i.test(path.basename(filePath)))
      || screenshots[screenshots.length - 1];
  }

  if (summary.blockedStep === 'Page 3') {
    return screenshots.find((filePath) => /blocked-full/i.test(path.basename(filePath)))
      || screenshots.find((filePath) => /validation-page-3/i.test(path.basename(filePath)))
      || screenshots[screenshots.length - 1];
  }

  if (summary.blockedStep === 'Page 2') {
    return screenshots.find((filePath) => /blocked-full/i.test(path.basename(filePath)))
      || screenshots.find((filePath) => /validation-page-2/i.test(path.basename(filePath)))
      || screenshots[screenshots.length - 1];
  }

  if (summary.blockedStep === 'Page 1') {
    return screenshots.find((filePath) => /blocked-full/i.test(path.basename(filePath)))
      || screenshots.find((filePath) => /validation-page-1/i.test(path.basename(filePath)))
      || screenshots.find((filePath) => /page1/i.test(path.basename(filePath)))
      || screenshots[screenshots.length - 1];
  }

  return screenshots.find((filePath) => /blocked-full/i.test(path.basename(filePath))) || screenshots[screenshots.length - 1];
}

function readJsonIfExists(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function resolveJddPath(options) {
  if (options.jddPath) {
    return path.resolve(options.jddPath);
  }
  return path.join(projectRoot, 'data', 'jdd', options.jdd);
}

function inferSchoolSlugFromUrl(rawUrl) {
  const match = String(rawUrl || '').match(/\/app\/([^/]+)\/program/i);
  return match ? sanitizeName(match[1].toLowerCase()) : '';
}

function loadJddContext(options) {
  const absolutePath = resolveJddPath(options);
  const payload = readJsonIfExists(absolutePath) || {};
  const school = payload.school || {};
  const campaign = payload.campaign || {};
  const schoolSlug = school.slug || inferSchoolSlugFromUrl(school.url || payload.url || '');

  return {
    absolutePath,
    fileName: path.basename(absolutePath),
    baseName: path.basename(absolutePath, path.extname(absolutePath)),
    candidateSourceId: payload.id || '',
    payload,
    schoolSlug: sanitizeName(schoolSlug || ''),
    schoolLabel: school.label || '',
    schoolUrl: school.url || payload.url || '',
    profileId: school.profileId || '',
    structureGroup: school.structureGroup || '',
    page1SelectionMode: school.page1SelectionMode || '',
    paymentMode: school.paymentMode || '',
    journeyGroup: school.journeyGroup || '',
    campaignId: campaign.id || '',
    campaignTitle: campaign.title || '',
    campaignEnvironment: campaign.environment || '',
    campaignBrowser: campaign.browser || '',
    campaignTool: campaign.tool || '',
  };
}

function buildDashboardStats(rootDir) {
  const stats = {
    totalRuns: 0,
    successRuns: 0,
    failedRuns: 0,
    blockedRuns: 0,
    paymentFailures: 0,
    partialRuns: 0,
    successRate: 0,
    lastRunDate: '-',
    lastRunStatus: '-',
  };

  if (!fs.existsSync(rootDir)) {
    return stats;
  }

  const runDirs = fs.readdirSync(rootDir)
    .map((name) => path.join(rootDir, name))
    .filter((fullPath) => {
      try {
        return fs.statSync(fullPath).isDirectory() && path.basename(fullPath).toLowerCase() !== 'latest';
      } catch {
        return false;
      }
    });

  let latestRun = null;

  for (const dirPath of runDirs) {
    const payload = readJsonIfExists(path.join(dirPath, 'resultat.json'));
    if (!payload) continue;

    if (!payload.autoPayment) {
      stats.partialRuns += 1;
      continue;
    }

    stats.totalRuns += 1;
    if (payload.success && ['accepted', 'not-required', 'skipped'].includes(String(payload.paymentStatus || '').toLowerCase())) {
      stats.successRuns += 1;
    } else {
      stats.failedRuns += 1;
      if (payload.paymentStatus === 'refused' || payload.blockedStep === 'Paiement') {
        stats.paymentFailures += 1;
      } else {
        stats.blockedRuns += 1;
      }
    }

    if (!latestRun || String(payload.startedAt || '') > String(latestRun.startedAt || '')) {
      latestRun = payload;
    }
  }

  if (stats.totalRuns > 0) {
    stats.successRate = Math.round((stats.successRuns / stats.totalRuns) * 100);
  }

  if (latestRun) {
    stats.lastRunDate = latestRun.startedAtHuman || '-';
    stats.lastRunStatus = latestRun.success ? 'SUCCES' : 'KO';
  }

  return stats;
}

function listRunResults(rootDir) {
  if (!fs.existsSync(rootDir)) return [];

  const entries = fs.readdirSync(rootDir)
    .map((name) => path.join(rootDir, name))
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

  return entries;
}

function determineDashboardStatusLabel(run) {
  if (!run.autoPayment && run.success) return 'Partiel';
  if (run.success) return 'Succes';
  if (run.paymentStatus === 'refused' || run.blockedStep === 'Paiement') return 'Echec';
  return 'Blocage';
}

function determineStatusClass(run) {
  if (!run.autoPayment && run.success) return 'neutral';
  if (run.success) return 'success';
  if (run.paymentStatus === 'refused' || run.blockedStep === 'Paiement') return 'error';
  return 'warning';
}

function formatDurationLabel(run) {
  if (typeof run.durationSeconds === 'number' && Number.isFinite(run.durationSeconds)) {
    return `${run.durationSeconds.toFixed(1)} s`;
  }
  return '-';
}

function buildStageCounts(runResults) {
  const counts = {
    accueil: 0,
    page1: 0,
    page2: 0,
    page3: 0,
    paiement: 0,
  };

  for (const run of runResults) {
    if (run.steps?.accueil === 'ok') counts.accueil += 1;
    if (run.steps?.page1 === 'ok') counts.page1 += 1;
    if (run.steps?.page2 === 'ok') counts.page2 += 1;
    if (run.steps?.page3 === 'ok') counts.page3 += 1;
    if (run.success || run.paymentStatus === 'accepted' || run.paymentStatus === 'refused' || run.blockedStep === 'Paiement') {
      counts.paiement += 1;
    }
  }

  return counts;
}

function relativeLinkFromBusinessRoot(targetAbsPath) {
  return path.relative(businessRoot, targetAbsPath).replace(/\\/g, '/');
}

function humanizeArtifactLabel(filePath) {
  const name = path.basename(filePath || '');
  if (/success-final-full/i.test(name)) return 'Capture finale succes';
  if (/blocked-full/i.test(name)) return 'Capture ecran bloque';
  if (/final/i.test(name)) return 'Capture finale';
  if (/page1-filled/i.test(name)) return 'Page 1 remplie';
  if (/page1-start/i.test(name)) return 'Debut page 1';
  if (/page2-filled/i.test(name)) return 'Page 2 remplie';
  if (/page3-filled/i.test(name)) return 'Page 3 remplie';
  if (/page4-payment-start/i.test(name)) return 'Page paiement';
  if (/payment-card-filled/i.test(name)) return 'Carte de test saisie';
  if (/payment-after-submit/i.test(name)) return 'Retour prestataire paiement';
  if (/payment-after-finalize/i.test(name)) return 'Retour final formulaire';
  if (/validation-page-1/i.test(name)) return 'Validation page 1';
  if (/validation-page-2/i.test(name)) return 'Validation page 2';
  if (/validation-page-3/i.test(name)) return 'Validation page 3';
  if (/run\.log/i.test(name)) return 'Journal technique';
  if (/resume-fonctionnel/i.test(name)) return 'Resume fonctionnel';
  return name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
}

function computePaymentStepStatus(run) {
  if (!run.autoPayment) return 'skipped';
  if (run.paymentStatus === 'accepted') return 'ok';
  if (run.paymentStatus === 'not-required') return 'ok';
  if (run.paymentStatus === 'refused' || run.blockedStep === 'Paiement') return 'error';
  return 'pending';
}

function buildStepItems(run) {
  return [
    { label: 'Accueil', status: run.steps?.accueil === 'ok' ? 'ok' : 'pending' },
    { label: 'Page 1', status: run.steps?.page1 === 'ok' ? 'ok' : 'pending' },
    { label: 'Page 2', status: run.steps?.page2 === 'ok' ? 'ok' : 'pending' },
    { label: 'Page 3', status: run.steps?.page3 === 'ok' ? 'ok' : 'pending' },
    { label: 'Paiement', status: computePaymentStepStatus(run) },
  ];
}

function buildDashboardData(runResults, stats) {
  const fullRuns = runResults.filter((run) => run.autoPayment);
  const stageCounts = buildStageCounts(fullRuns);
  const latestRun = runResults[0] || null;

  const runs = runResults.map((run, index) => {
    const statusLabel = determineDashboardStatusLabel(run);
    const statusTone = determineStatusClass(run);
    const stageLabel = run.success
      ? (run.autoPayment ? 'Parcours complet' : 'Paiement non lance')
      : (run.blockedStep || 'En cours');

    const resumeHref = `${run.__dirName}/resume-fonctionnel.html`;
    const jsonHref = `${run.__dirName}/resultat.json`;
    const logHref = `${run.__dirName}/run.log`;
    const primaryCaptureHref = run.primaryArtifact
      ? relativeLinkFromBusinessRoot(path.join(projectRoot, run.primaryArtifact))
      : '';

    const artifactItems = [
      { label: 'Resume fonctionnel', href: resumeHref, kind: 'document' },
      { label: 'Resultat JSON', href: jsonHref, kind: 'document' },
      { label: 'Journal technique', href: logHref, kind: 'document' },
      ...((Array.isArray(run.artifacts) ? run.artifacts : []).map((artifactPath) => ({
        label: humanizeArtifactLabel(artifactPath),
        href: relativeLinkFromBusinessRoot(path.join(projectRoot, artifactPath)),
        kind: /\.(png|jpg|jpeg)$/i.test(artifactPath) ? 'image' : 'document',
      }))),
    ];

    const previewImage = artifactItems.find((item) => item.kind === 'image');

    return {
      index,
      id: run.__dirName,
      startedAtHuman: run.startedAtHuman || '-',
      candidateId: run.candidateId || '-',
      jdd: run.jdd || '-',
      autoPayment: !!run.autoPayment,
      runKind: run.autoPayment ? 'complete' : 'partial',
      runKindLabel: run.autoPayment ? 'Parcours complet' : 'Essai partiel',
      success: !!run.success,
      stageLabel,
      statusLabel,
      statusTone,
      paymentLabel: formatPaymentLabel(run),
      paymentStatus: run.paymentStatus || '',
      attachmentsLabel: run.attachmentsLabel || '-',
      durationLabel: formatDurationLabel(run),
      blockedStep: run.blockedStep || '',
      errorMessage: run.errorMessage || '',
      guidanceTitle: run.guidance?.title || '',
      guidanceDetail: run.guidance?.detail || '',
      guidanceAction: run.guidance?.action || '',
      resumeHref,
      jsonHref,
      logHref,
      primaryCaptureHref,
      previewImageHref: previewImage ? previewImage.href : primaryCaptureHref,
      stepItems: buildStepItems(run),
      artifactItems,
    };
  });

  return {
    summary: {
      latestRunDate: stats.lastRunDate,
      latestRunStatus: stats.lastRunStatus,
      totalAllRuns: runResults.length,
      totalCompleteRuns: stats.totalRuns,
      successRuns: stats.successRuns,
      failedRuns: stats.failedRuns,
      blockedRuns: stats.blockedRuns,
      paymentFailures: stats.paymentFailures,
      partialRuns: stats.partialRuns,
      successRate: stats.successRate,
      latestResumeHref: 'latest/resume-fonctionnel.html',
      latestJsonHref: 'latest/resultat.json',
      latestCampaignSummaryHref: 'latest/campaign-summary.json',
      latestCandidateId: latestRun ? (latestRun.candidateId || '-') : '-',
      latestTitle: latestRun?.guidance?.title || 'Aucune execution disponible',
      latestDetail: latestRun?.guidance?.detail || 'Lance un parcours pour alimenter le dashboard.',
      latestAction: latestRun?.guidance?.action || 'Relancer un test depuis le lanceur.',
      stageCounts,
    },
    counts: {
      success: stats.successRuns,
      error: stats.failedRuns - stats.blockedRuns,
      warning: stats.blockedRuns,
      neutral: runs.filter((run) => run.statusTone === 'neutral').length,
    },
    runs,
  };
}

function createBusinessDashboardHtml(runResults, stats) {
  const dashboardData = buildDashboardData(runResults, stats);
  const dashboardJson = JSON.stringify(dashboardData)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e');

  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <title>Dashboard candidature</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Aptos", "Segoe UI", Arial, sans-serif;
      background: linear-gradient(180deg, #eef4fb 0%, #f7fafc 100%);
      color: #12263f;
    }
    a { color: inherit; }
    .clearfix:after { content: ""; display: block; clear: both; }
    .app-shell {
      width: 1420px;
      margin: 22px auto 30px;
    }
    .panel {
      background: #ffffff;
      border: 1px solid #dbe5f0;
      border-radius: 24px;
      box-shadow: 0 20px 40px rgba(15, 23, 42, 0.08);
    }
    .masthead { margin-bottom: 18px; }
    .brand { float: left; }
    .brand-mark {
      float: left;
      width: 54px;
      height: 54px;
      line-height: 54px;
      text-align: center;
      border-radius: 18px;
      background: linear-gradient(135deg, #1e6bff 0%, #4ec5f0 100%);
      color: #ffffff;
      font-weight: 700;
      font-size: 26px;
      margin-right: 14px;
    }
    .eyebrow {
      color: #5d7188;
      font-size: 13px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      margin-top: 4px;
    }
    .brand-copy h1 {
      margin: 4px 0 6px;
      font-size: 34px;
      line-height: 1.06;
      letter-spacing: -0.04em;
    }
    .brand-copy p {
      margin: 0;
      color: #566b82;
      font-size: 15px;
    }
    .masthead-actions {
      float: right;
      margin-top: 8px;
    }
    .action-link {
      display: inline-block;
      padding: 13px 18px;
      border-radius: 14px;
      background: #ffffff;
      border: 1px solid #d7e0ea;
      color: #12355c;
      text-decoration: none;
      font-weight: 600;
      margin-left: 10px;
    }
    .action-link.primary {
      background: #117d74;
      border-color: #117d74;
      color: #ffffff;
    }
    .hero {
      background: linear-gradient(135deg, #1e63ff 0%, #22c0dc 100%);
      border-radius: 28px;
      color: #ffffff;
      padding: 28px 30px;
      margin-bottom: 18px;
      box-shadow: 0 24px 48px rgba(29, 98, 255, 0.18);
    }
    .hero-main {
      float: left;
      width: 62%;
      padding-right: 24px;
    }
    .hero-side {
      float: right;
      width: 34%;
      background: rgba(255, 255, 255, 0.12);
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 22px;
      padding: 18px 20px;
    }
    .hero-pill {
      display: inline-block;
      padding: 8px 12px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.16);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .hero h2 {
      margin: 16px 0 10px;
      font-size: 36px;
      line-height: 1.06;
      letter-spacing: -0.04em;
    }
    .hero p {
      margin: 0;
      font-size: 16px;
      line-height: 1.6;
      color: rgba(255, 255, 255, 0.92);
    }
    .hero-meta {
      margin-top: 18px;
      font-size: 14px;
      color: rgba(255, 255, 255, 0.88);
    }
    .hero-side-title {
      font-size: 14px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin-bottom: 14px;
      color: rgba(255, 255, 255, 0.82);
    }
    .stage-row { margin-bottom: 14px; }
    .stage-row:last-child { margin-bottom: 0; }
    .stage-meta {
      font-size: 13px;
      margin-bottom: 6px;
      overflow: hidden;
    }
    .stage-meta strong { float: right; }
    .stage-track {
      height: 9px;
      background: rgba(255, 255, 255, 0.18);
      border-radius: 999px;
      overflow: hidden;
    }
    .stage-fill {
      height: 100%;
      background: #ffffff;
      border-radius: 999px;
    }
    .metric-grid { margin-bottom: 18px; }
    .metric-card {
      float: left;
      width: 18.8%;
      margin-right: 1.5%;
      padding: 18px 20px;
      min-height: 134px;
    }
    .metric-card.last { margin-right: 0; }
    .metric-label {
      color: #687b8f;
      font-size: 14px;
      margin-bottom: 12px;
    }
    .metric-value {
      font-size: 40px;
      line-height: 1;
      letter-spacing: -0.05em;
      font-weight: 700;
      margin-bottom: 9px;
      color: #0f172a;
    }
    .metric-value.success { color: #18824d; }
    .metric-value.error { color: #cc3f2f; }
    .metric-value.warning { color: #ba7a14; }
    .metric-value.neutral { color: #2b5dcf; }
    .metric-note {
      color: #5f6f82;
      font-size: 14px;
      line-height: 1.5;
    }
    .controls {
      padding: 20px 22px;
      margin-bottom: 18px;
    }
    .control-group {
      float: left;
      margin-right: 18px;
      min-width: 280px;
    }
    .control-group.search-group {
      float: right;
      width: 340px;
      margin-right: 0;
    }
    .control-label {
      font-size: 12px;
      color: #718399;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin-bottom: 8px;
    }
    .chip-row button {
      display: inline-block;
      border: 1px solid #d8e1ea;
      background: #ffffff;
      color: #2d4158;
      border-radius: 14px;
      padding: 10px 14px;
      margin-right: 8px;
      margin-bottom: 8px;
      font: inherit;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
    }
    .chip-row button.active {
      background: #1e63ff;
      border-color: #1e63ff;
      color: #ffffff;
      box-shadow: 0 10px 22px rgba(30, 99, 255, 0.24);
    }
    .chip-row button.success.active { background: #18824d; border-color: #18824d; }
    .chip-row button.error.active { background: #cc3f2f; border-color: #cc3f2f; }
    .chip-row button.warning.active { background: #ba7a14; border-color: #ba7a14; }
    .chip-row button.neutral.active { background: #2b5dcf; border-color: #2b5dcf; }
    .search-input {
      width: 100%;
      padding: 13px 15px;
      border-radius: 14px;
      border: 1px solid #d8e1ea;
      background: #f9fbfd;
      font: inherit;
      font-size: 15px;
      color: #223247;
    }
    .content { margin-bottom: 24px; }
    .list-column {
      float: left;
      width: 61%;
      padding: 22px;
    }
    .detail-column {
      float: right;
      width: 37%;
      padding: 22px;
    }
    .section-title {
      font-size: 28px;
      line-height: 1.1;
      letter-spacing: -0.04em;
      margin-bottom: 6px;
    }
    .section-subtitle {
      color: #5f7186;
      font-size: 14px;
      margin-bottom: 18px;
    }
    .list-head {
      background: #f4f8fc;
      border: 1px solid #e0e8f0;
      border-radius: 16px;
      padding: 12px 14px;
      color: #66788d;
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      margin-bottom: 10px;
    }
    .run-list {
      max-height: 760px;
      overflow-y: auto;
      padding-right: 4px;
    }
    .run-row {
      border: 1px solid #dde6ee;
      border-radius: 18px;
      padding: 14px 14px 13px;
      margin-bottom: 10px;
      cursor: pointer;
      background: #ffffff;
      transition: box-shadow 0.15s ease, border-color 0.15s ease, transform 0.15s ease;
    }
    .run-row:hover {
      border-color: #1e63ff;
      box-shadow: 0 12px 24px rgba(17, 24, 39, 0.08);
      transform: translateY(-1px);
    }
    .run-row.selected {
      border-color: #1e63ff;
      box-shadow: 0 14px 28px rgba(30, 99, 255, 0.18);
      background: linear-gradient(180deg, #ffffff 0%, #f5f9ff 100%);
    }
    .list-col {
      float: left;
      padding-right: 10px;
      font-size: 14px;
      color: #1d2d40;
      line-height: 1.45;
    }
    .col-date { width: 21%; }
    .col-candidate { width: 20%; }
    .col-stage { width: 15%; }
    .col-payment { width: 17%; }
    .col-status { width: 12%; }
    .col-attachments { width: 9%; }
    .col-duration { width: 6%; padding-right: 0; }
    .subline {
      display: block;
      font-size: 12px;
      color: #718399;
      margin-top: 4px;
    }
    .status-pill {
      display: inline-block;
      padding: 7px 12px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.03em;
    }
    .status-pill.success { background: #e3f7ea; color: #126d3d; }
    .status-pill.error { background: #fde7e5; color: #b23c2b; }
    .status-pill.warning { background: #fdf0dd; color: #9e650b; }
    .status-pill.neutral { background: #e4edff; color: #214fbe; }
    .empty-state {
      border: 1px dashed #d7e0ea;
      background: #f9fbfd;
      padding: 26px;
      border-radius: 18px;
      color: #63768d;
      font-size: 15px;
      text-align: center;
    }
    .detail-eyebrow {
      color: #5d7188;
      font-size: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      margin-bottom: 10px;
    }
    .detail-title {
      margin: 0 0 8px;
      font-size: 30px;
      line-height: 1.08;
      letter-spacing: -0.04em;
    }
    .detail-lead {
      color: #566b82;
      font-size: 15px;
      line-height: 1.6;
      margin-bottom: 14px;
    }
    .detail-actions { margin-bottom: 16px; }
    .detail-actions a {
      display: inline-block;
      margin-right: 8px;
      margin-bottom: 8px;
      padding: 11px 14px;
      border-radius: 14px;
      text-decoration: none;
      border: 1px solid #d7e0ea;
      color: #12355c;
      background: #ffffff;
      font-size: 14px;
      font-weight: 700;
    }
    .detail-actions a.primary {
      background: #117d74;
      border-color: #117d74;
      color: #ffffff;
    }
    .facts { margin-bottom: 18px; }
    .fact-card {
      float: left;
      width: 48%;
      margin-right: 4%;
      margin-bottom: 10px;
      padding: 14px 15px;
      border: 1px solid #e0e8f0;
      border-radius: 18px;
      background: #f9fbfd;
    }
    .fact-card.even { margin-right: 0; }
    .fact-label {
      color: #718399;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin-bottom: 7px;
    }
    .fact-value {
      color: #13263e;
      font-size: 15px;
      line-height: 1.5;
      font-weight: 600;
    }
    .detail-section { margin-bottom: 18px; }
    .detail-section-title {
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #718399;
      margin-bottom: 10px;
    }
    .step-pills span {
      display: inline-block;
      margin-right: 8px;
      margin-bottom: 8px;
      padding: 9px 12px;
      border-radius: 14px;
      font-size: 13px;
      font-weight: 700;
      border: 1px solid transparent;
    }
    .step-pills span.ok { background: #e4f7ec; color: #126d3d; }
    .step-pills span.error { background: #fde7e5; color: #b23c2b; }
    .step-pills span.pending { background: #eef3f7; color: #526479; }
    .step-pills span.skipped { background: #e7edff; color: #3350a5; }
    .logic-box {
      border-radius: 20px;
      padding: 16px 18px;
      border-left: 5px solid #d4dce6;
      margin-bottom: 14px;
    }
    .logic-box.success {
      background: #edf9f1;
      border-left-color: #1a8b51;
    }
    .logic-box.error {
      background: #fff1ee;
      border-left-color: #cc3f2f;
    }
    .logic-box p {
      margin: 0 0 8px;
      line-height: 1.6;
      color: #19304d;
    }
    .logic-title {
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin-bottom: 8px;
      color: #35506d;
      font-weight: 700;
    }
    .logic-action {
      color: #2f4760;
      font-size: 14px;
      line-height: 1.6;
    }
    .preview-wrap {
      border: 1px solid #e0e8f0;
      border-radius: 20px;
      padding: 12px;
      background: #f9fbfd;
    }
    .preview-wrap img {
      width: 100%;
      display: block;
      border-radius: 14px;
    }
    .preview-empty {
      padding: 20px;
      text-align: center;
      color: #6a7c91;
      font-size: 14px;
      background: #f9fbfd;
      border: 1px dashed #d7e0ea;
      border-radius: 18px;
    }
    .artifact-list a {
      display: inline-block;
      margin-right: 8px;
      margin-bottom: 8px;
      padding: 10px 12px;
      border-radius: 12px;
      border: 1px solid #d7e0ea;
      background: #ffffff;
      text-decoration: none;
      font-size: 13px;
      color: #20415e;
    }
    .artifact-list a.image { background: #f4f9ff; }
    .muted-note {
      color: #6a7b90;
      font-size: 13px;
      margin-top: 8px;
    }
    @media screen and (max-width: 1460px) {
      .app-shell { width: auto; margin: 16px; }
    }
  </style>
</head>
<body>
  <div class="app-shell">
    <div class="masthead clearfix">
      <div class="brand clearfix">
        <div class="brand-mark">T</div>
        <div class="brand-copy">
          <div class="eyebrow">Automatisation candidature</div>
          <h1>Dashboard des parcours</h1>
          <p id="mastheadText">Chargement du diagnostic metier...</p>
        </div>
      </div>
      <div class="masthead-actions">
        <a id="latestResumeLink" class="action-link primary" href="#" target="_blank">Ouvrir le dernier resume</a>
        <a id="latestJsonLink" class="action-link" href="#" target="_blank">Ouvrir le JSON</a>
        <a id="latestSummaryLink" class="action-link" href="#" target="_blank">Ouvrir le résumé campagne</a>
      </div>
    </div>

    <div class="hero clearfix">
      <div class="hero-main">
        <div class="hero-pill">KPI calcules sur les parcours complets</div>
        <h2 id="heroTitle">Chargement...</h2>
        <p id="heroDetail"></p>
        <div id="heroMeta" class="hero-meta"></div>
      </div>
      <div class="hero-side">
        <div class="hero-side-title">Parcours atteints</div>
        <div id="stageCoverage"></div>
      </div>
    </div>

    <div id="metricGrid" class="metric-grid clearfix"></div>

    <div class="controls panel clearfix">
      <div class="control-group">
        <div class="control-label">Perimetre</div>
        <div id="scopeFilters" class="chip-row"></div>
      </div>
      <div class="control-group">
        <div class="control-label">Statut</div>
        <div id="statusFilters" class="chip-row"></div>
      </div>
      <div class="control-group search-group">
        <div class="control-label">Recherche</div>
        <input id="searchInput" class="search-input" type="text" placeholder="Rechercher par candidat, etape ou message..." />
      </div>
    </div>

    <div class="content clearfix">
      <div class="list-column panel">
        <div class="section-title">Historique des tests</div>
        <div id="listMeta" class="section-subtitle"></div>
        <div class="list-head clearfix">
          <div class="list-col col-date">Date</div>
          <div class="list-col col-candidate">Candidat</div>
          <div class="list-col col-stage">Etape</div>
          <div class="list-col col-payment">Paiement</div>
          <div class="list-col col-status">Statut</div>
          <div class="list-col col-attachments">PJ</div>
          <div class="list-col col-duration">Duree</div>
        </div>
        <div id="runList" class="run-list"></div>
        <div id="emptyState" class="empty-state" style="display:none;">Aucune execution ne correspond aux filtres actuels.</div>
      </div>

      <div class="detail-column panel">
        <div id="detailPane"></div>
      </div>
    </div>
  </div>

  <script>
    var DASHBOARD_DATA = ${dashboardJson};
    var activeScope = 'complete';
    var activeStatus = 'all';
    var searchText = '';
    var selectedIndex = DASHBOARD_DATA.runs.length ? DASHBOARD_DATA.runs[0].index : -1;

    function escapeHtml(value) {
      return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function isLatestCopy() {
      var raw = decodeURIComponent(String(window.location.pathname || window.location.href || ''));
      return /[\\/]latest[\\/]/i.test(raw);
    }

    function resolveHref(relPath) {
      if (!relPath) return '#';
      return (isLatestCopy() ? '../' : '') + relPath;
    }

    function matchesScope(run) {
      if (activeScope === 'all') return true;
      if (activeScope === 'complete') return run.autoPayment;
      if (activeScope === 'partial') return !run.autoPayment;
      return true;
    }

    function matchesStatus(run) {
      if (activeStatus === 'all') return true;
      return run.statusTone === activeStatus;
    }

    function matchesSearch(run) {
      if (!searchText) return true;
      var haystack = [
        run.startedAtHuman,
        run.candidateId,
        run.jdd,
        run.stageLabel,
        run.paymentLabel,
        run.attachmentsLabel,
        run.errorMessage,
        run.guidanceTitle,
        run.guidanceDetail
      ].join(' ').toLowerCase();
      return haystack.indexOf(searchText) !== -1;
    }

    function getVisibleRuns() {
      return DASHBOARD_DATA.runs.filter(function (run) {
        return matchesScope(run) && matchesStatus(run) && matchesSearch(run);
      });
    }

    function ensureSelectedRun(runs) {
      var i;
      if (!runs.length) {
        selectedIndex = -1;
        return null;
      }
      for (i = 0; i < runs.length; i += 1) {
        if (runs[i].index === selectedIndex) return runs[i];
      }
      selectedIndex = runs[0].index;
      return runs[0];
    }

    function buildMetricCard(label, value, note, tone, isLast) {
      return ''
        + '<div class="metric-card panel' + (isLast ? ' last' : '') + '">'
        +   '<div class="metric-label">' + escapeHtml(label) + '</div>'
        +   '<div class="metric-value ' + escapeHtml(tone) + '">' + escapeHtml(value) + '</div>'
        +   '<div class="metric-note">' + escapeHtml(note) + '</div>'
        + '</div>';
    }

    function buildScopeButton(scope, label, count) {
      var className = activeScope === scope ? 'active' : '';
      return '<button type="button" class="' + className + '" onclick="setScopeFilter(\'' + scope + '\')">' + escapeHtml(label + ' (' + count + ')') + '</button>';
    }

    function buildStatusButton(tone, label, count) {
      var className = activeStatus === tone ? 'active ' + tone : '';
      return '<button type="button" class="' + className + '" onclick="setStatusFilter(\'' + tone + '\')">' + escapeHtml(label + ' (' + count + ')') + '</button>';
    }

    function formatStepStatus(status) {
      if (status === 'ok') return 'OK';
      if (status === 'error') return 'KO';
      if (status === 'skipped') return 'Ignore';
      return 'En attente';
    }

    function renderHero() {
      var summary = DASHBOARD_DATA.summary;
      document.getElementById('mastheadText').innerHTML =
        'Derniere execution complete : ' + escapeHtml(summary.latestRunDate) +
        ' · Statut : ' + escapeHtml(summary.latestRunStatus);
      document.getElementById('heroTitle').innerHTML = escapeHtml(summary.latestTitle);
      document.getElementById('heroDetail').innerHTML = escapeHtml(summary.latestDetail);
      document.getElementById('heroMeta').innerHTML =
        'Candidat : ' + escapeHtml(summary.latestCandidateId) +
        ' · Partiels exclus des KPI : ' + escapeHtml(summary.partialRuns) +
        ' · Taux de reussite : ' + escapeHtml(summary.successRate + '%');

      var coverage = [
        { label: 'Accueil', value: summary.stageCounts.accueil },
        { label: 'Page 1', value: summary.stageCounts.page1 },
        { label: 'Page 2', value: summary.stageCounts.page2 },
        { label: 'Page 3', value: summary.stageCounts.page3 },
        { label: 'Paiement', value: summary.stageCounts.paiement }
      ];
      var total = summary.totalCompleteRuns > 0 ? summary.totalCompleteRuns : 1;
      var html = '';
      var i;
      for (i = 0; i < coverage.length; i += 1) {
        html += ''
          + '<div class="stage-row">'
          +   '<div class="stage-meta clearfix"><span>' + escapeHtml(coverage[i].label) + '</span><strong>' + escapeHtml(coverage[i].value + ' / ' + summary.totalCompleteRuns) + '</strong></div>'
          +   '<div class="stage-track"><div class="stage-fill" style="width:' + Math.round((coverage[i].value / total) * 100) + '%"></div></div>'
          + '</div>';
      }
      document.getElementById('stageCoverage').innerHTML = html;
      document.getElementById('latestResumeLink').setAttribute('href', resolveHref(summary.latestResumeHref));
      document.getElementById('latestJsonLink').setAttribute('href', resolveHref(summary.latestJsonHref));
      document.getElementById('latestSummaryLink').setAttribute('href', resolveHref(summary.latestCampaignSummaryHref));
    }

    function renderMetrics() {
      var summary = DASHBOARD_DATA.summary;
      var cards = '';
      cards += buildMetricCard('Parcours complets', summary.totalCompleteRuns, 'Runs pris en compte dans les KPI.', 'neutral', false);
      cards += buildMetricCard('Succes', summary.successRuns, summary.successRate + '% des parcours complets.', 'success', false);
      cards += buildMetricCard('KO', summary.failedRuns, 'Dont ' + summary.paymentFailures + ' echec(s) au paiement.', 'error', false);
      cards += buildMetricCard('Blocages', summary.blockedRuns, 'Blocages avant confirmation du paiement.', 'warning', false);
      cards += buildMetricCard('Partiels exclus', summary.partialRuns, 'Visibles dans l historique mais hors KPI.', 'neutral', true);
      document.getElementById('metricGrid').innerHTML = cards;
    }

    function renderFilters() {
      var summary = DASHBOARD_DATA.summary;
      document.getElementById('scopeFilters').innerHTML =
        buildScopeButton('complete', 'Complets', summary.totalCompleteRuns) +
        buildScopeButton('partial', 'Partiels', summary.partialRuns) +
        buildScopeButton('all', 'Tous', summary.totalAllRuns);

      document.getElementById('statusFilters').innerHTML =
        buildStatusButton('all', 'Tous', summary.totalAllRuns) +
        buildStatusButton('success', 'Succes', summary.successRuns) +
        buildStatusButton('error', 'Echecs', DASHBOARD_DATA.counts.error) +
        buildStatusButton('warning', 'Blocages', summary.blockedRuns) +
        buildStatusButton('neutral', 'Partiels OK', DASHBOARD_DATA.counts.neutral);
    }

    function renderList() {
      var runs = getVisibleRuns();
      var selectedRun = ensureSelectedRun(runs);
      var list = document.getElementById('runList');
      var empty = document.getElementById('emptyState');
      var meta = document.getElementById('listMeta');
      var html = '';
      var i;

      meta.innerHTML = escapeHtml(runs.length + ' execution(s) affichee(s) sur ' + DASHBOARD_DATA.summary.totalAllRuns + ' historique(s).');

      if (!runs.length) {
        list.innerHTML = '';
        empty.style.display = 'block';
        renderDetail(null);
        return;
      }

      empty.style.display = 'none';

      for (i = 0; i < runs.length; i += 1) {
        html += ''
          + '<div class="run-row clearfix' + (selectedRun && selectedRun.index === runs[i].index ? ' selected' : '') + '" onclick="selectRun(' + runs[i].index + ')">'
          +   '<div class="list-col col-date"><strong>' + escapeHtml(runs[i].startedAtHuman) + '</strong><span class="subline">' + escapeHtml(runs[i].jdd) + '</span></div>'
          +   '<div class="list-col col-candidate"><strong>' + escapeHtml(runs[i].candidateId) + '</strong><span class="subline">' + escapeHtml(runs[i].runKindLabel) + '</span></div>'
          +   '<div class="list-col col-stage">' + escapeHtml(runs[i].stageLabel) + '</div>'
          +   '<div class="list-col col-payment">' + escapeHtml(runs[i].paymentLabel) + '</div>'
          +   '<div class="list-col col-status"><span class="status-pill ' + escapeHtml(runs[i].statusTone) + '">' + escapeHtml(runs[i].statusLabel) + '</span></div>'
          +   '<div class="list-col col-attachments">' + escapeHtml(runs[i].attachmentsLabel) + '</div>'
          +   '<div class="list-col col-duration">' + escapeHtml(runs[i].durationLabel) + '</div>'
          + '</div>';
      }

      list.innerHTML = html;
      renderDetail(selectedRun);
    }

    function renderDetail(run) {
      var pane = document.getElementById('detailPane');
      var i;
      var stepsHtml = '';
      var factsHtml = '';
      var artifactsHtml = '';
      var previewHtml = '';
      var detailActions = '';

      if (!run) {
        pane.innerHTML = '<div class="empty-state">Selectionne une execution a gauche pour voir le detail du test, les captures et le diagnostic fonctionnel.</div>';
        return;
      }

      for (i = 0; i < run.stepItems.length; i += 1) {
        stepsHtml += '<span class="' + escapeHtml(run.stepItems[i].status) + '">' + escapeHtml(run.stepItems[i].label + ' · ' + formatStepStatus(run.stepItems[i].status)) + '</span>';
      }

      factsHtml += '<div class="fact-card"><div class="fact-label">Date</div><div class="fact-value">' + escapeHtml(run.startedAtHuman) + '</div></div>';
      factsHtml += '<div class="fact-card even"><div class="fact-label">Statut</div><div class="fact-value">' + escapeHtml(run.statusLabel) + '</div></div>';
      factsHtml += '<div class="fact-card"><div class="fact-label">Etape</div><div class="fact-value">' + escapeHtml(run.stageLabel) + '</div></div>';
      factsHtml += '<div class="fact-card even"><div class="fact-label">Paiement</div><div class="fact-value">' + escapeHtml(run.paymentLabel) + '</div></div>';
      factsHtml += '<div class="fact-card"><div class="fact-label">Pieces jointes</div><div class="fact-value">' + escapeHtml(run.attachmentsLabel) + '</div></div>';
      factsHtml += '<div class="fact-card even"><div class="fact-label">Duree</div><div class="fact-value">' + escapeHtml(run.durationLabel) + '</div></div>';

      for (i = 0; i < run.artifactItems.length; i += 1) {
        artifactsHtml += '<a class="' + escapeHtml(run.artifactItems[i].kind) + '" href="' + escapeHtml(resolveHref(run.artifactItems[i].href)) + '" target="_blank">' + escapeHtml(run.artifactItems[i].label) + '</a>';
      }

      if (run.previewImageHref) {
        previewHtml = '<div class="preview-wrap"><a href="' + escapeHtml(resolveHref(run.previewImageHref)) + '" target="_blank"><img src="' + escapeHtml(resolveHref(run.previewImageHref)) + '" alt="Capture du run" /></a></div>';
      } else {
        previewHtml = '<div class="preview-empty">Aucune capture principale disponible pour cette execution.</div>';
      }

      detailActions += '<a class="primary" href="' + escapeHtml(resolveHref(run.resumeHref)) + '" target="_blank">Ouvrir le resume</a>';
      if (run.primaryCaptureHref) {
        detailActions += '<a href="' + escapeHtml(resolveHref(run.primaryCaptureHref)) + '" target="_blank">Capture principale</a>';
      }
      detailActions += '<a href="' + escapeHtml(resolveHref(run.jsonHref)) + '" target="_blank">JSON</a>';
      detailActions += '<a href="' + escapeHtml(resolveHref(run.logHref)) + '" target="_blank">Journal</a>';

      pane.innerHTML = ''
        + '<div class="detail-eyebrow">Detail du test</div>'
        + '<h2 class="detail-title">' + escapeHtml(run.candidateId) + '</h2>'
        + '<div class="detail-lead">' + escapeHtml(run.guidanceTitle || run.stageLabel) + '</div>'
        + '<div class="detail-actions">' + detailActions + '</div>'
        + '<div class="facts clearfix">' + factsHtml + '</div>'
        + '<div class="detail-section"><div class="detail-section-title">Etapes observees</div><div class="step-pills">' + stepsHtml + '</div></div>'
        + '<div class="logic-box success"><div class="logic-title">Lecture fonctionnelle</div><p>' + escapeHtml(run.guidanceDetail || 'Aucun commentaire fonctionnel disponible.') + '</p><div class="logic-action">' + escapeHtml(run.guidanceAction || 'Aucune action conseillee.') + '</div></div>'
        + '<div class="logic-box error"><div class="logic-title">Message en cas de KO</div><p>' + escapeHtml(run.errorMessage || 'Aucun message de blocage capture sur cette execution.') + '</p></div>'
        + '<div class="detail-section"><div class="detail-section-title">Capture principale</div>' + previewHtml + '<div class="muted-note">Les captures servent a verifier visuellement les informations remplies et le point de blocage s il y en a un.</div></div>'
        + '<div class="detail-section"><div class="detail-section-title">Fichiers du run</div><div class="artifact-list">' + artifactsHtml + '</div></div>';
    }

    function setScopeFilter(scope) {
      activeScope = scope;
      renderFilters();
      renderList();
    }

    function setStatusFilter(status) {
      activeStatus = status;
      renderFilters();
      renderList();
    }

    function selectRun(index) {
      selectedIndex = index;
      renderList();
    }

    document.getElementById('searchInput').onkeyup = function () {
      searchText = String(this.value || '').toLowerCase();
      renderList();
    };

    renderHero();
    renderMetrics();
    renderFilters();
    renderList();
  </script>
</body>
</html>`;
}

function createFunctionalSummary(summary, artifactPaths, runDir) {
  const resultLabel = summary.success ? 'SUCCES' : 'BLOCAGE';
  const paymentLabel = formatPaymentLabel(summary);
  const guidance = buildFunctionalGuidance(summary);
  const primaryArtifact = pickPrimaryArtifact(summary, artifactPaths);

  const lines = [
    'Resume fonctionnel',
    '==================',
    '',
    `Resultat : ${resultLabel}`,
    `Lecture rapide : ${guidance.title}`,
    `JDD : ${summary.jdd}`,
    `Date : ${summary.startedAtHuman}`,
    `Candidat : ${summary.candidateId || 'non determine'}`,
    `Ecole : ${summary.schoolLabel || summary.schoolSlug || 'non determine'}`,
    `URL : ${summary.schoolUrl || 'non determine'}`,
    `Profil : ${summary.profileId || summary.journeyGroup || 'non determine'}`,
    `Famille de structure : ${summary.structureGroup || 'non determine'}`,
    `Mode de selection page 1 : ${summary.page1SelectionMode || 'non determine'}`,
    `Mode de paiement : ${summary.paymentMode || 'non determine'}`,
    '',
    'Diagnostic',
    `- Ou ca bloque : ${summary.success ? 'Aucun blocage' : summary.blockedStep}`,
    `- Ce que cela signifie : ${guidance.detail}`,
    `- Action conseillee : ${guidance.action}`,
    '',
    'Etapes',
    `- Accueil : ${formatStepStatus(summary.steps.accueil)}`,
    `- Page 1 : ${formatStepStatus(summary.steps.page1)}`,
    `- Page 2 : ${formatStepStatus(summary.steps.page2)}`,
    `- Page 3 : ${formatStepStatus(summary.steps.page3)}`,
    `- Pieces jointes : ${summary.attachmentsLabel || 'non determine'}`,
    `- Paiement : ${paymentLabel}`,
    '',
  ];

  if (summary.success) {
    lines.push('Blocage');
    lines.push('- Aucun');
    lines.push('');
  } else {
    lines.push('Blocage');
    lines.push(`- Etape bloquante : ${summary.blockedStep}`);
    lines.push(`- Message : ${summary.errorMessage || 'non determine'}`);
    lines.push('');
  }

  lines.push('Fichiers utiles');
  if (primaryArtifact) {
    lines.push(`- Capture a ouvrir en priorite : ${relativeToProject(primaryArtifact)}`);
  }
  lines.push(`- Rapport technique : ${relativeToProject(path.join(runDir, 'run.log'))}`);
  lines.push(`- Rapport HTML : ${relativeToProject(path.join(runDir, 'resume-fonctionnel.html'))}`);
  lines.push(`- Rapport JSON : ${relativeToProject(path.join(runDir, 'resultat.json'))}`);

  for (const artifact of artifactPaths) {
    lines.push(`- ${relativeToProject(artifact)}`);
  }

  return `${lines.join('\n')}\n`;
}

function createFunctionalHtml(summary, artifactPaths, runDir) {
  const resultLabel = summary.success ? 'Succes' : 'Blocage';
  const paymentLabel = formatPaymentLabel(summary);
  const guidance = buildFunctionalGuidance(summary);
  const primaryArtifact = pickPrimaryArtifact(summary, artifactPaths);

  const rows = [
    ['Resultat', resultLabel],
    ['JDD', summary.jdd],
    ['Date', summary.startedAtHuman],
    ['Candidat', summary.candidateId || 'non determine'],
    ['Ecole', summary.schoolLabel || summary.schoolSlug || 'non determine'],
    ['URL', summary.schoolUrl || 'non determine'],
    ['Profil de formulaire', summary.profileId || summary.journeyGroup || 'non determine'],
    ['Famille de structure', summary.structureGroup || 'non determine'],
    ['Mode de selection page 1', summary.page1SelectionMode || 'non determine'],
    ['Mode de paiement', summary.paymentMode || 'non determine'],
    ['Accueil', formatStepStatus(summary.steps.accueil)],
    ['Page 1', formatStepStatus(summary.steps.page1)],
    ['Page 2', formatStepStatus(summary.steps.page2)],
    ['Page 3', formatStepStatus(summary.steps.page3)],
    ['Pieces jointes', summary.attachmentsLabel || 'non determine'],
    ['Paiement', paymentLabel],
  ];

  if (!summary.success) {
    rows.push(['Etape bloquante', summary.blockedStep]);
    rows.push(['Message', summary.errorMessage || 'non determine']);
  }

  const artifactLinks = [
    { label: 'Rapport technique', file: path.join(runDir, 'run.log') },
    { label: 'Rapport JSON', file: path.join(runDir, 'resultat.json') },
    ...artifactPaths.map((filePath) => ({ label: path.basename(filePath), file: filePath })),
  ];
  const primaryArtifactName = primaryArtifact ? path.basename(primaryArtifact) : '';

  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <title>Resume fonctionnel</title>
  <style>
    body { font-family: Segoe UI, Arial, sans-serif; margin: 32px; color: #1f2937; background: #f8fafc; }
    h1 { margin: 0 0 8px; }
    h2 { margin-top: 0; }
    .meta { margin-bottom: 24px; color: #475569; }
    .card { background: white; border: 1px solid #dbe2ea; border-radius: 12px; padding: 20px; margin-bottom: 20px; }
    .status { display: inline-block; padding: 8px 12px; border-radius: 999px; font-weight: 600; background: ${summary.success ? '#dcfce7' : '#fee2e2'}; color: ${summary.success ? '#166534' : '#991b1b'}; }
    .hero { display: grid; grid-template-columns: 1.2fr 1fr; gap: 20px; align-items: start; }
    .hero p { margin: 10px 0 0; line-height: 1.5; }
    .next-step { background: #f8fafc; border: 1px solid #dbe2ea; border-radius: 10px; padding: 16px; }
    .next-step strong { display: block; margin-bottom: 8px; color: #0f172a; }
    .focus { margin-top: 14px; }
    .focus a { font-weight: 600; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
    th { width: 220px; color: #475569; font-weight: 600; }
    ul { margin: 0; padding-left: 18px; }
    a { color: #0f766e; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .note { color: #475569; }
    .preview img { max-width: 100%; border-radius: 10px; border: 1px solid #dbe2ea; }
    @media (max-width: 900px) {
      .hero { grid-template-columns: 1fr; }
      body { margin: 20px; }
    }
  </style>
</head>
<body>
  <h1>Resume fonctionnel</h1>
  <div class="meta">Version simplifiee pour chef de projet / PO</div>
  <div class="card">
    <div class="hero">
      <div>
        <div class="status">${escapeHtml(resultLabel)}</div>
        <p><strong>${escapeHtml(guidance.title)}</strong></p>
        <p>${escapeHtml(guidance.detail)}</p>
      </div>
      <div class="next-step">
        <strong>Action conseillee</strong>
        <div>${escapeHtml(guidance.action)}</div>
        ${primaryArtifact ? `<div class="focus">Capture a ouvrir en priorite : <a href="${escapeHtml(path.basename(primaryArtifact))}">${escapeHtml(path.basename(primaryArtifact))}</a></div>` : ''}
      </div>
    </div>
  </div>
  <div class="card">
    <table>
      ${rows.map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`).join('')}
    </table>
  </div>
  <div class="card">
    <h2>Fichiers utiles</h2>
    <ul>
      ${artifactLinks.map((item) => `<li><a href="${escapeHtml(path.basename(item.file))}">${escapeHtml(item.label)}</a></li>`).join('')}
    </ul>
    <p class="note">Les captures d ecran montrent l etat final du parcours ou le point de blocage.</p>
  </div>
  ${primaryArtifactName ? `
  <div class="card preview">
    <h2>Capture principale</h2>
    <a href="${escapeHtml(primaryArtifactName)}"><img src="${escapeHtml(primaryArtifactName)}" alt="Capture principale du run" /></a>
  </div>` : ''}
</body>
</html>
`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const jddContext = loadJddContext(options);
  ensureDir(reportsRoot);
  ensureDir(businessRoot);

  if (options.refreshOnly) {
    const latestDir = path.join(businessRoot, 'latest');
    const stats = buildDashboardStats(businessRoot);
    const runResults = listRunResults(businessRoot);
    const dashboardHtml = createBusinessDashboardHtml(runResults, stats);
    fs.writeFileSync(path.join(businessRoot, 'stats.json'), JSON.stringify(stats, null, 2), 'utf8');
    fs.writeFileSync(path.join(businessRoot, 'dashboard-metier.html'), dashboardHtml, 'utf8');
    if (fs.existsSync(latestDir)) {
      fs.writeFileSync(path.join(latestDir, 'stats.json'), JSON.stringify(stats, null, 2), 'utf8');
      fs.writeFileSync(path.join(latestDir, 'dashboard-metier.html'), dashboardHtml, 'utf8');
    }
    console.log('Dashboard metier rafraichi.');
    return;
  }

  const stamp = process.env.CAMPAIGN_RUN_STAMP || nowStamp();
  const runName = `${stamp}-${sanitizeName(jddContext.schoolSlug || jddContext.baseName || path.basename(options.jdd, '.json'))}`;
  const runDir = path.join(businessRoot, runName);
  ensureDir(runDir);

  const beforeReportFiles = new Set(listRootReportFiles());
  const rawLogPath = path.join(runDir, 'run.log');
  const logStream = fs.createWriteStream(rawLogPath, { encoding: 'utf8' });

  const summary = {
    jdd: jddContext.fileName || options.jdd,
    jddPath: relativeToProject(jddContext.absolutePath),
    autoPayment: options.autoPayment,
    startedAt: new Date().toISOString(),
    startedAtHuman: new Date().toLocaleString('fr-FR'),
    candidateSourceId: jddContext.candidateSourceId,
    candidateId: '',
    schoolSlug: jddContext.schoolSlug,
    schoolLabel: jddContext.schoolLabel,
    schoolUrl: jddContext.schoolUrl,
    profileId: jddContext.profileId,
    structureGroup: jddContext.structureGroup,
    page1SelectionMode: jddContext.page1SelectionMode,
    paymentMode: jddContext.paymentMode,
    journeyGroup: jddContext.journeyGroup,
    campaignId: jddContext.campaignId,
    campaignTitle: jddContext.campaignTitle,
    campaignEnvironment: jddContext.campaignEnvironment,
    campaignBrowser: jddContext.campaignBrowser,
    campaignTool: jddContext.campaignTool,
    success: false,
    paymentStatus: options.autoPayment ? 'unknown' : 'skipped',
    steps: {
      accueil: 'pending',
      page1: 'pending',
      page2: 'pending',
      page3: 'pending',
    },
    attachmentsLabel: '',
    errorMessage: '',
    blockedStep: '',
  };

  const env = {
    ...process.env,
    JDD_FILE: options.jdd,
    JDD_ABS_FILE: jddContext.absolutePath,
    DEBUG_REQUIRED: '0',
    DEBUG_PAYMENT: process.env.DEBUG_PAYMENT || '0',
    AUTO_TEST_PAYMENT: options.autoPayment ? '1' : '0',
    PAYMENT_TEST_CARD: process.env.PAYMENT_TEST_CARD || '5017679110380400',
    PAYMENT_TEST_EXP: process.env.PAYMENT_TEST_EXP || '12/26',
    PAYMENT_TEST_CVV: process.env.PAYMENT_TEST_CVV || '123',
    SLOW_MO_MS: process.env.SLOW_MO_MS || '50',
    PAGE_PAUSE: '0',
    ALLOW_NATIVE_FILECHOOSER: process.env.ALLOW_NATIVE_FILECHOOSER || '1',
  };

  const child = spawn(process.execPath, [path.join(projectRoot, 'scripts', 'fillForm.js')], {
    cwd: projectRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const buffers = new Map();

  function handleLine(line) {
    const cleanLine = String(line || '').replace(/\r/g, '');
    logStream.write(`${cleanLine}\n`);
    if (!cleanLine.trim()) return;

    if (shouldEchoLine(cleanLine)) {
      console.log(cleanLine);
    }

    const startedMatch = cleanLine.match(/Demarrage\s*:\s*(.+)$/i);
    if (startedMatch) {
      summary.candidateId = startedMatch[1].trim();
    }

    if (/\[OK\]\s*Page accueil/i.test(cleanLine)) {
      summary.steps.accueil = 'ok';
    }
    if (/Page 1\/4 .* OK/i.test(cleanLine)) {
      summary.steps.page1 = 'ok';
    }
    if (/Page 2\/4 .* OK/i.test(cleanLine)) {
      summary.steps.page2 = 'ok';
    }
    if (/Page 3\/4 .* OK/i.test(cleanLine)) {
      summary.steps.page3 = 'ok';
    }

    const attachmentsMatch = cleanLine.match(/\[RESULT\]\s*(\d+)\/(\d+)\s+PJ obligatoires chargees/i);
    if (attachmentsMatch) {
      summary.attachmentsLabel = `${attachmentsMatch[1]}/${attachmentsMatch[2]} chargees`;
    }

    if (/Paiement test accepte/i.test(cleanLine)) {
      summary.paymentStatus = 'accepted';
    } else if (/Etape finale sans paiement atteinte/i.test(cleanLine)) {
      summary.paymentStatus = 'not-required';
    } else if (/Paiement refuse detecte/i.test(cleanLine)) {
      summary.paymentStatus = 'refused';
      if (!summary.errorMessage) {
        summary.errorMessage = cleanLine.replace(/^Error:\s*/i, '').trim();
      }
    } else if (/Statut detecte apres retour:\s*accepted/i.test(cleanLine)) {
      summary.paymentStatus = 'accepted';
    } else if (/Statut detecte apres retour:\s*refused/i.test(cleanLine)) {
      summary.paymentStatus = 'refused';
    }

    if (/Error:\s*/i.test(cleanLine) && !summary.errorMessage) {
      summary.errorMessage = cleanLine.replace(/^.*Error:\s*/i, '').trim();
    }
  }

  function wireStream(stream, key) {
    buffers.set(key, '');
    stream.on('data', (chunk) => {
      const current = buffers.get(key) + String(chunk);
      const parts = current.split('\n');
      buffers.set(key, parts.pop());
      parts.forEach(handleLine);
    });
    stream.on('end', () => {
      const rest = buffers.get(key);
      if (rest) handleLine(rest);
    });
  }

  wireStream(child.stdout, 'stdout');
  wireStream(child.stderr, 'stderr');

  const exitCode = await new Promise((resolve) => {
    child.on('close', resolve);
  });

  logStream.end();

  const finishedAt = new Date();
  summary.finishedAt = finishedAt.toISOString();
  summary.durationSeconds = Math.max(0, (finishedAt.getTime() - new Date(summary.startedAt).getTime()) / 1000);
  summary.success = exitCode === 0;
  if (!summary.success) {
    summary.blockedStep = inferBlockedStep(summary.errorMessage, summary.steps);
  }

  const afterReportFiles = listRootReportFiles();
  const newRootFiles = afterReportFiles.filter((filePath) => !beforeReportFiles.has(filePath));
  const artifactPaths = moveFilesToDir(newRootFiles, runDir);
  const primaryArtifact = pickPrimaryArtifact(summary, artifactPaths);
  const guidance = buildFunctionalGuidance(summary);

  const summaryJsonPath = path.join(runDir, 'resultat.json');
  const summaryTxtPath = path.join(runDir, 'resume-fonctionnel.txt');
  const summaryHtmlPath = path.join(runDir, 'resume-fonctionnel.html');

  fs.writeFileSync(summaryJsonPath, JSON.stringify({
    ...summary,
    guidance,
    primaryArtifact: primaryArtifact ? relativeToProject(primaryArtifact) : '',
    runDir: relativeToProject(runDir),
    artifacts: artifactPaths.map(relativeToProject),
  }, null, 2));

  fs.writeFileSync(summaryTxtPath, createFunctionalSummary(summary, artifactPaths, runDir), 'utf8');
  fs.writeFileSync(summaryHtmlPath, createFunctionalHtml(summary, artifactPaths, runDir), 'utf8');

  const latestDir = path.join(businessRoot, 'latest');
  fs.rmSync(latestDir, { recursive: true, force: true });
  fs.cpSync(runDir, latestDir, { recursive: true });

  const stats = buildDashboardStats(businessRoot);
  fs.writeFileSync(path.join(businessRoot, 'stats.json'), JSON.stringify(stats, null, 2), 'utf8');
  fs.writeFileSync(path.join(latestDir, 'stats.json'), JSON.stringify(stats, null, 2), 'utf8');

  const runResults = listRunResults(businessRoot);
  const dashboardHtml = createBusinessDashboardHtml(runResults, stats);
  fs.writeFileSync(path.join(businessRoot, 'dashboard-metier.html'), dashboardHtml, 'utf8');
  fs.writeFileSync(path.join(latestDir, 'dashboard-metier.html'), dashboardHtml, 'utf8');

  console.log('');
  console.log('=== Resume PM/PO ===');
  console.log(`Resultat : ${summary.success ? 'SUCCES' : 'BLOCAGE'}`);
  console.log(`Lecture rapide : ${guidance.title}`);
  console.log(`Etape : ${summary.success ? 'Parcours complet termine' : summary.blockedStep}`);
  if (summary.attachmentsLabel) {
    console.log(`Pieces jointes : ${summary.attachmentsLabel}`);
  }
  console.log(`Paiement : ${summary.paymentStatus}`);
  if (summary.errorMessage) {
    console.log(`Message : ${summary.errorMessage}`);
  }
  console.log(`Resume : ${relativeToProject(path.join(latestDir, 'resume-fonctionnel.html'))}`);
  console.log(`Dossier : ${relativeToProject(latestDir)}`);

  process.exitCode = exitCode;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
