const fs = require('fs');
const path = require('path');

const { projectRoot } = require('./config');

const samplePath = path.join(projectRoot, 'data', 'squash-lot-scenarios-sample.json');
const authRoot = path.join(projectRoot, '.auth', 'squash');

function readSample() {
  return {
    source: 'fichier local',
    payload: JSON.parse(fs.readFileSync(samplePath, 'utf8')),
  };
}

async function tryFetchSquash(config) {
  const baseUrl = String(config.SQUASH_BASE_URL || '').replace(/\/$/, '');
  const token = String(config.SQUASH_TOKEN || '').trim();
  if (!baseUrl || !token || typeof fetch !== 'function') return null;

  try {
    // Endpoint volontairement configurable: les instances Squash peuvent exposer
    // des chemins differents selon version et droits API.
    const url = `${baseUrl}/api/rest/latest/projects`;
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) return null;
    await response.json();
    return null;
  } catch {
    return null;
  }
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&rsquo;/g, "'")
    .replace(/&ldquo;/g, '"')
    .replace(/&rdquo;/g, '"')
    .replace(/&laquo;/g, '"')
    .replace(/&raquo;/g, '"')
    .replace(/&eacute;/g, '\u00e9')
    .replace(/&Eacute;/g, '\u00c9')
    .replace(/&egrave;/g, '\u00e8')
    .replace(/&Egrave;/g, '\u00c8')
    .replace(/&agrave;/g, '\u00e0')
    .replace(/&Agrave;/g, '\u00c0')
    .replace(/&ecirc;/g, '\u00ea')
    .replace(/&Ecirc;/g, '\u00ca')
    .replace(/&ocirc;/g, '\u00f4')
    .replace(/&ccedil;/g, '\u00e7')
    .replace(/&ugrave;/g, '\u00f9');
}

