const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const { getCampaign } = require('../scripts/campaignConfig');
const { buildCampaignPayload, getSchoolSlugsByStatus } = require('../scripts/campaignResults');

const PORT = 4173;
const HOST = '127.0.0.1';
const ROOT = __dirname;
const PROJECT_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(PROJECT_ROOT, '..');
const CAMPAIGN_ID = 'tnr-front-recette';
const ALLOWED_CAMPAIGN_IDS = new Set(['tnr-front-recette', 'tnr-front-integration', 'tnr-front-preprod']);
const EXECUTION_LOCK_PATH = path.join(PROJECT_ROOT, 'data', '.campaign-execution-lock.json');
const DASHBOARD_USAGE_PATH = path.join(PROJECT_ROOT, 'data', 'dashboard-usage.json');
const ADMIN_USERS_PATH = path.join(PROJECT_ROOT, 'data', 'admin-users.json');
const { buildUnderstoodPlan, buildManualExecutionPlan } = require(path.join(REPO_ROOT, 'agent', 'executionPlan'));

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
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
};

const jobs = new Map();
const jobProcesses = new Map();
const qaJobs = new Map();
const SQUASH_CATALOG_CACHE_PATH = path.join(PROJECT_ROOT, 'data', 'squash-catalog-cache.json');
const SQUASH_PAYLOAD_DIR = path.join(PROJECT_ROOT, 'data', '.squash-execution-payloads');
const MANUAL_SCENARIO_DIR = path.join(PROJECT_ROOT, 'data', '.manual-scenarios');
const JIRA_AUTH_ROOT = path.join(REPO_ROOT, '.auth', 'jira');
const JIRA_STORAGE_STATE_PATH = path.join(JIRA_AUTH_ROOT, 'storage-state.json');
const JIRA_LOGIN_SCRIPT = path.join(PROJECT_ROOT, 'scripts', 'apps', 'jira', 'loginSession.js');
const JIRA_ANOMALY_STORE_PATH = path.join(PROJECT_ROOT, 'data', 'jira-anomalies.json');
const JIRA_BASE_URL = (process.env.JIRA_BASE_URL || 'https://inseec-transfo-si.atlassian.net').replace(/\/$/, '');
const JIRA_PROJECT_KEY = process.env.JIRA_PROJECT_KEY || 'FDC';
const JIRA_ISSUE_TYPE_CANDIDATES = (process.env.JIRA_ISSUE_TYPE_NAME || 'Bug,Anomalie,Task,Tâche,Incident')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
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

function summarizeJiraStoredSession() {
  const authExists = fs.existsSync(JIRA_AUTH_ROOT);
  const storageStat = safeStat(JIRA_STORAGE_STATE_PATH);
  const storageState = readJsonIfExists(JIRA_STORAGE_STATE_PATH);
  const cookies = Array.isArray(storageState?.cookies) ? storageState.cookies : [];
  const origins = Array.isArray(storageState?.origins) ? storageState.origins : [];
  const domains = Array.from(new Set(cookies.map((cookie) => String(cookie.domain || '').trim()).filter(Boolean))).sort();
  const expiringCookies = cookies
    .map((cookie) => Number(cookie.expires || 0))
    .filter((expires) => Number.isFinite(expires) && expires > 0)
    .sort((a, b) => a - b);
  const soonestExpiry = expiringCookies[0] ? new Date(expiringCookies[0] * 1000).toISOString() : '';
  const latestExpiry = expiringCookies[expiringCookies.length - 1] ? new Date(expiringCookies[expiringCookies.length - 1] * 1000).toISOString() : '';
  const nowSec = Math.floor(Date.now() / 1000);
  const hasUnexpiredCookie = expiringCookies.some((expires) => expires > nowSec) || cookies.some((cookie) => Number(cookie.expires) === -1);
  const hasJiraDomain = domains.some((domain) => /atlassian\.com|atlassian\.net|jira/i.test(domain));

  return {
    configured: true,
    authRoot: JIRA_AUTH_ROOT,
    storageStatePath: JIRA_STORAGE_STATE_PATH,
    authExists,
    storageStateExists: Boolean(storageStat?.isFile),
    storageStateModifiedAt: storageStat?.mtimeMs ? new Date(storageStat.mtimeMs).toISOString() : '',
    storageStateSize: storageStat?.size || 0,
    cookieCount: cookies.length,
    originCount: origins.length,
    domains,
    soonestCookieExpiry: soonestExpiry,
    latestCookieExpiry: latestExpiry,
    hasJiraDomain,
    hasUnexpiredCookie,
    likelyStoredSession: authExists && Boolean(storageStat?.isFile) && cookies.length > 0 && hasJiraDomain && hasUnexpiredCookie,
    liveValidation: 'not_run',
    message: authExists && storageStat?.isFile
      ? 'Session Jira locale trouvee. Cette route ne lance pas le navigateur; elle ne valide pas le login en direct.'
      : 'Aucune session Jira locale trouvee. Lance la connexion Jira pour recreer .auth/jira.',
  };
}

