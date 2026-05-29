const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const { getCampaign } = require('../scripts/campaignConfig');
const { buildCampaignPayload, getSchoolSlugsByStatus } = require('../scripts/campaignResults');

const PORT = 4173;
const HOST = '127.0.0.1';
const ROOT = __dirname;
const PROJECT_ROOT = path.resolve(__dirname, '..');
const CAMPAIGN_ID = 'tnr-front-recette';
const EXECUTION_LOCK_PATH = path.join(PROJECT_ROOT, 'data', '.campaign-execution-lock.json');

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const jobs = new Map();
let lastStaticProbe = {
  at: '',
  pathname: '',
  assetPath: '',
  absolutePath: '',
  exists: false,
  error: '',
};

function readJsonIfExists(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
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

function getExternalExecutionLock() {
  const lock = readJsonIfExists(EXECUTION_LOCK_PATH);
  if (!lock) return null;
  if (!isPidRunning(lock.pid)) {
    try {
      fs.rmSync(EXECUTION_LOCK_PATH, { force: true });
    } catch {
      // ignore
    }
    return null;
  }
  return lock;
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(payload));
}

function sendText(response, statusCode, message) {
  response.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(message);
}

function safeStat(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const stat = fs.statSync(filePath);
    return {
      isFile: stat.isFile(),
      isDirectory: stat.isDirectory(),
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    };
  } catch (error) {
    return { error: String(error?.message || error) };
  }
}

function parseBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      if (!chunks.length) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        reject(new Error('Payload JSON invalide.'));
      }
    });
    request.on('error', reject);
  });
}

function createStaticFilePath(cleanUrl) {
  const requestedPath = cleanUrl === '/' ? 'index.html' : String(cleanUrl).replace(/^\/+/, '');
  const filePath = path.normalize(path.join(ROOT, requestedPath));
  if (!filePath.startsWith(ROOT)) {
    return null;
  }
  return filePath;
}

function serveStaticDashboardAsset(response, pathname) {
  const cleanPath = String(pathname || '/')
    .replace(/\/+/g, '/')
    .replace(/^\/+/, '');

  const assetPath = cleanPath || 'index.html';
  const absolutePath = path.resolve(ROOT, assetPath);
  const exists = absolutePath.startsWith(ROOT) && fs.existsSync(absolutePath);
  lastStaticProbe = {
    at: new Date().toISOString(),
    pathname: String(pathname || ''),
    assetPath,
    absolutePath,
    exists,
    error: '',
  };
  serveFile(response, absolutePath);
}

function serveFile(response, absolutePath) {
  fs.readFile(absolutePath, (error, content) => {
    if (error) {
      lastStaticProbe = {
        ...lastStaticProbe,
        at: new Date().toISOString(),
        absolutePath,
        exists: fs.existsSync(absolutePath),
        error: `${error.code || 'ERR'}: ${error.message || error}`,
      };
      sendText(response, 404, 'Fichier introuvable');
      return;
    }

    const ext = path.extname(absolutePath).toLowerCase();
    response.writeHead(200, {
      'Content-Type': CONTENT_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    response.end(content);
  });
}

function resolveProjectFile(relativePath) {
  const normalized = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const absolutePath = path.resolve(PROJECT_ROOT, normalized);
  if (!absolutePath.startsWith(PROJECT_ROOT)) {
    return '';
  }
  return absolutePath;
}

function getRunningJob() {
  for (const job of jobs.values()) {
    if (job.status === 'queued' || job.status === 'running') {
      return job;
    }
  }
  return null;
}

function appendJobLog(job, chunk) {
  const lines = String(chunk || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const queueMatch = line.match(/^\[QUEUE\]\s+(\d+)\/(\d+)\s+(.+)\s+\(([^)]+)\)$/);
    if (queueMatch) {
      job.currentIndex = Number(queueMatch[1]);
      job.totalSchools = Number(queueMatch[2]) || job.totalSchools;
      job.currentSchoolLabel = queueMatch[3];
      job.currentSchoolSlug = queueMatch[4];
    }

    const schoolMatch = line.match(/^\[SCHOOL\]\s+(.+)\s+\(([^)]+)\)$/);
    if (schoolMatch) {
      job.currentSchoolLabel = schoolMatch[1];
      job.currentSchoolSlug = schoolMatch[2];
    }

    const doneMatch = line.match(/^\[DONE\]\s+(.+)\s+\(([^)]+)\)\s+=>\s+(OK|KO)$/);
    if (doneMatch) {
      job.completedSchools = Math.min((job.completedSchools || 0) + 1, job.totalSchools || 0);
      job.lastFinishedSchoolLabel = doneMatch[1];
      job.lastFinishedSchoolSlug = doneMatch[2];
      job.lastFinishedStatus = doneMatch[3] === 'OK' ? 'passed' : 'failed';
    }

    job.logLines.push(line);
    if (job.logLines.length > 300) {
      job.logLines.shift();
    }
  }
}

function resolveSchoolSlugs(mode, schoolSlug) {
  const campaign = getCampaign(CAMPAIGN_ID);

  if (mode === 'all') {
    return campaign.schools.map((school) => school.slug);
  }
  if (mode === 'failed') {
    return getSchoolSlugsByStatus(PROJECT_ROOT, CAMPAIGN_ID, 'failed');
  }
  if (mode === 'blocked') {
    return getSchoolSlugsByStatus(PROJECT_ROOT, CAMPAIGN_ID, 'blocked');
  }
  if (mode === 'school' && schoolSlug) {
    return [String(schoolSlug).trim().toLowerCase()];
  }

  throw new Error('Mode de relance non supporte.');
}