function stripHtml(value) {
  return decodeHtml(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniqBy(items, getKey) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = getKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function deepCollect(value, predicate, result = []) {
  if (!value || typeof value !== 'object') return result;
  if (predicate(value)) result.push(value);
  if (Array.isArray(value)) {
    for (const item of value) deepCollect(item, predicate, result);
  } else {
    for (const item of Object.values(value)) deepCollect(item, predicate, result);
  }
  return result;
}

function readDataField(row, names) {
  const data = row?.data && typeof row.data === 'object' ? row.data : row;
  for (const name of names) {
    if (data?.[name] !== undefined && data?.[name] !== null && String(data[name]).trim()) {
      return data[name];
    }
  }
  return '';
}

function inferSchool(name, config) {
  const text = normalizeText(name);
  const configured = String(config.SQUASH_SCHOOL_ALIASES || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [school, ...aliases] = item.split(':');
      return {
        school: school.trim(),
        aliases: aliases.join(':').split('|').map((alias) => normalizeText(alias)),
      };
    });

  for (const entry of configured) {
    if (entry.aliases.some((alias) => alias && text.includes(alias))) return entry.school;
  }

  if (/inseec.*bachelor|bachelor.*inseec|bachelorsinseec/.test(text)) return 'INSEEC Bachelor';
  if (/inseec.*msc|msc.*inseec|mastersinseec/.test(text)) return 'INSEEC MSC';
  if (/inseec.*bba|bba.*inseec|inseecbba/.test(text)) return 'INSEEC BBA';
  if (/international/.test(text)) return 'INTERNATIONAL';
  if (/\bium\b|monaco/.test(text)) return 'IUM Monaco';
  if (/\bece\b|ecole centrale d'electronique|ecole centrale delectronique/.test(text)) return 'ECE';
  return '';
}

function inferPage(name) {
  const text = normalizeText(name);
  if (/paiement|payment|cb|carte/.test(text)) return 'Page 4 - Paiement';
  if (/document|piece|pj|justificatif/.test(text)) return 'Page 2 - Documents';
  if (/parcours complet|candidature|candidate/.test(text)) return 'Parcours complet';
  return '';
}

function inferPriority(row) {
  return String(readDataField(row, ['IMPORTANCE', 'PRIORITY', 'priority', 'importance']) || '');
}

function normalizeSquashStatus(value) {
  const raw = String(value || '').trim();
  const text = normalizeText(raw);
  if (!raw) return 'À exécuter';
  if (/blocked|bloque/.test(text)) return 'Bloqué';
  if (/failure|failed|echec|ko/.test(text)) return 'Échec';
  if (/success|passed|ok|reussi/.test(text)) return 'Réussi';
  if (/ready|a executer|untested|not run/.test(text)) return 'À exécuter';
  return raw;
}

function buildScenarioFromRow(row, lot, campaignName, environmentName, config) {
  const name = String(readDataField(row, [
    'TEST_CASE_NAME',
    'TEST_CASE_NAME_WITHOUT_ICON',
    'NAME',
    'LABEL',
    'name',
    'label',
  ]) || '').trim();
  if (!name) return null;

  const id = String(readDataField(row, [
    'TEST_CASE_ID',
    'TEST_CASE_REFERENCE',
    'ID',
    'id',
    'testCaseId',
    'testPlanItemId',
  ]) || row.id || '').trim();

  return {
    idScenarioSquash: id || name,
    nomScenarioSquash: name,
    ecole: inferSchool(`${name} ${campaignName} ${lot.nomLot}`, config),
    page: inferPage(name),
    priorite: inferPriority(row),
    statutSquash: normalizeSquashStatus(readDataField(row, [
      'EXECUTION_STATUS',
      'EXECUTION_STATUS_NAME',
      'status',
      'executionStatus',
      'lastExecutionStatus',
    ])),
    tags: [],
  };
}

function looksLikeTestPlanRow(row) {
  if (!row || typeof row !== 'object') return false;
  const data = row.data && typeof row.data === 'object' ? row.data : row;
  const keys = Object.keys(data).map((key) => key.toLowerCase());
  const hasPlanItem = keys.some((key) => key.includes('testplanitem') || key.includes('test_plan_item'));
  const hasTestCaseName = [
    'TEST_CASE_NAME',
    'TEST_CASE_NAME_WITHOUT_ICON',
    'testCaseName',
    'test_case_name',
  ].some((key) => data[key] !== undefined && String(data[key] || '').trim());
  const hasTestCaseId = [
    'TEST_CASE_ID',
    'testCaseId',
    'test_case_id',
  ].some((key) => data[key] !== undefined && String(data[key] || '').trim());

  return hasPlanItem || hasTestCaseName || hasTestCaseId;
}

function findScenarioRows(payloads) {
  const rows = [];
  for (const payload of payloads) {
    deepCollect(payload, (item) => {
      if (!looksLikeTestPlanRow(item)) return false;
      const name = readDataField(item, ['TEST_CASE_NAME', 'TEST_CASE_NAME_WITHOUT_ICON', 'NAME', 'name']);
      return Boolean(String(name || '').trim());
    }, rows);
  }
  return uniqBy(rows, (row) => String(readDataField(row, ['TEST_CASE_ID', 'ID', 'id', 'testPlanItemId']) || readDataField(row, ['TEST_CASE_NAME', 'NAME', 'name'])));
}

function findTreeRows(payloads) {
  const rows = [];
  for (const payload of payloads) {
    deepCollect(payload, (item) => {
      if (!item || typeof item !== 'object') return false;
      const name = readDataField(item, ['NAME', 'name', 'label', 'LABEL']);
      const type = String(item.type || item.kind || readDataField(item, ['TYPE', 'ENTITY_TYPE', 'type']) || '');
      return Boolean(name && /campaign|iteration|suite|folder|sprint/i.test(type));
    }, rows);
  }
  return uniqBy(rows, (row) => String(row.id || readDataField(row, ['ID', 'CLN_ID', 'name', 'NAME'])));
}

function buildPayloadFromSessionPayloads(payloads, config) {
  const domain = config.SQUASH_DOMAIN_NAME || 'Domaine Squash';
  const environmentName = config.SQUASH_ENVIRONMENT || 'Recette';
  const treeRows = findTreeRows(payloads);
  const scenarioRows = findScenarioRows(payloads);

  const lotRows = treeRows.filter((row) => {
    const name = String(readDataField(row, ['NAME', 'name', 'label', 'LABEL']) || '');
    const type = String(row.type || row.kind || readDataField(row, ['TYPE', 'ENTITY_TYPE', 'type']) || '');
    return /lot/i.test(name) || /campaign/i.test(type);
  });

  const lot = lotRows[lotRows.length - 1] || {
    id: 'SESSION',
    data: { NAME: config.SQUASH_LOT_NAME || 'Lot Squash session' },
  };
  const lotName = String(readDataField(lot, ['NAME', 'name', 'label', 'LABEL']) || config.SQUASH_LOT_NAME || 'Lot Squash session');
  const lotId = String(readDataField(lot, ['CLN_ID', 'ID', 'id']) || lot.id || lotName);
  const campaignName = String(config.SQUASH_CAMPAIGN_NAME || 'Campagne Squash');

  const scenarios = scenarioRows
    .map((row) => buildScenarioFromRow(row, { nomLot: lotName }, campaignName, environmentName, config))
    .filter(Boolean);

  if (!scenarios.length) return null;

  return {
    domaine: domain,
    lots: [
      {
        idLot: lotId,
        nomLot: lotName,
        environments: [
          {
            nom: environmentName,
            campagnes: [
              {
                nomCampagne: campaignName,
                scenarios,
              },
            ],
          },
        ],
      },
    ],
  };
}

async function fetchBackendJson(page, endpoint) {
  const normalized = String(endpoint || '').replace(/^\/+/, '');
  return page.evaluate(async (path) => {
    const xsrf = decodeURIComponent((document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/) || [])[1] || '');
    const response = await fetch(`/squash/backend/${path}`, {
      method: path === 'campaign-tree' ? 'POST' : 'GET',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(xsrf ? { 'X-XSRF-TOKEN': xsrf } : {}),
      },
      body: path === 'campaign-tree' ? JSON.stringify({ openedNodes: [], selectedNodes: [] }) : undefined,
    });
    if (!response.ok) {
      throw new Error(`${response.status} ${path}`);
    }
    return response.json();
  }, normalized);
}

