const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const projectRoot = path.resolve(__dirname, '../..');
const sessionPath = path.join(projectRoot, 'authentification', 'eudonet-session.json');
const eudonetUrl = process.env.EUDONET_URL || 'https://test-omnes.eudonet.com/recette';
const browserChannel = String(process.env.PW_CHANNEL || 'chrome').trim();
const browserWidth = Number(process.env.EUDONET_BROWSER_WIDTH || 1400);
const browserHeight = Number(process.env.EUDONET_BROWSER_HEIGHT || 900);
const EUDONET_SCHOOL_ALIASES = {
  bachelorsinseec: ['BCh', 'INSEEC Bachelor'],
};

let browser;
let activePage;
let logPath;
let screenshotPath;
let resultPath;

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr-FR')
    .replace(/\s+/g, ' ')
    .trim();
}

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  if (logPath) fs.appendFileSync(logPath, `${line}\n`, 'utf8');
}

function parseArgs(argv) {
  const options = {
    contextPath: '',
    initialStatut: '01. Candidat en cours',
    initialEtape: '2. Parcours & PJ',
    targetStatut: '04. Admis - Inscription en attente de paiement',
    targetEtape: 'Inscription',
    timeoutMs: 180000,
    headless: String(process.env.EUDONET_HEADLESS || '') === '1',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--context' && argv[index + 1]) {
      options.contextPath = path.resolve(argv[index + 1]);
      index += 1;
    } else if (token === '--initial-statut' && argv[index + 1]) {
      options.initialStatut = argv[index + 1];
      index += 1;
    } else if (token === '--initial-etape' && argv[index + 1]) {
      options.initialEtape = argv[index + 1];
      index += 1;
    } else if (token === '--target-statut' && argv[index + 1]) {
      options.targetStatut = argv[index + 1];
      index += 1;
    } else if (token === '--target-etape' && argv[index + 1]) {
      options.targetEtape = argv[index + 1];
      index += 1;
    } else if (token === '--timeout-ms' && argv[index + 1]) {
      options.timeoutMs = Number(argv[index + 1]);
      index += 1;
    } else if (token === '--headless') {
      options.headless = true;
    } else {
      throw new Error(`Option inconnue: ${token}`);
    }
  }

  if (!options.contextPath) throw new Error('Option --context obligatoire.');
  return options;
}

function allFrames(context) {
  return context.pages().flatMap((page) => page.frames().slice().reverse());
}

async function firstVisible(context, factories) {
  for (const frame of allFrames(context)) {
    for (const factory of factories) {
      const locator = factory(frame).first();
      if (
        await locator.count().catch(() => 0)
        && await locator.isVisible().catch(() => false)
      ) {
        return { frame, locator };
      }
    }
  }
  return null;
}

async function waitForVisible(context, factories, label, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const target = await firstVisible(context, factories);
    if (target) return target;
    await activePage.waitForTimeout(400);
  }
  throw new Error(`${label} introuvable apres ${Math.round(timeout / 1000)} secondes.`);
}

async function firstExisting(context, factories) {
  for (const frame of allFrames(context)) {
    for (const factory of factories) {
      const locator = factory(frame).first();
      if (await locator.count().catch(() => 0)) {
        return { frame, locator };
      }
    }
  }
  return null;
}

async function takeScreenshot() {
  if (!activePage || activePage.isClosed()) return;
  await activePage.bringToFront().catch(() => null);
  await activePage.screenshot({ path: screenshotPath, fullPage: true }).catch(async () => {
    await activePage.screenshot({ path: screenshotPath });
  });
  log(`Capture enregistree: ${screenshotPath}`);
}