function createJob(mode, schoolSlug, autoPayment = true) {
  const runningJob = getRunningJob();
  if (runningJob) {
    throw new Error('Une execution est deja en cours. Attends la fin avant de relancer.');
  }

  const externalLock = getExternalExecutionLock();
  if (externalLock) {
    const labels = Array.isArray(externalLock.schools) ? externalLock.schools.join(', ') : 'inconnues';
    throw new Error(`Une execution est deja en cours sur ce poste pour ${labels}. Attends la fin avant de relancer.`);
  }

  const schoolSlugs = resolveSchoolSlugs(mode, schoolSlug);
  if (!schoolSlugs.length) {
    throw new Error('Aucune ecole ne correspond au filtre de relance choisi.');
  }

  const jobId = `${Date.now()}-${mode}`;
  const job = {
    id: jobId,
    mode,
    schoolSlug: schoolSlug || '',
    schoolSlugs,
    totalSchools: schoolSlugs.length,
    autoPayment: Boolean(autoPayment),
    status: 'queued',
    startedAt: new Date().toISOString(),
    finishedAt: '',
    exitCode: null,
    logLines: [],
    currentIndex: 0,
    currentSchoolLabel: '',
    currentSchoolSlug: '',
    completedSchools: 0,
  };

  jobs.set(jobId, job);

  const args = [
    path.join(PROJECT_ROOT, 'scripts', 'runCampaign.js'),
    '--campaign', CAMPAIGN_ID,
    '--schools', schoolSlugs.join(','),
  ];
  if (!autoPayment) {
    args.push('--no-payment');
  }

  const child = spawn(process.execPath, args, {
    cwd: PROJECT_ROOT,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  job.status = 'running';
  appendJobLog(job, `[JOB] Demarrage de la campagne pour ${schoolSlugs.join(', ')}`);

  child.stdout.on('data', (chunk) => appendJobLog(job, chunk));
  child.stderr.on('data', (chunk) => appendJobLog(job, chunk));
  child.on('close', (code) => {
    job.finishedAt = new Date().toISOString();
    job.exitCode = code;
    job.status = code === 0 ? 'completed' : 'completed-with-issues';
    appendJobLog(job, `[JOB] Fin de campagne code=${code}`);
  });

  return job;
}

async function handleApi(request, response, url) {
  if (request.method === 'GET' && url.pathname === '/api/health') {
    sendJson(response, 200, { ok: true });
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/debug/static') {
    const indexPath = path.join(ROOT, 'index.html');
    const assetsDir = path.join(ROOT, 'assets');
    const assetList = (() => {
      try {
        if (!fs.existsSync(assetsDir)) return [];
        return fs.readdirSync(assetsDir).slice(0, 50);
      } catch {
        return [];
      }
    })();
    const sampleAsset = assetList.length ? path.join(assetsDir, assetList[0]) : path.join(assetsDir, 'index-C7mEPskQ.js');

    sendJson(response, 200, {
      pid: process.pid,
      execPath: process.execPath,
      cwd: process.cwd(),
      ROOT,
      PROJECT_ROOT,
      indexPath,
      indexStat: safeStat(indexPath),
      assetsDir,
      assetsStat: safeStat(assetsDir),
      assetList,
      sampleAsset,
      sampleAssetStat: safeStat(sampleAsset),
      lastStaticProbe,
    });
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/campaign-data') {
    sendJson(response, 200, buildCampaignPayload(PROJECT_ROOT, CAMPAIGN_ID));
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/campaign-summary') {
    const summaryPath = path.join(PROJECT_ROOT, 'reports', 'business', 'latest', 'campaign-summary.json');
    const summary = readJsonIfExists(summaryPath);
    if (!summary) {
      sendJson(response, 404, { error: 'Aucun résumé de campagne disponible.' });
      return true;
    }
    sendJson(response, 200, summary);
    return true;
  }

  if (request.method === 'GET' && url.pathname.startsWith('/api/jobs/')) {
    const jobId = url.pathname.split('/').pop();
    const job = jobs.get(jobId);
    if (!job) {
      sendJson(response, 404, { error: 'Job introuvable.' });
      return true;
    }
    sendJson(response, 200, job);
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/execute') {
    try {
      const body = await parseBody(request);
      const job = createJob(body.mode || 'all', body.schoolSlug || '', body.autoPayment !== false);
      sendJson(response, 202, job);
    } catch (error) {
      sendJson(response, 400, { error: error.message || 'Impossible de lancer la campagne.' });
    }
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/file') {
    const relativePath = url.searchParams.get('path') || '';
    const absolutePath = resolveProjectFile(relativePath);
    if (!absolutePath) {
      sendText(response, 403, 'Acces refuse');
      return true;
    }
    serveFile(response, absolutePath);
    return true;
  }

  return false;
}

const server = http.createServer(async (request, response) => {
  const currentUrl = new URL(request.url || '/', `http://${HOST}:${PORT}`);
  const handled = await handleApi(request, response, currentUrl);
  if (handled) return;

  if (request.method === 'GET' && (currentUrl.pathname === '/' || currentUrl.pathname === '/index.html' || currentUrl.pathname.startsWith('/assets/'))) {
    serveStaticDashboardAsset(response, currentUrl.pathname);
    return;
  }

  const filePath = createStaticFilePath(currentUrl.pathname);
  if (!filePath) {
    sendText(response, 403, 'Acces refuse');
    return;
  }

  serveFile(response, filePath);
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.log(`Le dashboard QA semble deja lance sur http://${HOST}:${PORT}`);
    process.exit(0);
    return;
  }

  console.error('Erreur serveur :', error.message);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`Dashboard QA disponible sur http://${HOST}:${PORT}`);
  console.log('Laisse cette fenetre ouverte pendant la consultation.');
});