function getRowName(row) {
  return String(readDataField(row, ['NAME', 'name', 'label', 'LABEL']) || '').trim();
}

function getRowNumericId(row) {
  return readDataField(row, ['CLN_ID', 'CL_ID', 'ITERATION_ID', 'ID', 'id']) || String(row?.id || '').replace(/^[A-Za-z]+-/, '');
}

function getRowType(row) {
  const id = String(row?.id || '');
  if (id.startsWith('CampaignLibrary-')) return 'library';
  if (id.startsWith('CampaignFolder-')) return 'folder';
  if (id.startsWith('Campaign-')) return 'campaign';
  if (id.startsWith('Iteration-')) return 'iteration';
  return '';
}

function makeLotId(name, fallbackId) {
  const normalized = normalizeText(name);
  if (/kidor/.test(normalized)) return 'LOT-KIDOR';
  if (/gnon/.test(normalized)) return 'LOT-GNON';
  if (/sujets classes|archive/.test(normalized)) return 'ARCHIVE';
  return String(fallbackId || name || 'LOT').toUpperCase();
}

function makeScenarioFromIteration(row, lotName, campaignName, environmentName, config) {
  const name = getRowName(row);
  const reference = String(readDataField(row, ['REFERENCE', 'reference']) || '').trim();
  return {
    idScenarioSquash: String(getRowNumericId(row) || row.id || name),
    nomScenarioSquash: reference ? `${reference} - ${name.replace(new RegExp(`^${reference}\\s*-\\s*`, 'i'), '')}` : name,
    ecole: inferSchool(`${name} ${campaignName} ${lotName}`, config),
    page: inferPage(`${name} ${campaignName}`),
    priorite: '',
    statutSquash: 'À exécuter',
    tags: [],
    environmentName,
  };
}

async function fetchIterationTestPlan(page, iterationId) {
  const payload = await page.evaluate(async (id) => {
    const xsrf = decodeURIComponent((document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/) || [])[1] || '');
    const response = await fetch(`/squash/backend/iteration/${id}/test-plan`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(xsrf ? { 'X-XSRF-TOKEN': xsrf } : {}),
      },
      body: JSON.stringify({ page: 0, size: 200 }),
    });
    if (!response.ok) return null;
    return response.json();
  }, Number(iterationId)).catch(() => null);

  return asArray(payload?.dataRows).map((row) => {
    const data = row.data || {};
    return {
      testPlanItemId: data.testPlanItemId || row.id || '',
      testCaseId: data.testCaseId || '',
      reference: data.testCaseReference || '',
      name: data.testCaseName || '',
      status: data.executionStatus || '',
      importance: data.importance || '',
      lastExecutedOn: data.lastExecutedOn || '',
      latestExecutionId: data.latestExecutionId || '',
    };
  });
}