async function openCandidature(context, candidate, program, timeoutMs) {
  const query = `${candidate.nom} ${candidate.prenom}`.trim();
  const expectedSchools = EUDONET_SCHOOL_ALIASES[program?.schoolSlug]
    || [program?.schoolLabel || ''];
  const expectedCampus = program?.campus || '';
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;

  while (Date.now() < deadline) {
    attempt += 1;
    const tab = await waitForVisible(context, [
      (frame) => frame.locator('#tab_header_1400'),
      (frame) => frame.getByText(/^candidatures$/i),
    ], 'Menu Candidatures');
    await tab.locator.hover({ timeout: 5000 });

    const search = await waitForVisible(context, [
      (frame) => frame.locator('#mru_search_1400'),
    ], 'Champ de recherche Candidatures');
    await search.locator.click({ timeout: 5000 });
    await search.locator.press('Control+A');
    await search.locator.press('Backspace');
    await search.locator.pressSequentially(query, { delay: 80 });
    await activePage.waitForTimeout(1200);
    await search.locator.press('Enter').catch(() => null);
    log(`Recherche Candidatures tentative ${attempt}: ${query}`);

    let matchingResult = null;
    let rejectedMatches = [];
    const searchDeadline = Date.now() + 12000;
    while (!matchingResult && Date.now() < searchDeadline) {
      const rows = search.frame.locator('#ul_mru_1400 li.navLst[id]');
      const count = await rows.count().catch(() => 0);
      const matches = [];
      rejectedMatches = [];
      for (let index = 0; index < count; index += 1) {
        const row = rows.nth(index);
        if (!await row.isVisible().catch(() => false)) continue;
        const text = (await row.getAttribute('title').catch(() => ''))
          || (await row.innerText().catch(() => ''));
        const candidateMatches = (
          normalize(text).includes(normalize(candidate.nom))
          && normalize(text).includes(normalize(candidate.prenom))
        );
        const schoolMatches = expectedSchools.every((school) => !school)
          || expectedSchools.some((school) => (
            school && normalize(text).includes(normalize(school))
          ));
        const campusMatches = !expectedCampus
          || normalize(text).includes(normalize(expectedCampus));
        if (candidateMatches && schoolMatches && campusMatches) {
          matches.push({ row, text: String(text).trim().replace(/\s+/g, ' ') });
        } else if (candidateMatches) {
          rejectedMatches.push(String(text).trim().replace(/\s+/g, ' '));
        }
      }
      matches.sort((left, right) => right.text.localeCompare(left.text, 'fr'));
      if (matches.length) matchingResult = matches[0];
      if (!matchingResult) await activePage.waitForTimeout(500);
    }

    if (matchingResult) {
      log(`Candidature trouvee: ${matchingResult.text}`);
      await matchingResult.row.click({ timeout: 10000 });
      return matchingResult.text;
    }

    if (rejectedMatches.length) {
      log(`Resultats homonymes rejetes: ${JSON.stringify(rejectedMatches)}`);
    }
    log('Candidature non encore disponible; nouvel essai dans 5 secondes.');
    await activePage.waitForTimeout(5000);
  }

  throw new Error(`Candidature introuvable pour ${query}.`);
}

async function getField(context, fieldName, label) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    for (const frame of allFrames(context)) {
      const fields = frame.locator(`ul[field="${fieldName}"]`);
      const count = await fields.count().catch(() => 0);
      for (let index = 0; index < count; index += 1) {
        const locator = fields.nth(index);
        const container = locator.locator(
          'xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " globalDivComponent ")][1]'
        );
        if (
          await container.count().catch(() => 0)
          && await container.isVisible().catch(() => false)
        ) {
          return { frame, locator };
        }
      }
    }
    await activePage.waitForTimeout(400);
  }
  throw new Error(`Champ ${label} introuvable apres 30 secondes.`);
}

async function readCatalogValue(field) {
  const values = field.locator.locator('span.catalog-val');
  const count = await values.count().catch(() => 0);
  const texts = [];
  for (let index = 0; index < count; index += 1) {
    const text = (await values.nth(index).innerText().catch(() => '')).trim();
    if (text && !texts.includes(text)) texts.push(text);
  }
  return texts.join(', ');
}

async function findVisibleCatalogSearch(context, fieldName) {
  for (const frame of allFrames(context)) {
    const fields = frame.locator(`ul[field="${fieldName}"]`);
    const count = await fields.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const field = fields.nth(index);
      const container = field.locator(
        'xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " globalDivComponent ")][1]'
      );
      const input = container.locator('input.navSearch.mru-search').first();
      if (
        await container.isVisible().catch(() => false)
        && await input.count().catch(() => 0)
        && await input.isVisible().catch(() => false)
      ) {
        return { frame, field, container, input };
      }
    }
  }
  return null;
}

async function logFieldDiagnostics(context, fieldName, label) {
  const diagnostics = [];
  for (const frame of allFrames(context)) {
    const fields = frame.locator(`ul[field="${fieldName}"]`);
    const count = await fields.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const field = fields.nth(index);
      const container = field.locator(
        'xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " globalDivComponent ")][1]'
      );
      diagnostics.push({
        frameUrl: frame.url(),
        fieldVisible: await field.isVisible().catch(() => false),
        fieldHtml: await field.evaluate((element) => element.outerHTML).catch(() => ''),
        containerVisible: await container.isVisible().catch(() => false),
        containerHtml: await container.evaluate((element) => element.outerHTML.slice(0, 5000))
          .catch(() => ''),
      });
    }
  }
  log(`Diagnostic ${label}: ${JSON.stringify(diagnostics)}`);
}