function launchJiraLoginWindow() {
  if (!fs.existsSync(JIRA_LOGIN_SCRIPT)) {
    throw new Error('Script de connexion Jira introuvable.');
  }
  const child = spawn(process.execPath, [JIRA_LOGIN_SCRIPT], {
    cwd: PROJECT_ROOT,
    env: { ...process.env },
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.unref();
  return child.pid || null;
}

function normalizeJiraText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function jiraAnomalyFingerprint(anomaly = {}) {
  const parts = [
    anomaly.schoolName,
    anomaly.environment,
    anomaly.module,
    anomaly.anomalyType,
    anomaly.errorMessage,
    anomaly.scenario,
  ].map((value) => normalizeJiraText(value).toLowerCase());
  return crypto.createHash('sha1').update(parts.join('|')).digest('hex');
}

function getJiraAnomalyStore() {
  const store = readJsonIfExists(JIRA_ANOMALY_STORE_PATH) || {};
  return store && typeof store === 'object' ? store : {};
}

function saveJiraAnomalyStore(store) {
  writeJsonFile(JIRA_ANOMALY_STORE_PATH, store);
}

function jiraIssueUrl(issueKey) {
  return issueKey ? `${JIRA_BASE_URL}/browse/${encodeURIComponent(issueKey)}` : '';
}

function buildJiraSummary(anomaly = {}) {
  const env = normalizeJiraText(anomaly.environment || 'REC') || 'REC';
  const school = normalizeJiraText(anomaly.schoolName || 'École non renseignée') || 'École non renseignée';
  const type = normalizeJiraText(anomaly.anomalyType || 'Anomalie QA') || 'Anomalie QA';
  return `[QA NewForm][${env}] ${school} - ${type}`.slice(0, 250);
}

function buildJiraDescriptionLines(anomaly = {}, fingerprint = '') {
  return [
    'Ticket créé depuis le Dashboard QA NewForm.',
    '',
    `Empreinte bug: ${fingerprint}`,
    `École: ${anomaly.schoolName || '-'}`,
    `Environnement: ${anomaly.environment || '-'}`,
    `Module: ${anomaly.module || '-'}`,
    `Type anomalie: ${anomaly.anomalyType || '-'}`,
    `Criticité: ${anomaly.criticality || '-'}`,
    `Date exécution: ${anomaly.executionDate || '-'}`,
    `Scénario: ${anomaly.scenario || '-'}`,
    '',
    'Erreur / constat:',
    anomaly.errorMessage || anomaly.summary || '-',
    '',
    'Étape bloquée:',
    anomaly.blockedStep || '-',
    '',
    'Preuve:',
    anomaly.proofUrl || anomaly.resumeUrl || '-',
  ];
}

function jiraTextDoc(lines = []) {
  return {
    type: 'doc',
    version: 1,
    content: lines.map((line) => ({
      type: 'paragraph',
      content: line ? [{ type: 'text', text: String(line) }] : [],
    })),
  };
}

function escapeJqlText(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function jiraApiJson(context, method, pathname, payload = null) {
  const response = await context.request.fetch(`${JIRA_BASE_URL}${pathname}`, {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Atlassian-Token': 'no-check',
    },
    data: payload ? JSON.stringify(payload) : undefined,
    timeout: 60000,
  });
  const text = await response.text().catch(() => '');
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { ok: response.ok(), status: response.status(), json, text };
}

async function withJiraContext(callback) {
  if (!fs.existsSync(JIRA_STORAGE_STATE_PATH)) {
    throw new Error('Session Jira introuvable. Clique sur Ouvrir connexion Jira pour créer la session locale.');
  }
  const browser = await chromium.launch({
    headless: true,
    ignoreHTTPSErrors: true,
    channel: process.env.PW_CHANNEL || undefined,
  });
  const context = await browser.newContext({
    storageState: JIRA_STORAGE_STATE_PATH,
    ignoreHTTPSErrors: true,
  });
  try {
    const me = await jiraApiJson(context, 'GET', '/rest/api/3/myself');
    if (!me.ok) {
      throw new Error(`Session Jira non valide ou expirée (${me.status}). Ouvre la connexion Jira puis réessaie.`);
    }
    return await callback(context);
  } finally {
    await context.storageState({ path: JIRA_STORAGE_STATE_PATH }).catch(() => null);
    await context.close().catch(() => null);
    await browser.close().catch(() => null);
  }
}

async function searchExistingJiraIssue(context, anomaly = {}, fingerprint = '') {
  const store = getJiraAnomalyStore();
  if (store[fingerprint]?.jiraKey) {
    return {
      key: store[fingerprint].jiraKey,
      url: store[fingerprint].jiraUrl || jiraIssueUrl(store[fingerprint].jiraKey),
      status: store[fingerprint].jiraStatus || '',
      statusCategory: store[fingerprint].jiraStatusCategory || '',
      source: 'local-store',
    };
  }

  const school = escapeJqlText(normalizeJiraText(anomaly.schoolName || ''));
  const moduleName = escapeJqlText(normalizeJiraText(anomaly.module || 'NewForm'));
  const jql = school
    ? `project = ${JIRA_PROJECT_KEY} AND text ~ "${school}" ORDER BY created DESC`
    : `project = ${JIRA_PROJECT_KEY} ORDER BY created DESC`;
  const search = await jiraApiJson(
    context,
    'GET',
    `/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=25&fields=summary,status,description`
  );
  if (!search.ok) return null;

  const wanted = [
    normalizeJiraText(anomaly.schoolName).toLowerCase(),
    normalizeJiraText(anomaly.environment).toLowerCase(),
    normalizeJiraText(anomaly.anomalyType).toLowerCase(),
  ].filter(Boolean);
  const issues = Array.isArray(search.json?.issues) ? search.json.issues : [];
  const found = issues.find((issue) => {
    const haystack = normalizeJiraText(`${issue.fields?.summary || ''} ${JSON.stringify(issue.fields?.description || {})}`).toLowerCase();
    return haystack.includes(fingerprint) || wanted.every((part) => haystack.includes(part)) || (moduleName && haystack.includes(moduleName.toLowerCase()) && wanted.slice(0, 2).every((part) => haystack.includes(part)));
  });
  if (!found?.key) return null;
  return {
    key: found.key,
    url: jiraIssueUrl(found.key),
    status: found.fields?.status?.name || '',
    statusCategory: found.fields?.status?.statusCategory?.key || found.fields?.status?.statusCategory?.name || '',
    source: 'jira-search',
  };
}

async function createJiraIssueFromAnomaly(anomaly = {}) {
  const fingerprint = jiraAnomalyFingerprint(anomaly);
  const summary = buildJiraSummary(anomaly);
  const description = jiraTextDoc(buildJiraDescriptionLines(anomaly, fingerprint));

  return withJiraContext(async (context) => {
    const existing = await searchExistingJiraIssue(context, anomaly, fingerprint);
    if (existing?.key) {
      const store = getJiraAnomalyStore();
      store[fingerprint] = {
        ...(store[fingerprint] || {}),
        fingerprint,
        anomaly,
        summary,
        jiraKey: existing.key,
        jiraUrl: existing.url,
        jiraStatus: existing.status,
        jiraStatusCategory: existing.statusCategory,
        alreadyExists: true,
        updatedAt: new Date().toISOString(),
      };
      saveJiraAnomalyStore(store);
      return {
        success: true,
        alreadyExists: true,
        jiraKey: existing.key,
        jiraUrl: existing.url,
        jiraStatus: existing.status,
        jiraStatusCategory: existing.statusCategory,
      };
    }

    let lastError = null;
    for (const issueTypeName of JIRA_ISSUE_TYPE_CANDIDATES) {
      const payload = {
        fields: {
          project: { key: JIRA_PROJECT_KEY },
          summary,
          description,
          issuetype: { name: issueTypeName },
        },
      };
      const created = await jiraApiJson(context, 'POST', '/rest/api/3/issue', payload);
      if (created.ok && created.json?.key) {
        const issueKey = created.json.key;
        const store = getJiraAnomalyStore();
        store[fingerprint] = {
          fingerprint,
          anomaly,
          summary,
          jiraKey: issueKey,
          jiraUrl: jiraIssueUrl(issueKey),
          jiraStatus: '',
          jiraStatusCategory: '',
          alreadyExists: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        saveJiraAnomalyStore(store);
        return {
          success: true,
          alreadyExists: false,
          jiraKey: issueKey,
          jiraUrl: jiraIssueUrl(issueKey),
          jiraStatus: '',
          jiraStatusCategory: '',
        };
      }
      lastError = created.json?.errors
        ? JSON.stringify(created.json.errors)
        : (created.json?.errorMessages || created.text || `HTTP ${created.status}`);
    }
    throw new Error(`Création Jira impossible dans le projet ${JIRA_PROJECT_KEY}. Dernière erreur: ${lastError || 'inconnue'}`);
  });
}

async function listJiraIssues(query = '') {
  return withJiraContext(async (context) => {
    const cleanQuery = normalizeJiraText(query);
    const jql = cleanQuery
      ? `project = ${JIRA_PROJECT_KEY} AND text ~ "${escapeJqlText(cleanQuery)}" ORDER BY updated DESC`
      : `project = ${JIRA_PROJECT_KEY} ORDER BY updated DESC`;
    const result = await jiraApiJson(
      context,
      'GET',
      `/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=30&fields=summary,status,priority,issuetype,updated`
    );
    if (!result.ok) {
      throw new Error(result.json?.errorMessages?.join(' ') || result.text || `Recherche Jira impossible (${result.status}).`);
    }
    return (Array.isArray(result.json?.issues) ? result.json.issues : []).map((issue) => ({
      key: issue.key || '',
      title: issue.fields?.summary || '',
      url: jiraIssueUrl(issue.key),
      status: issue.fields?.status?.name || '',
      priority: issue.fields?.priority?.name || '',
      type: issue.fields?.issuetype?.name || '',
      updated: issue.fields?.updated || '',
    }));
  });
}

function writeJsonFile(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

function cleanDashboardText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function getDashboardUsage() {
  const usage = readJsonIfExists(DASHBOARD_USAGE_PATH) || {};
  return {
    createdAt: usage.createdAt || new Date().toISOString(),
    updatedAt: usage.updatedAt || '',
    totalHits: Number(usage.totalHits || 0),
    uniqueUsers: usage.uniqueUsers && typeof usage.uniqueUsers === 'object' ? usage.uniqueUsers : {},
  };
}

function summarizeDashboardUsage(usage) {
  const users = Object.values(usage.uniqueUsers || {});
  const now = Date.now();
  const activeToday = users.filter((user) => {
    const lastSeen = Date.parse(user.lastSeen || '');
    return Number.isFinite(lastSeen) && now - lastSeen < 24 * 60 * 60 * 1000;
  }).length;
  return {
    totalHits: Number(usage.totalHits || 0),
    uniqueUsers: users.length,
    activeToday,
    lastSeen: usage.updatedAt || '',
  };
}

function dashboardUsageDetails() {
  const usage = getDashboardUsage();
  const sessions = Object.entries(usage.uniqueUsers || {})
    .map(([sessionId, user]) => ({
      sessionId,
      firstSeen: user.firstSeen || '',
      lastSeen: user.lastSeen || '',
      hits: Number(user.hits || 0),
      pages: user.pages && typeof user.pages === 'object' ? user.pages : {},
      lastPage: user.lastPage || '',
      userName: user.userName || '',
    }))
    .sort((left, right) => String(right.lastSeen || '').localeCompare(String(left.lastSeen || '')));
  return { ...summarizeDashboardUsage(usage), sessions };
}

function trackDashboardUsage(sessionId, details = {}) {
  const cleanSessionId = String(sessionId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
  const cleanPage = String(details.page || '').replace(/[^\w./#-]/g, '').slice(0, 120) || 'dashboard';
  const usage = getDashboardUsage();
  const now = new Date().toISOString();
  const id = cleanSessionId || `anonymous-${Date.now()}`;
  const existing = usage.uniqueUsers[id] || { firstSeen: now, hits: 0, pages: {} };
  const pages = existing.pages && typeof existing.pages === 'object' ? existing.pages : {};
  pages[cleanPage] = Number(pages[cleanPage] || 0) + 1;
  usage.uniqueUsers[id] = {
    ...existing,
    lastSeen: now,
    hits: Number(existing.hits || 0) + 1,
    pages,
    lastPage: cleanPage,
    userName: cleanDashboardText(details.userName || details.user || existing.userName || ''),
  };
  usage.totalHits = Number(usage.totalHits || 0) + 1;
  usage.updatedAt = now;
  try {
    writeJsonFile(DASHBOARD_USAGE_PATH, usage);
  } catch {
    // Le compteur d'utilisation ne doit jamais faire tomber le dashboard.
  }
  return summarizeDashboardUsage(usage);
}

function getAdminUsers() {
  const data = readJsonIfExists(ADMIN_USERS_PATH) || {};
  const users = Array.isArray(data.users) ? data.users : [];
  return {
    updatedAt: data.updatedAt || '',
    users: users.map((user) => ({
      id: String(user.id || user.email || `user-${Date.now()}`).slice(0, 120),
      name: cleanDashboardText(user.name || ''),
      email: cleanDashboardText(user.email || ''),
      role: cleanDashboardText(user.role || 'QA'),
      status: cleanDashboardText(user.status || 'Actif'),
      scope: cleanDashboardText(user.scope || 'NewForm / Eudonet'),
      createdAt: user.createdAt || '',
      updatedAt: user.updatedAt || '',
    })),
  };
}

function saveAdminUsers(users) {
  const payload = { updatedAt: new Date().toISOString(), users };
  writeJsonFile(ADMIN_USERS_PATH, payload);
  return payload;
}

function upsertAdminUser(input = {}) {
  const now = new Date().toISOString();
  const store = getAdminUsers();
  const email = cleanDashboardText(input.email || '').toLowerCase();
  const id = cleanDashboardText(input.id || email || `user-${Date.now()}`);
  const nextUser = {
    id,
    name: cleanDashboardText(input.name || email || 'Utilisateur'),
    email,
    role: cleanDashboardText(input.role || 'QA'),
    status: cleanDashboardText(input.status || 'Actif'),
    scope: cleanDashboardText(input.scope || 'NewForm / Eudonet'),
    createdAt: input.createdAt || now,
    updatedAt: now,
  };
  const users = [...store.users];
  const existingIndex = users.findIndex((user) => user.id === id || (email && user.email === email));
  if (existingIndex >= 0) {
    users[existingIndex] = { ...users[existingIndex], ...nextUser, createdAt: users[existingIndex].createdAt || now };
  } else {
    users.push(nextUser);
  }
  return saveAdminUsers(users);
}

function deleteAdminUser(idOrEmail) {
  const key = cleanDashboardText(idOrEmail || '').toLowerCase();
  const store = getAdminUsers();
  return saveAdminUsers(store.users.filter((user) => (
    String(user.id || '').toLowerCase() !== key && String(user.email || '').toLowerCase() !== key
  )));
}

function normalizeEnvironment(value) {
  const text = String(value || '').toUpperCase();
  if (text.includes('INT')) return 'INT';
  if (text.includes('PRE')) return 'PREPROD';
  return 'REC';
}

function formatManualScenarioPlan(plan) {
  const steps = Array.isArray(plan?.steps) ? plan.steps : [];
  return {
    valid: Boolean(plan?.valid),
    title: plan?.title || 'Scenario personnalise',
    summary: plan?.summary || '',
    stats: plan?.stats || { total: steps.length, supported: steps.filter((step) => step.supported).length, unsupported: steps.filter((step) => !step.supported).length },
    blockedReason: plan?.blockedReason || '',
    actions: plan?.actions || {},
    steps: steps.map((step) => ({
      order: step.order,
      text: step.text,
      action: step.actionLabel || step.actionId || '',
      actionId: step.actionId || '',
      supported: Boolean(step.supported),
      inferred: Boolean(step.inferred),
      reason: step.reason || '',
    })),
    unsupportedSteps: steps
      .filter((step) => !step.supported)
      .map((step) => ({
        order: step.order,
        text: step.text,
        action: step.actionLabel || step.actionId || '',
        actionId: step.actionId || '',
        reason: step.reason || '',
      })),
  };
}

function serializeQaJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    type: job.type,
    source: job.source,
    status: job.status,
    project: job.project,
    environment: job.environment,
    campaign: job.campaign,
    scenario: job.scenario,
    scenarioConfig: job.scenarioConfig || null,
    currentStep: job.currentStep || '',
    currentSchoolLabel: job.currentSchoolLabel || '',
    currentSchoolSlug: job.currentSchoolSlug || '',
    pid: job.pid || null,
    results: Array.isArray(job.results) ? job.results : [],
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    errorMessage: job.errorMessage || '',
    logLines: job.logLines || [],
    liveBrowser: {
      projectName: job.project || 'NewForm',
      executionId: job.id,
      executionType: job.executionType || 'Execution agent',
      liveUrl: '',
      status: job.status,
      mode: 'local',
      headless: {},
      liveUrlConfigured: false,
    },
  };
}

function getRunningQaJob() {
  for (const job of qaJobs.values()) {
    if (job.status === 'queued' || job.status === 'running') {
      return job;
    }
  }
  return null;
}

function appendQaLog(job, message) {
  job.logLines.push(`[${new Date().toLocaleTimeString('fr-FR')}] ${message}`);
  if (job.logLines.length > 120) job.logLines.shift();
}

function appendQaChunk(job, chunk) {
  String(chunk || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => appendQaLog(job, line));
}

function campaignIdFromEnvironment(environment) {
  const env = normalizeEnvironment(environment);
  if (env === 'INT') return 'tnr-front-integration';
  if (env === 'PREPROD') return 'tnr-front-preprod';
  return CAMPAIGN_ID;
}

function normalizeCampaignId(campaignId) {
  const value = String(campaignId || CAMPAIGN_ID).trim();
  return ALLOWED_CAMPAIGN_IDS.has(value) ? value : CAMPAIGN_ID;
}

function runNodeStep(scriptPath, args = [], options = {}) {
  return new Promise((resolve) => {
    let child = null;
    try {
      child = spawn(process.execPath, [scriptPath, ...args], {
        cwd: options.cwd || PROJECT_ROOT,
        env: { ...process.env, ...(options.env || {}) },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      resolve({ code: 1, stdout: '', stderr: error.message || String(error) });
      return;
    }

    if (options.job) {
      options.job.child = child;
      options.job.pid = child.pid;
    }

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      if (options.onData) options.onData(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (options.onData) options.onData(chunk);
    });
    child.on('error', (error) => {
      stderr += error.message || String(error);
    });
    child.on('close', (code) => {
      if (options.job) {
        options.job.child = null;
        options.job.pid = null;
      }
      resolve({ code, stdout, stderr });
    });
  });
}

function readLatestEudonetReport() {
  return readJsonIfExists(path.join(PROJECT_ROOT, 'reports', 'business', 'latest', 'eudonet-program-choice-check.json'));
}

function normalizeEudonetStatus(status, exitCode) {
  const text = String(status || '').toUpperCase();
  if (text === 'OK') return 'passed';
  if (text === 'KO') return 'failed';
  if (text === 'BLOQUE') return 'blocked';
  if (text === 'NON_TESTABLE') return 'pending';
  return exitCode === 0 ? 'passed' : 'failed';
}

function persistManualScenarioJob(job) {
  writeJsonFile(path.join(MANUAL_SCENARIO_DIR, `${job.id}.json`), {
    jobId: job.id,
    createdAt: job.startedAt,
    finishedAt: job.finishedAt,
    status: job.status,
    exitCode: job.exitCode,
    scenarioConfig: job.scenarioConfig || null,
    executionPlan: job.executionPlan || null,
    results: job.results || [],
    logLines: job.logLines || [],
  });
}

function createManualScenarioExecutionJob(options = {}) {
  const runningJob = getRunningQaJob();
  if (runningJob) {
    throw new Error('Une execution QA est deja en cours. Attends la fin avant de relancer.');
  }

  const scenarioConfig = options.scenarioConfig || options.configuration || options;
  const executionPlan = buildManualExecutionPlan(scenarioConfig);
  const schoolSlug = String(executionPlan.target?.schoolSlug || scenarioConfig.schoolSlug || '').trim().toLowerCase();
  if (!schoolSlug) throw new Error('Aucune ecole ciblee pour le scenario personnalise.');

  const campaignId = campaignIdFromEnvironment(scenarioConfig.environment || 'REC');
  const job = {
    id: `qa-${Date.now()}-manual`,
    type: 'manual',
    source: 'manual',
    project: 'NewForm',
    environment: normalizeEnvironment(scenarioConfig.environment || 'REC'),
    campaign: scenarioConfig.school || schoolSlug,
    scenario: executionPlan.scenarioName || scenarioConfig.scenario || 'Scenario personnalise',
    scenarioConfig: { ...scenarioConfig, understoodPlan: executionPlan.understoodPlan },
    executionPlan,
    executionType: 'Scenario personnalise',
    status: 'queued',
    startedAt: new Date().toISOString(),
    finishedAt: '',
    exitCode: null,
    errorMessage: '',
    logLines: [],
    results: [],
    currentStep: '',
    currentSchoolSlug: schoolSlug,
    currentSchoolLabel: scenarioConfig.school || schoolSlug,
    child: null,
    pid: null,
  };

  qaJobs.set(job.id, job);
  appendQaLog(job, `[MANUAL-JOB] Scenario interprete: ${job.scenario}`);
  appendQaLog(job, `[MANUAL-JOB] Apps: ${(executionPlan.target?.apps || ['newform']).join(' -> ')}`);
  appendQaLog(job, `[MANUAL-JOB] Actions: ${JSON.stringify(executionPlan.manualInstructions?.actions || {})}`);
  persistManualScenarioJob(job);

  (async () => {
    job.status = 'running';
    job.currentStep = 'newform';
    appendQaLog(job, `[MANUAL-JOB] Lancement NewForm - ${job.currentSchoolLabel}`);
    const scenarioEnv = {
      SCENARIO_KIND: 'manual-freeform',
      SCENARIO_TITLE: job.scenario,
      MANUAL_SCENARIO_PLAN: JSON.stringify(executionPlan),
      NEWFORM_HEADLESS: process.env.NEWFORM_HEADLESS || '0',
      EUDONET_HEADLESS: process.env.EUDONET_HEADLESS || '0',
    };
    if (executionPlan.manualInstructions?.actions?.verifyDownloadLinks) scenarioEnv.PJ_VERIFY_VIEW = '1';
    if (executionPlan.manualInstructions?.actions?.uploadDocuments) scenarioEnv.UPLOAD_OPTIONAL = '1';

    const newform = await runNodeStep(path.join(PROJECT_ROOT, 'scripts', 'runCampaign.js'), [
      '--campaign',
      campaignId,
      '--schools',
      schoolSlug,
    ], {
      cwd: PROJECT_ROOT,
      env: scenarioEnv,
      job,
      onData: (chunk) => appendQaChunk(job, chunk),
    });

    const row = {
      schoolSlug,
      school: job.currentSchoolLabel,
      newformStatus: newform.code === 0 ? 'passed' : 'failed',
      eudonetStatus: '',
      status: newform.code === 0 ? 'passed' : 'failed',
      message: '',
      finishedAt: '',
    };

    if (newform.code !== 0) {
      row.eudonetStatus = 'pending';
      row.message = 'NewForm KO, controle Eudonet non lance.';
      row.finishedAt = new Date().toISOString();
      job.results.push(row);
      job.status = 'completed-with-issues';
      job.exitCode = 1;
      appendQaLog(job, '[MANUAL-JOB] NewForm termine en anomalie.');
      return;
    }

    if ((executionPlan.target?.apps || []).includes('eudonet')) {
      job.currentStep = 'eudonet';
      appendQaLog(job, `[MANUAL-JOB] Controle Eudonet - ${job.currentSchoolLabel}`);
      const eudonet = await runNodeStep(path.join(PROJECT_ROOT, 'scripts', 'apps', 'eudonet', 'checkProgramChoice.js'), [], {
        cwd: PROJECT_ROOT,
        env: {
          ...scenarioEnv,
          EUDONET_URL: process.env.EUDONET_URL || 'https://test-omnes.eudonet.com/recette',
          EUDONET_HEADLESS: process.env.EUDONET_HEADLESS || '0',
          EUDONET_USE_COLUMN_FILTER: process.env.EUDONET_USE_COLUMN_FILTER || '1',
          EUDONET_NAVIGATION_TIMEOUT: process.env.EUDONET_NAVIGATION_TIMEOUT || '25000',
          EUDONET_UI_WAIT_MS: process.env.EUDONET_UI_WAIT_MS || '1800',
          EUDONET_SEARCH_RETRIES: process.env.EUDONET_SEARCH_RETRIES || '5',
          EUDONET_SEARCH_RETRY_MS: process.env.EUDONET_SEARCH_RETRY_MS || '12000',
          EUDONET_KEEP_OPEN_ON_FAILURE: process.env.EUDONET_KEEP_OPEN_ON_FAILURE || '1',
          EUDONET_PRINT_JSON: process.env.EUDONET_PRINT_JSON || '0',
        },
        job,
        onData: (chunk) => appendQaChunk(job, chunk),
      });
      const report = readLatestEudonetReport();
      row.eudonetStatus = normalizeEudonetStatus(report?.status, eudonet.code);
      row.status = row.eudonetStatus === 'passed' ? 'passed' : row.eudonetStatus;
      row.message = report?.blockingReason || report?.status || (eudonet.code === 0 ? 'Controle Eudonet OK.' : 'Controle Eudonet KO.');
    } else {
      row.eudonetStatus = 'pending';
      row.message = 'Scenario NewForm termine, controle Eudonet non demande.';
    }

    row.finishedAt = new Date().toISOString();
    job.results.push(row);
    job.status = row.status === 'passed' ? 'completed' : 'completed-with-issues';
    job.exitCode = row.status === 'passed' ? 0 : 1;
    appendQaLog(job, `[MANUAL-JOB] Fin scenario code=${job.exitCode}.`);
  })().catch((error) => {
    job.status = 'completed-with-issues';
    job.exitCode = 1;
    job.errorMessage = error.message || String(error);
    appendQaLog(job, `[MANUAL-JOB] Erreur: ${job.errorMessage}`);
  }).finally(() => {
    job.currentStep = '';
    job.finishedAt = new Date().toISOString();
    persistManualScenarioJob(job);
  });

  return job;
}

function createQaJob({
  type = 'manual',
  source = '',
  project = 'NewForm',
  environment = 'REC',
  campaign = '',
  scenario = '',
  scenarioConfig = null,
  executionType = '',
  completeAs = 'completed',
  errorMessage = '',
}) {
  const runningJob = getRunningQaJob();
  if (runningJob) {
    throw new Error('Une execution agent est deja en cours. Attends la fin avant de relancer.');
  }

  const job = {
    id: `qa-${Date.now()}-${type}`,
    type,
    source,
    project,
    environment: normalizeEnvironment(environment),
    campaign,
    scenario,
    scenarioConfig,
    executionType: executionType || (type === 'squash' ? 'Squash' : 'Scenario personnalise'),
    status: 'queued',
    startedAt: new Date().toISOString(),
    finishedAt: '',
    errorMessage: '',
    logLines: [],
  };
  appendQaLog(job, `Preparation ${job.executionType} - ${scenario || campaign || 'scenario'}.`);
  qaJobs.set(job.id, job);

  setTimeout(() => {
    if (job.status !== 'queued') return;
    job.status = 'running';
    appendQaLog(job, 'Execution simulee cote dashboard restaure. Aucun runner Playwright lance.');
  }, 120);

  setTimeout(() => {
    if (job.status !== 'running') return;
    job.status = completeAs;
    job.finishedAt = new Date().toISOString();
    job.errorMessage = errorMessage || '';
    appendQaLog(job, completeAs === 'completed' ? 'Preparation terminee.' : (errorMessage || 'Execution terminee avec anomalie.'));
  }, 900);

  return job;
}

function emptySquashCatalog(project = 'NewForm', environment = 'REC') {
  return {
    generatedAt: new Date().toISOString(),
    source: 'dashboard-restored',
    projects: [{
      name: project || 'NewForm',
      application: project || 'NewForm',
      environment: normalizeEnvironment(environment),
      campaigns: [],
    }],
  };
}

function normalizeSquashCatalog(payload, project = 'NewForm', environment = 'REC') {
  const catalogFromMap = (() => {
    const catalogs = payload?.catalogs && typeof payload.catalogs === 'object' ? payload.catalogs : null;
    if (!catalogs) return null;
    const env = normalizeEnvironment(environment);
    const entries = Object.entries(catalogs);
    const exact = entries.find(([key]) => {
      const normalizedKey = normalizeEnvironment(key);
      return normalizedKey === env && key.toLowerCase().includes(String(project || 'NewForm').toLowerCase());
    });
    const sameEnv = entries.find(([key]) => normalizeEnvironment(key) === env);
    return (exact || sameEnv || entries[0])?.[1]?.catalog || null;
  })();
  const catalog = payload?.projects ? payload : payload?.catalog?.projects ? payload.catalog : catalogFromMap;
  if (!catalog) return null;
  const projects = Array.isArray(catalog.projects) ? catalog.projects : [];
  if (!projects.length) return emptySquashCatalog(project, environment);
  return {
    ...catalog,
    projects: projects.map((item) => ({
      ...item,
      name: item.name || item.application || project || 'NewForm',
      application: item.application || item.name || project || 'NewForm',
      campaigns: Array.isArray(item.campaigns) ? item.campaigns : [],
    })),
  };
}

function campaignFromSquashPayload(payload, fallbackEnvironment = 'REC') {
  const scenarioConfig = payload?.scenarioConfig || {};
  const squash = scenarioConfig.squash || {};
  const campaign = squash.campaign || payload?.campaign || '';
  if (!campaign) return null;
  return {
    id: squash.campaignId || campaign,
    name: campaign,
    project: squash.project || payload?.project || 'NewForm',
    environment: normalizeEnvironment(scenarioConfig.environment || payload?.environment || fallbackEnvironment),
    lot: squash.lot || payload?.lot || 'Sans lot',
    lotId: squash.lotId || squash.lot || payload?.lotId || payload?.lot || 'Sans lot',
    scenarios: squash.scenario || squash.scenarioId ? [{
      id: squash.scenarioId || squash.scenario,
      name: squash.scenario || squash.scenarioId,
    }] : [],
  };
}

function buildSquashCatalogFromPayloads(project = 'NewForm', environment = 'REC') {
  const campaigns = new Map();
  try {
    if (!fs.existsSync(SQUASH_PAYLOAD_DIR)) return null;
    for (const fileName of fs.readdirSync(SQUASH_PAYLOAD_DIR).filter((name) => name.endsWith('.json'))) {
      const payload = readJsonIfExists(path.join(SQUASH_PAYLOAD_DIR, fileName));
      const campaign = campaignFromSquashPayload(payload, environment);
      if (!campaign) continue;
      const key = `${campaign.lotId}::${campaign.id}`;
      const current = campaigns.get(key) || { ...campaign, scenarios: [] };
      for (const scenario of campaign.scenarios || []) {
        if (!current.scenarios.some((item) => item.id === scenario.id || item.name === scenario.name)) {
          current.scenarios.push(scenario);
        }
      }
      campaigns.set(key, current);
    }
  } catch {
    return null;
  }
  if (!campaigns.size) return null;
  return {
    generatedAt: new Date().toISOString(),
    source: 'squash-execution-payloads',
    projects: [{
      name: project || 'NewForm',
      application: project || 'NewForm',
      environment: normalizeEnvironment(environment),
      campaigns: Array.from(campaigns.values()),
    }],
  };
}

function getSquashCatalog(project = 'NewForm', environment = 'REC') {
  const cached = normalizeSquashCatalog(readJsonIfExists(SQUASH_CATALOG_CACHE_PATH), project, environment);
  if (cached) return cached;
  return buildSquashCatalogFromPayloads(project, environment) || emptySquashCatalog(project, environment);
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

function resolveSchoolSlugs(mode, schoolSlug, campaignId = CAMPAIGN_ID) {
  const selectedCampaignId = normalizeCampaignId(campaignId);
  const campaign = getCampaign(selectedCampaignId);

  if (mode === 'all') {
    return campaign.schools.map((school) => school.slug);
  }
  if (mode === 'failed') {
    return getSchoolSlugsByStatus(PROJECT_ROOT, selectedCampaignId, 'failed');
  }
  if (mode === 'blocked') {
    return getSchoolSlugsByStatus(PROJECT_ROOT, selectedCampaignId, 'blocked');
  }
  if (mode === 'passed') {
    return getSchoolSlugsByStatus(PROJECT_ROOT, selectedCampaignId, 'passed');
  }
  if (mode === 'school' && schoolSlug) {
    return [String(schoolSlug).trim().toLowerCase()];
  }

  throw new Error('Mode de relance non supporte.');
}

function createJob(mode, schoolSlug, autoPayment = true, campaignId = CAMPAIGN_ID) {
  const runningJob = getRunningJob();
  if (runningJob) {
    throw new Error('Une execution est deja en cours. Attends la fin avant de relancer.');
  }

  const externalLock = getExternalExecutionLock();
  if (externalLock) {
    const labels = Array.isArray(externalLock.schools) ? externalLock.schools.join(', ') : 'inconnues';
    throw new Error(`Une execution est deja en cours sur ce poste pour ${labels}. Attends la fin avant de relancer.`);
  }

  const selectedCampaignId = normalizeCampaignId(campaignId);
  const campaign = getCampaign(selectedCampaignId);
  const schoolSlugs = resolveSchoolSlugs(mode, schoolSlug, selectedCampaignId);
  if (!schoolSlugs.length) {
    throw new Error('Aucune ecole ne correspond au filtre de relance choisi.');
  }

  const jobId = `${Date.now()}-${mode}`;
  const job = {
    id: jobId,
    mode,
    schoolSlug: schoolSlug || '',
    campaignId: selectedCampaignId,
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
    '--campaign', selectedCampaignId,
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
  jobProcesses.set(jobId, child);

  job.status = 'running';
  appendJobLog(job, `[JOB] Campagne ${selectedCampaignId} - ${campaign.environment}`);
  appendJobLog(job, `[JOB] Demarrage de la campagne pour ${schoolSlugs.join(', ')}`);

  child.stdout.on('data', (chunk) => appendJobLog(job, chunk));
  child.stderr.on('data', (chunk) => appendJobLog(job, chunk));
  child.on('close', (code) => {
    jobProcesses.delete(jobId);
    job.finishedAt = new Date().toISOString();
    job.exitCode = code;
    if (job.status !== 'stopped') {
      job.status = code === 0 ? 'completed' : 'completed-with-issues';
    }
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

  if (request.method === 'GET' && url.pathname === '/api/dashboard-usage') {
    sendJson(response, 200, summarizeDashboardUsage(getDashboardUsage()));
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/dashboard-usage') {
    const body = await parseBody(request);
    sendJson(response, 200, trackDashboardUsage(body.sessionId, body));
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/admin/usage') {
    sendJson(response, 200, dashboardUsageDetails());
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/admin/users') {
    sendJson(response, 200, getAdminUsers());
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/admin/users') {
    const body = await parseBody(request);
    sendJson(response, 200, upsertAdminUser(body));
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/admin/users/delete') {
    const body = await parseBody(request);
    sendJson(response, 200, deleteAdminUser(body.id || body.email));
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/campaign-data') {
    const campaignId = url.searchParams.get('campaign') || url.searchParams.get('campaignId') || CAMPAIGN_ID;
    try {
      sendJson(response, 200, buildCampaignPayload(PROJECT_ROOT, campaignId));
    } catch (error) {
      console.error(`[dashboard] Impossible de charger la campagne ${campaignId}:`, error.message || error);
      const payload = buildCampaignPayload(PROJECT_ROOT, CAMPAIGN_ID);
      sendJson(response, 200, {
        ...payload,
        requestedCampaignId: campaignId,
        warning: `Campagne ${campaignId} introuvable, fallback sur ${CAMPAIGN_ID}.`,
      });
    }
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

  if (request.method === 'GET' && url.pathname === '/api/jobs/current') {
    sendJson(response, 200, { job: getRunningJob() });
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/qa-jobs') {
    const allJobs = Array.from(qaJobs.values()).map(serializeQaJob);
    sendJson(response, 200, {
      jobs: allJobs,
      running: serializeQaJob(getRunningQaJob()),
    });
    return true;
  }

  if (request.method === 'GET' && /^\/api\/qa-jobs\/[^/]+$/.test(url.pathname)) {
    const jobId = decodeURIComponent(url.pathname.split('/').pop() || '');
    const job = qaJobs.get(jobId);
    if (!job) {
      sendJson(response, 404, { error: 'Job QA introuvable.' });
      return true;
    }
    sendJson(response, 200, serializeQaJob(job));
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/squash-catalog') {
    const project = url.searchParams.get('project') || 'NewForm';
    const environment = url.searchParams.get('environment') || 'REC';
    sendJson(response, 200, getSquashCatalog(project, environment));
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/jira/check-session') {
    sendJson(response, 200, summarizeJiraStoredSession());
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/jira-login') {
    try {
      const pid = launchJiraLoginWindow();
      sendJson(response, 200, {
        ok: true,
        pid,
        message: 'Fenetre Jira ouverte. Connecte-toi puis reessaie la creation du ticket.',
        session: summarizeJiraStoredSession(),
      });
    } catch (error) {
      sendJson(response, 500, {
        ok: false,
        message: error.message || 'Ouverture Jira impossible.',
        session: summarizeJiraStoredSession(),
      });
    }
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/jira/issues') {
    try {
      const issues = await listJiraIssues(url.searchParams.get('query') || '');
      sendJson(response, 200, {
        project: JIRA_PROJECT_KEY,
        issues,
        message: issues.length ? '' : 'Aucun ticket Jira trouvé pour cette recherche.',
        session: summarizeJiraStoredSession(),
      });
    } catch (error) {
      sendJson(response, 200, {
        project: JIRA_PROJECT_KEY,
        issues: [],
        message: error.message || 'Recherche Jira impossible.',
        session: summarizeJiraStoredSession(),
      });
    }
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/jira/create-issue') {
    try {
      const anomaly = await parseBody(request);
      const result = await createJiraIssueFromAnomaly(anomaly);
      sendJson(response, 200, {
        ...result,
        session: summarizeJiraStoredSession(),
      });
    } catch (error) {
      sendJson(response, 500, {
        success: false,
        message: error.message || 'Création Jira impossible.',
        session: summarizeJiraStoredSession(),
      });
    }
    return true;
  }

  if (request.method === 'POST' && /^\/api\/jobs\/[^/]+\/stop$/.test(url.pathname)) {
    const jobId = decodeURIComponent(url.pathname.split('/')[3] || '');
    const job = jobs.get(jobId);
    if (!job) {
      sendJson(response, 404, { error: 'Job introuvable.' });
      return true;
    }

    const child = jobProcesses.get(jobId);
    job.status = 'stopped';
    job.finishedAt = new Date().toISOString();
    appendJobLog(job, '[JOB] Demande d arret recue depuis le dashboard.');
    if (child && !child.killed) {
      child.kill('SIGTERM');
    }
    sendJson(response, 200, job);
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
      const job = createJob(body.mode || 'all', body.schoolSlug || '', body.autoPayment !== false, body.campaignId || body.campaign || CAMPAIGN_ID);
      sendJson(response, 202, job);
    } catch (error) {
      sendJson(response, 400, { error: error.message || 'Impossible de lancer la campagne.' });
    }
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/journey-execute') {
    try {
      const body = await parseBody(request);
      const job = createJob(body.mode || 'all', body.schoolSlug || '', body.autoPayment !== false, body.campaignId || body.campaign || CAMPAIGN_ID);
      job.type = 'journey';
      job.executionType = 'Parcours complet';
      appendJobLog(job, '[JOB] Route parcours complet utilisee. Controle Eudonet reel non branche dans ce serveur restaure.');
      sendJson(response, 202, job);
    } catch (error) {
      sendJson(response, 400, { error: error.message || 'Impossible de lancer le parcours NewForm + Eudonet.' });
    }
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/manual-scenario-plan') {
    try {
      const body = await parseBody(request);
      const scenarioText = String(body.scenarioText || '').trim();
      const plan = buildUnderstoodPlan({
        scenario: body.title || 'Scenario personnalise',
        manualScenario: {
          title: body.title || 'Scenario personnalise',
          description: scenarioText,
          scenarioText,
        },
      });
      sendJson(response, 200, { success: true, plan: formatManualScenarioPlan(plan) });
    } catch (error) {
      sendJson(response, 400, {
        success: false,
        error: error.message || "Impossible d'analyser le scenario personnalise.",
      });
    }
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/squash-execution') {
    try {
      const body = await parseBody(request);
      const scenarioConfig = body.scenarioConfig || {};
      const campaign = body.campaign || scenarioConfig.squash?.campaign || '';
      if (!campaign) {
        sendJson(response, 400, { error: 'Selection Squash incomplete : campagne manquante.' });
        return true;
      }
      const job = createQaJob({
        type: 'squash',
        source: 'squash',
        project: body.project || scenarioConfig.squash?.project || 'NewForm',
        environment: body.environment || scenarioConfig.environment || 'REC',
        campaign,
        scenario: body.scenario || scenarioConfig.squash?.scenario || scenarioConfig.scenario || '',
        scenarioConfig,
        executionType: 'Squash',
      });
      writeJsonFile(path.join(SQUASH_PAYLOAD_DIR, `${job.id}.json`), {
        ...body,
        jobId: job.id,
        createdAt: job.startedAt,
      });
      sendJson(response, 202, serializeQaJob(job));
    } catch (error) {
      sendJson(response, 400, { error: error.message || 'Impossible de lancer le scenario Squash.' });
    }
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/manual-scenario-execution') {
    try {
      const body = await parseBody(request);
      const scenarioConfig = body.scenarioConfig || {};
      const scenarioText = String(
        scenarioConfig.customScenario
        || scenarioConfig.manualScenario?.scenarioText
        || scenarioConfig.manualScenario?.description
        || ''
      ).trim();
      if (!scenarioText) {
        sendJson(response, 400, { error: 'Scenario personnalise vide.' });
        return true;
      }
      const rawPlan = scenarioConfig.understoodPlan?.steps ? scenarioConfig.understoodPlan : buildUnderstoodPlan({
        scenario: scenarioConfig.scenario || scenarioConfig.manualScenario?.title || 'Scenario personnalise',
        manualScenario: {
          title: scenarioConfig.manualScenario?.title || scenarioConfig.scenario || 'Scenario personnalise',
          description: scenarioText,
          scenarioText,
        },
      });
      const plan = formatManualScenarioPlan(rawPlan);
      if (!plan.valid) {
        sendJson(response, 400, {
          error: plan.blockedReason || "L'agent a detecte une etape non supportee.",
          understoodPlan: plan,
        });
        return true;
      }
      const job = createManualScenarioExecutionJob({
        scenarioConfig: { ...scenarioConfig, understoodPlan: plan },
      });
      sendJson(response, 202, serializeQaJob(job));
    } catch (error) {
      sendJson(response, 400, { error: error.message || 'Impossible de lancer le scenario personnalise.' });
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