async function fetchTestCaseSteps(page, testCaseId) {
  if (!testCaseId) return [];
  const payload = await fetchBackendJson(page, `test-case-view/${testCaseId}`).catch(() => null);
  return asArray(payload?.testSteps).map((step) => ({
    id: step.id || '',
    order: step.stepOrder,
    action: stripHtml(step.action || ''),
    expectedResult: stripHtml(step.expectedResult || ''),
    kind: step.kind || '',
  }));
}

async function enrichTestPlanWithSteps(page, testPlanItems) {
  const enriched = [];
  for (const item of testPlanItems) {
    const testSteps = await fetchTestCaseSteps(page, item.testCaseId);
    enriched.push({
      ...item,
      testSteps,
    });
  }
  return enriched;
}

function inferScenarioExecutionRules(scenario, testPlanItems) {
  const text = normalizeText([
    scenario.nomScenarioSquash,
    scenario.campagne,
    ...testPlanItems.map((item) => `${item.reference} ${item.name}`),
    ...testPlanItems.flatMap((item) => asArray(item.testSteps).map((step) => `${step.action} ${step.expectedResult}`)),
  ].join(' '));

  const explicitlyNoPayment = /sans.*regler|ne pas.*payer|ne pas.*regler|sans.*payer|code promo 100/.test(text);
  const explicitlyPayment = /paiement|payment|carte bancaire|\bcb\b|paypal|frais de candidature/.test(text);
  const testPlanMentionsPayment = testPlanItems.some((item) => /paiement|payment|carte bancaire|\bcb\b|paypal/i.test(item.name));

  return {
    expectedPayment: testPlanMentionsPayment ? true : (explicitlyNoPayment ? false : (explicitlyPayment ? true : null)),
    squashInstructions: {
      testPlanCount: testPlanItems.length,
      alreadySuccess: testPlanItems.filter((item) => item.status === 'SUCCESS').length,
      running: testPlanItems.filter((item) => item.status === 'RUNNING').length,
      ready: testPlanItems.filter((item) => item.status === 'READY').length,
      requestedSteps: testPlanItems.map((item) => ({
        reference: item.reference,
        name: item.name,
        status: item.status,
        testCaseId: item.testCaseId,
        testSteps: asArray(item.testSteps).map((step) => ({
          order: step.order,
          action: step.action,
          expectedResult: step.expectedResult,
        })),
      })),
      detailedSteps: testPlanItems.flatMap((item) => asArray(item.testSteps).map((step) => ({
        testCaseId: item.testCaseId,
        testCaseName: item.name,
        order: step.order,
        action: step.action,
        expectedResult: step.expectedResult,
      }))),
    },
  };
}

function matchesOptionFilter(value, filter) {
  const normalizedFilter = normalizeText(filter);
  if (!normalizedFilter) return true;
  return normalizeText(value).includes(normalizedFilter);
}