async function waitForCatalogValue(context, fieldName, label, expectedValue, timeout = 30000) {
  const deadline = Date.now() + timeout;
  let lastValue = '';
  while (Date.now() < deadline) {
    const field = await getField(context, fieldName, label);
    lastValue = await readCatalogValue(field);
    if (normalize(lastValue) === normalize(expectedValue)) {
      await activePage.waitForTimeout(1500);
      const confirmed = await readCatalogValue(await getField(context, fieldName, label));
      if (normalize(confirmed) === normalize(expectedValue)) return confirmed;
    }
    await activePage.waitForTimeout(500);
  }
  throw new Error(`${label} non stabilise sur "${expectedValue}" (valeur="${lastValue}").`);
}

async function chooseEtapeFromCatalog(context, expectedValue) {
  const fieldName = 'field1442';
  const label = 'Etape';
  const field = await getField(context, fieldName, label);
  const currentValue = await readCatalogValue(field);
  if (normalize(currentValue) === normalize(expectedValue)) {
    log(`${label} deja conforme: ${currentValue}`);
    return currentValue;
  }

  const container = field.locator.locator(
    'xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " globalDivComponent ")][1]'
  );
  const opened = await container.evaluate((element) => {
    const trigger = element.querySelector('a.hover-pen, .hover-pen');
    if (!trigger) return false;
    trigger.click();
    return true;
  });
  if (!opened) {
    throw new Error('Controle d ouverture du champ Etape introuvable.');
  }

  const title = await waitForVisible(context, [
    (frame) => frame.locator('td.TitleModal').filter({
      hasText: /Catalogue\s*:\s*Etape/i,
    }),
  ], 'Modale Catalogue Etape', 30000);
  const titleText = (await title.locator.innerText()).trim().replace(/\s+/g, ' ');
  if (!/Catalogue\s*:\s*Etape/i.test(titleText)) {
    throw new Error(`Titre de modale inattendu: "${titleText}".`);
  }
  log(`Modale ouverte et verifiee: ${titleText}`);

  const modal = title.locator.locator(
    'xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " ContainerModal ")][1]'
  );
  const iframe = modal.locator('iframe').last();
  const iframeHandle = await iframe.elementHandle();
  const catalogFrame = await iframeHandle.contentFrame();
  if (!catalogFrame) {
    throw new Error('Iframe de la modale Catalogue Etape introuvable.');
  }

  const search = catalogFrame.locator('input#eTxtSrch.eTxtSrch, input#eTxtSrch').first();
  await search.waitFor({ state: 'visible', timeout: 30000 });
  await search.click();
  await search.fill('');
  await search.pressSequentially(expectedValue, { delay: 50 });
  log(`Recherche Etape saisie: ${expectedValue}`);

  const matchingLabel = catalogFrame.locator('#lbl_20048').filter({
    hasText: /^Inscription$/,
  });
  await matchingLabel.waitFor({ state: 'visible', timeout: 30000 });
  const matchingText = (await matchingLabel.innerText()).trim().replace(/\s+/g, ' ');
  if (normalize(matchingText) !== normalize(expectedValue)) {
    throw new Error(`Valeur Etape inattendue pour lbl_20048: "${matchingText}".`);
  }
  await matchingLabel.click({ timeout: 10000 });
  log('Valeur Etape selectionnee: Inscription (20048).');

  const validate = modal.locator('div#ok[ednmodalbtn="1"]').first();
  await validate.waitFor({ state: 'visible', timeout: 10000 });
  await validate.evaluate((element) => element.click());
  log('Bouton Valider du catalogue Etape clique.');

  await modal.waitFor({ state: 'hidden', timeout: 20000 });
  const finalValue = await waitForCatalogValue(
    context,
    fieldName,
    label,
    expectedValue
  );
  log(`${label} modifie et verifie: ${finalValue}`);
  return finalValue;
}

async function chooseFromFullCatalog(context, container, fieldName, label, expectedValue) {
  const opened = await container.evaluate((element) => {
    const trigger = element.querySelector('.list-opening');
    if (!trigger) return false;
    trigger.click();
    return true;
  }).catch(() => false);
  if (!opened) return '';
  log(`Option Toute la liste selectionnee pour ${label}.`);

  const deadline = Date.now() + 30000;
  let modalFrame = null;
  while (!modalFrame && Date.now() < deadline) {
    for (const frame of allFrames(context)) {
      const modal = frame.locator('.ContainerModal:visible').last();
      if (!await modal.count().catch(() => 0)) continue;
      const iframe = modal.locator('iframe').last();
      const iframeHandle = await iframe.elementHandle().catch(() => null);
      modalFrame = iframeHandle ? await iframeHandle.contentFrame().catch(() => null) : null;
      if (modalFrame) break;
    }
    if (!modalFrame) await activePage.waitForTimeout(400);
  }
  if (!modalFrame) {
    throw new Error(`Iframe de Toute la liste introuvable pour ${label}.`);
  }

  const matchingValue = modalFrame.getByText(expectedValue, { exact: true }).first();
  await matchingValue.waitFor({ state: 'visible', timeout: 20000 });
  const matchingRow = matchingValue.locator('xpath=ancestor::tr[1]');
  const valueId = await matchingRow.locator('td').last().innerText().catch(() => '');
  log(`Valeur ${label} trouvee dans Toute la liste: ${valueId.trim() || expectedValue}`);
  await matchingValue.click({ timeout: 10000 });

  const validate = await waitForVisible(context, [
    (frame) => frame.locator('.ContainerModal:visible #ok-mid').filter({ hasText: /^Valider$/i }),
    (frame) => frame.locator('#ok-mid').filter({ hasText: /^Valider$/i }),
    (frame) => frame.locator('div#ok[ednmodalbtn="1"]'),
    (frame) => frame.locator('div#ok:has(> #ok-mid)'),
    (frame) => frame.getByRole('button', { name: /^Valider$/i }),
  ], `Bouton Valider du catalogue ${label}`, 10000);
  await validate.locator.evaluate((element) => {
    const button = element.closest('#ok') || element;
    button.click();
  });

  const closeDeadline = Date.now() + 10000;
  while (Date.now() < closeDeadline) {
    const openCatalog = await firstVisible(context, [
      (frame) => frame.locator('.ContainerModal:visible #ok-mid')
        .filter({ hasText: /^Valider$/i }),
    ]);
    if (!openCatalog) break;
    await activePage.waitForTimeout(250);
  }
  const catalogStillOpen = await firstVisible(context, [
    (frame) => frame.locator('.ContainerModal:visible #ok-mid')
      .filter({ hasText: /^Valider$/i }),
  ]);
  if (catalogStillOpen) {
    const appliedValue = await readCatalogValue(
      await getField(context, fieldName, label)
    );
    if (normalize(appliedValue) !== normalize(expectedValue)) {
      throw new Error(
        `Catalogue ${label} toujours ouvert et valeur non appliquee: "${appliedValue}".`
      );
    }

    log(`Valeur ${label} appliquee; fermeture du catalogue residuel.`);
    const closed = await catalogStillOpen.frame.evaluate(() => {
      const isVisible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0
          && rect.height > 0
          && style.display !== 'none'
          && style.visibility !== 'hidden';
      };
      const modals = Array.from(document.querySelectorAll('.ContainerModal')).filter(isVisible);
      const modal = modals.at(-1);
      if (!modal) return false;
      const close = Array.from(modal.querySelectorAll(
        '[title*="Fermer" i], [title*="Close" i], [class*="close" i], '
          + '.icon-edn-cross, .icon-cross'
      )).find(isVisible);
      if (!close) return false;
      close.click();
      return true;
    }).catch(() => false);
    if (!closed) {
      throw new Error(`Catalogue ${label} applique mais impossible a fermer.`);
    }

    const residualDeadline = Date.now() + 10000;
    while (Date.now() < residualDeadline) {
      const residual = await firstVisible(context, [
        (frame) => frame.locator('.ContainerModal:visible #ok-mid')
          .filter({ hasText: /^Valider$/i }),
      ]);
      if (!residual) break;
      await activePage.waitForTimeout(250);
    }
  }

  return waitForCatalogValue(context, fieldName, label, expectedValue);
}