async function fetchSquashTreePayload(page, config, options = {}) {
  const campaignFilter = options.campaign || options.campaignName || options.campagne || '';
  const scenarioFilter = options.scenario || options.scenarioId || '';
  const domainName = config.SQUASH_DOMAIN_NAME || 'Domaine 1 - Newform - Formulaire';
  const root = await fetchBackendJson(page, 'campaign-tree');
  const libraries = asArray(root.dataRows);
  const library = libraries.find((row) => normalizeText(getRowName(row)).includes(normalizeText(domainName)))
    || libraries.find((row) => normalizeText(getRowName(row)).includes('newform'))
    || libraries[0];
  if (!library) return null;

  const domain = getRowName(library);
  const libraryContent = await fetchBackendJson(page, `campaign-tree/${library.id}/content`);
  const lotRows = asArray(libraryContent.dataRows)
    .filter((row) => row.id !== library.id && getRowType(row) === 'folder')
    .sort((a, b) => getRowName(a).localeCompare(getRowName(b), 'fr'));

  const lots = [];
  for (const lotRow of lotRows) {
    const lotName = getRowName(lotRow);
    const lotContent = await fetchBackendJson(page, `campaign-tree/${lotRow.id}/content`).catch(() => null);
    const environmentRows = asArray(lotContent?.dataRows)
      .filter((row) => row.id !== lotRow.id && getRowType(row) === 'folder');

    const environments = [];
    for (const environmentRow of environmentRows) {
      const rawEnvName = getRowName(environmentRow);
      const environmentName = rawEnvName.replace(/^\d+\.\s*/, '').trim() || rawEnvName;
      const environmentContent = await fetchBackendJson(page, `campaign-tree/${environmentRow.id}/content`).catch(() => null);
      const campaignRows = asArray(environmentContent?.dataRows)
        .filter((row) => row.id !== environmentRow.id && getRowType(row) === 'campaign');

      const campagnes = [];
      for (const campaignRow of campaignRows) {
        const campaignName = getRowName(campaignRow);
        if (!matchesOptionFilter(campaignName, campaignFilter)) continue;
        const campaignContent = await fetchBackendJson(page, `campaign-tree/${campaignRow.id}/content`).catch(() => null);
        const scenarios = [];
        for (const row of asArray(campaignContent?.dataRows).filter((item) => item.id !== campaignRow.id && getRowType(item) === 'iteration')) {
          const scenario = makeScenarioFromIteration(row, lotName, campaignName, environmentName, config);
          if (!matchesOptionFilter(`${scenario.idScenarioSquash} ${scenario.nomScenarioSquash}`, scenarioFilter)) continue;
          const shouldReadDetailedPlan = Boolean(campaignFilter || scenarioFilter);
          const rawTestPlanItems = shouldReadDetailedPlan ? await fetchIterationTestPlan(page, scenario.idScenarioSquash) : [];
          const testPlanItems = shouldReadDetailedPlan ? await enrichTestPlanWithSteps(page, rawTestPlanItems) : [];
          const rules = inferScenarioExecutionRules(scenario, testPlanItems);
          scenarios.push({
            ...scenario,
            ...rules,
            testPlanItems,
          });
        }

        campagnes.push({
          nomCampagne: campaignName,
          scenarios,
        });
      }

      environments.push({
        nom: environmentName,
        campagnes,
      });
    }

    lots.push({
      idLot: makeLotId(lotName, getRowNumericId(lotRow)),
      nomLot: lotName,
      ignore: /sujets classes/i.test(normalizeText(lotName)),
      environments,
    });
  }

  return {
    domaine: domain,
    lots,
  };
}