async function chooseModernCatalogValue(context, fieldName, label, expectedValue) {
  let field = await getField(context, fieldName, label);
  const currentValue = await readCatalogValue(field);
  if (normalize(currentValue) === normalize(expectedValue)) {
    log(`${label} deja conforme: ${currentValue}`);
    return currentValue;
  }

  const container = field.locator.locator(
    'xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " globalDivComponent ")][1]'
  );
  await container.hover().catch(() => null);
  const pencils = container.locator('a.hover-pen, .hover-pen');
  const clickTargets = [];
  const pencilCount = await pencils.count().catch(() => 0);
  for (let index = 0; index < pencilCount; index += 1) {
    const candidate = pencils.nth(index);
    if (await candidate.isVisible().catch(() => false)) {
      clickTargets.push(candidate);
    }
  }
  clickTargets.push(
    container.locator('.catAccordion').first(),
    container.locator('#drop-recherche').first(),
    container
  );

  let searchTarget = await findVisibleCatalogSearch(context, fieldName);
  for (const clickTarget of clickTargets) {
    if (searchTarget) break;
    if (
      !await clickTarget.count().catch(() => 0)
      || !await clickTarget.isVisible().catch(() => false)
    ) {
      continue;
    }
    await clickTarget.click({ timeout: 10000, force: true }).catch(() => null);
    const openDeadline = Date.now() + 4000;
    while (!searchTarget && Date.now() < openDeadline) {
      searchTarget = await findVisibleCatalogSearch(context, fieldName);
      if (!searchTarget) await activePage.waitForTimeout(250);
    }
  }

  if (!searchTarget) {
    const fullCatalogValue = await chooseFromFullCatalog(
      context,
      container,
      fieldName,
      label,
      expectedValue
    );
    if (fullCatalogValue) {
      log(`${label} modifie et verifie: ${fullCatalogValue}`);
      return fullCatalogValue;
    }
    await logFieldDiagnostics(context, fieldName, label);
    throw new Error(`Recherche du champ ${label} introuvable apres 30 secondes.`);
  }
  const searchLocator = searchTarget.input;
  const activeContainer = searchTarget.container;
  await searchLocator.fill(expectedValue);
  log(`Recherche ${label}: ${expectedValue}`);

  const targetDeadline = Date.now() + 20000;
  let target = null;
  while (!target && Date.now() < targetDeadline) {
    const options = activeContainer.locator('li.mru-li');
    const count = await options.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const option = options.nth(index);
      if (!await option.isVisible().catch(() => false)) continue;
      const text = (await option.innerText().catch(() => '')).trim().replace(/\s+/g, ' ');
      if (normalize(text) === normalize(expectedValue)) {
        target = option;
        break;
      }
    }
    if (!target) await activePage.waitForTimeout(400);
  }
  if (!target) {
    throw new Error(`Valeur "${expectedValue}" introuvable pour ${label}.`);
  }

  await target.click({ timeout: 10000 });
  const updateDeadline = Date.now() + 30000;
  let finalValue = '';
  while (Date.now() < updateDeadline) {
    await activePage.waitForTimeout(500);
    field = await getField(context, fieldName, label);
    finalValue = await readCatalogValue(field);
    if (normalize(finalValue) === normalize(expectedValue)) break;
  }
  if (normalize(finalValue) !== normalize(expectedValue)) {
    throw new Error(`${label} incorrect apres modification: "${finalValue}".`);
  }
  log(`${label} modifie et verifie: ${finalValue}`);
  return finalValue;
}

async function saveCandidature(context) {
  const save = await firstVisible(context, [
    (frame) => frame.locator('div#save[ednmodalbtn="1"]'),
    (frame) => frame.locator('#save-mid').filter({ hasText: /^Valider$/i }),
    (frame) => frame.getByRole('button', { name: /^(enregistrer|valider)$/i }),
    (frame) => frame.getByRole('link', { name: /^(enregistrer|valider)$/i }),
    (frame) => frame.locator('[title*="Enregistrer" i], [title*="Valider" i]'),
  ]);
  if (save) {
    await save.locator.click({ timeout: 10000 });
    log('Sauvegarde de la Candidature declenchee.');
  } else {
    log('Aucun bouton de sauvegarde visible; sauvegarde automatique Eudonet attendue.');
  }
  await activePage.waitForTimeout(2000);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(sessionPath)) throw new Error(`Session Eudonet introuvable: ${sessionPath}`);
  if (!fs.existsSync(options.contextPath)) {
    throw new Error(`Contexte candidat introuvable: ${options.contextPath}`);
  }

  const processDir = path.dirname(options.contextPath);
  fs.mkdirSync(processDir, { recursive: true });
  logPath = path.join(processDir, 'eudonet-update-candidature.log');
  screenshotPath = path.join(processDir, 'eudonet-update-candidature.png');
  resultPath = path.join(processDir, 'eudonet-result.json');
  fs.writeFileSync(logPath, '', 'utf8');

  const sharedContext = JSON.parse(
    fs.readFileSync(options.contextPath, 'utf8').replace(/^\uFEFF/, '')
  );
  const candidate = sharedContext.candidate || {};
  if (!candidate.nom || !candidate.prenom) {
    throw new Error('Le contexte candidat doit contenir candidate.nom et candidate.prenom.');
  }

  log(`Candidat cible: ${candidate.nom} ${candidate.prenom}`);
  log(`Transition Statut: ${options.initialStatut} -> ${options.targetStatut}`);
  log(`Transition Etape: ${options.initialEtape} -> ${options.targetEtape}`);

  browser = await chromium.launch({
    headless: options.headless,
    channel: browserChannel || undefined,
    slowMo: Number(process.env.SLOW_MO_MS || 100),
    args: options.headless ? [] : [`--window-size=${browserWidth},${browserHeight}`],
  });
  const context = await browser.newContext({
    storageState: sessionPath,
    ignoreHTTPSErrors: true,
    viewport: { width: browserWidth, height: browserHeight },
    screen: { width: browserWidth, height: browserHeight },
  });
  activePage = await context.newPage();
  await activePage.goto(eudonetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await activePage.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => null);
  log(`Page chargee: ${activePage.url()}`);

  const candidatureLabel = await openCandidature(
    context,
    candidate,
    sharedContext.program || {},
    options.timeoutMs
  );
  const statutField = await getField(context, 'field1402', 'Statut');
  const etapeField = await getField(context, 'field1442', 'Etape');
  const initialStatut = await readCatalogValue(statutField);
  const initialEtape = await readCatalogValue(etapeField);
  log(`Valeur initiale Statut: ${initialStatut}`);
  log(`Valeur initiale Etape: ${initialEtape}`);

  if (
    normalize(initialStatut) !== normalize(options.initialStatut)
    && normalize(initialStatut) !== normalize(options.targetStatut)
  ) {
    throw new Error(`Statut initial inattendu: "${initialStatut}".`);
  }
  if (
    normalize(initialEtape) !== normalize(options.initialEtape)
    && normalize(initialEtape) !== normalize(options.targetEtape)
    && !(normalize(initialStatut) === normalize(options.targetStatut) && !initialEtape)
  ) {
    throw new Error(`Etape initiale inattendue: "${initialEtape}".`);
  }

  await chooseModernCatalogValue(context, 'field1402', 'Statut', options.targetStatut);
  await waitForCatalogValue(context, 'field1402', 'Statut', options.targetStatut);
  await chooseEtapeFromCatalog(context, options.targetEtape);
  await saveCandidature(context);

  await openCandidature(context, candidate, sharedContext.program || {}, 60000);
  const finalStatut = await readCatalogValue(await getField(context, 'field1402', 'Statut'));
  const finalEtape = await readCatalogValue(await getField(context, 'field1442', 'Etape'));
  if (normalize(finalStatut) !== normalize(options.targetStatut)) {
    throw new Error(`Statut final incorrect: "${finalStatut}".`);
  }
  if (normalize(finalEtape) !== normalize(options.targetEtape)) {
    throw new Error(`Etape finale incorrecte: "${finalEtape}".`);
  }

  await takeScreenshot();
  const result = {
    success: true,
    candidatureLabel,
    candidate,
    initial: { statut: initialStatut, etape: initialEtape },
    final: { statut: finalStatut, etape: finalEtape },
    screenshotPath,
    logPath,
  };
  fs.writeFileSync(resultPath, JSON.stringify(result, null, 2), 'utf8');
  sharedContext.eudonet = {
    status: 'updated',
    candidatureLabel,
    initial: result.initial,
    final: result.final,
  };
  sharedContext.updatedAt = new Date().toISOString();
  fs.writeFileSync(options.contextPath, JSON.stringify(sharedContext, null, 2), 'utf8');
  log('Candidature Eudonet mise a jour et verifiee.');
  await browser.close();
}

main().catch(async (error) => {
  log(`ERREUR: ${error.message || error}`);
  await takeScreenshot().catch(() => null);
  if (resultPath) {
    fs.writeFileSync(resultPath, JSON.stringify({
      success: false,
      error: error.message || String(error),
      screenshotPath,
      logPath,
    }, null, 2), 'utf8');
  }
  if (browser) await browser.close().catch(() => null);
  process.exitCode = 1;
});