async function tryFetchSquashWithSession(config, options = {}) {
  const baseUrl = String(config.SQUASH_BASE_URL || '').replace(/\/$/, '');
  if (!baseUrl || !fs.existsSync(authRoot)) return null;

  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    return null;
  }

  const context = await chromium.launchPersistentContext(authRoot, {
    headless: String(config.SQUASH_SESSION_HEADLESS || '1') !== '0',
    viewport: { width: 1440, height: 1000 },
    channel: config.PW_CHANNEL || undefined,
  });

  try {
    const page = context.pages()[0] || await context.newPage();
    const capturedPayloads = [];

    page.on('response', async (response) => {
      const url = response.url();
      if (!url.includes('/squash/backend/')) return;
      if (!/campaign-tree|iteration-view|test-suite-view|test-plan|campaign-workspace|referential/i.test(url)) return;
      const contentType = response.headers()['content-type'] || '';
      if (!contentType.includes('json')) return;
      try {
        capturedPayloads.push({ url, payload: await response.json() });
      } catch {
        // ignore non-json backend responses
      }
    });

    async function isBackendOk() {
      return page.evaluate(async () => {
        try {
          const response = await fetch('/squash/backend/referential', {
            credentials: 'include',
            headers: { Accept: 'application/json' },
          });
          return response.ok;
        } catch {
          return false;
        }
      }).catch(() => false);
    }

    async function tryAutoLogin() {
      const username = String(config.SQUASH_USERNAME || '').trim();
      const password = String(config.SQUASH_PASSWORD || '');
      if (!username || !password) return false;

      const usernameInput = page.locator('input[name="username"], input#username, input[type="email"], input[type="text"]').first();
      const passwordInput = page.locator('input[name="password"], input#password, input[type="password"]').first();
      if (!(await usernameInput.count().catch(() => 0)) || !(await passwordInput.count().catch(() => 0))) {
        return false;
      }

      await usernameInput.fill(username).catch(() => null);
      await passwordInput.fill(password).catch(() => null);

      const submitByRole = page.getByRole('button', { name: /connexion|se connecter|login|sign in/i }).first();
      if (await submitByRole.count().catch(() => 0)) {
        await submitByRole.click({ force: true }).catch(() => null);
      } else {
        const submit = page.locator('button[type="submit"], input[type="submit"]').first();
        if (await submit.count().catch(() => 0)) {
          await submit.click({ force: true }).catch(() => null);
        } else {
          await passwordInput.press('Enter').catch(() => null);
        }
      }

      await page.waitForTimeout(3000);
      return isBackendOk();
    }

    async function waitForInteractiveLogin() {
      if (String(config.SQUASH_SESSION_INTERACTIVE || '') !== '1') return false;
      console.log('[QA][SQUASH] Session non valide. Tentative de connexion automatique...');
      await page.goto(`${baseUrl}/login?redirect-after-auth=%2Fhome-workspace`, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      }).catch(() => null);

      if (await tryAutoLogin()) return true;
      console.log('[QA][SQUASH] Connexion automatique non confirmee. Connexion manuelle possible dans la fenetre Squash...');

      const timeoutMs = Number(config.SQUASH_LOGIN_TIMEOUT_MS || 10 * 60 * 1000);
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeoutMs) {
        await page.waitForTimeout(2000);
        if (await isBackendOk()) return true;
      }
      return false;
    }

    await page.goto(`${baseUrl}/home-workspace`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    let backendOk = await isBackendOk();
    if (!backendOk) {
      backendOk = await waitForInteractiveLogin();
    }

    if (!backendOk) {
      return {
        source: 'session Squash invalide',
        payload: null,
        error: 'Session Squash expiree ou backend non autorise. Relance avec SQUASH_SESSION_INTERACTIVE=1 ou utilise un SQUASH_TOKEN.',
      };
    }

    await page.goto(`${baseUrl}/campaign-workspace`, { waitUntil: 'networkidle', timeout: 90000 }).catch(() => null);
    await page.waitForTimeout(Number(config.SQUASH_SESSION_CAPTURE_MS || 5000));

    if (String(config.SQUASH_SESSION_DEBUG || '') === '1') {
      const debugPath = path.join(projectRoot, 'reports', 'squash-session-debug.json');
      fs.mkdirSync(path.dirname(debugPath), { recursive: true });
      fs.writeFileSync(debugPath, JSON.stringify({
        capturedPayloadCount: capturedPayloads.length,
        payloadSummaries: capturedPayloads.map(({ url, payload }) => ({
          url,
          keys: payload && typeof payload === 'object' ? Object.keys(payload).slice(0, 30) : [],
          sample: payload,
        })),
      }, null, 2), 'utf8');
      console.log(`[QA][SQUASH] Debug session: ${debugPath}`);
    }

    const payload = await fetchSquashTreePayload(page, config, options)
      || buildPayloadFromSessionPayloads(capturedPayloads.map((item) => item.payload), config);
    if (!payload) {
      return {
        source: 'session Squash incomplete',
        payload: null,
        error: 'Session connectee, mais aucun scenario exploitable detecte dans les reponses UI Squash.',
      };
    }

    return {
      source: 'session navigateur Squash',
      payload,
    };
  } catch (error) {
    return {
      source: 'session Squash erreur',
      payload: null,
      error: error.message || String(error),
    };
  } finally {
    await context.close().catch(() => null);
  }
}

async function loadSquashData(config, options = {}) {
  const apiData = await tryFetchSquash(config);
  if (apiData) return apiData;
  const sessionData = await tryFetchSquashWithSession(config, options);
  if (sessionData?.payload) return sessionData;
  if (sessionData?.error) {
    console.warn(`[QA][SQUASH] ${sessionData.error}`);
  }
  return readSample();
}

module.exports = {
  loadSquashData,
};
