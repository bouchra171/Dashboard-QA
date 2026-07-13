const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '../..');
const defaultCandidatePath = path.join(projectRoot, 'authentification', 'eudonet-contact-data-used.json');
const sessionPath = path.join(projectRoot, 'authentification', 'agate-session.json');
const reportDir = path.join(projectRoot, 'authentification');
const reportPath = path.join(reportDir, 'agate-search-report.json');
const screenshotPath = path.join(reportDir, 'agate-search-candidate.png');
const AGATE_URL = process.env.AGATE_URL || 'https://agate.rec.omneseducation.com/admin/felix/candidat/';
const BROWSER_CHANNEL = String(process.env.PW_CHANNEL || 'chrome').trim();
const browserWidth = Number(process.env.AGATE_BROWSER_WIDTH || 1400);
const browserHeight = Number(process.env.AGATE_BROWSER_HEIGHT || 900);

function parseArgs(argv) {
  const options = {
    candidatePath: defaultCandidatePath,
    headless: String(process.env.AGATE_HEADLESS || '') === '1',
    keepOpenMs: Number(process.env.KEEP_OPEN_MS || 5000),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--candidate' || arg === '--data') {
      options.candidatePath = path.resolve(process.cwd(), argv[index + 1]);
      index += 1;
    } else if (arg === '--headless') {
      options.headless = true;
    } else if (arg === '--keep-open-ms') {
      options.keepOpenMs = Number(argv[index + 1]);
      index += 1;
    } else {
      throw new Error(`Option inconnue: ${arg}`);
    }
  }

  return options;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function candidateSearchTerms(candidate) {
  return [
    candidate.numeroDossier,
    candidate.numeroDossierOmnes,
    candidate.dossierOmnes,
    candidate.noDossier,
    `${candidate.nomContact || ''} ${candidate.prenom || ''}`.trim(),
    candidate.nomContact,
  ].filter(Boolean);
}

function inferAcademicYear(candidate) {
  const explicit = String(candidate.anneeUniversitaire || candidate.academicYear || '').trim();
  if (/^\d{4}\/\d{4}$/.test(explicit)) return explicit;

  const source = `${candidate.sessionRentree || ''} ${candidate.promotion || ''}`;
  const years = Array.from(source.matchAll(/\b(20\d{2})\b/g)).map((match) => Number(match[1]));
  if (!years.length) return '2026/2027';
  const year = Math.min(...years);
  return `${year}/${year + 1}`;
}

async function visibleText(page) {
  return page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
}

function isAuthenticationPage(url, text) {
  return /adfs|login|oauth|authorize|password\.omneseducation|microsoftonline/i.test(url)
    || /connexion avec votre compte|bienvenue \/ welcome|mot de passe|password reset/i.test(text);
}

async function waitForAgateCandidatePage(page, timeout = 45000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const text = await visibleText(page);
    if (/liste des candidats/i.test(text) && /candidat/i.test(text)) return true;
    await page.waitForTimeout(1000).catch(() => null);
  }
  return false;
}

async function findSearchInput(page) {
  const candidates = [
    page.locator('#candidat_search_nom').first(),
    page.locator('input[name="candidat_search[nom]"]').first(),
    page.locator('xpath=//*[contains(normalize-space(), "Candidat")]/following::input[1]').first(),
    page.locator('xpath=//*[contains(normalize-space(), "Nom") or contains(normalize-space(), "Prenom") or contains(normalize-space(), "Prénom")]/following::input[1]').first(),
    page.locator('input[name*="candidat" i], input[id*="candidat" i]').first(),
    page.locator('input[type="search"]').first(),
    page.locator('input[placeholder*="Recherche" i], input[placeholder*="Search" i]').first(),
    page.locator('input[name*="search" i], input[id*="search" i]').first(),
    page.locator('input[aria-label*="Recherche" i], input[aria-label*="Search" i]').first(),
    page.getByRole('textbox').first(),
  ];

  for (const locator of candidates) {
    if (await locator.count().catch(() => 0) && await locator.isVisible().catch(() => false)) {
      return locator;
    }
  }

  const marked = await page.evaluate(() => {
    const norm = (value) => String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const labels = Array.from(document.querySelectorAll('label, div, span'))
      .filter((element) => visible(element) && norm(element.textContent).startsWith('candidat'));
    const label = labels
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .sort((left, right) => (left.rect.top - right.rect.top) || (left.rect.left - right.rect.left))[0];
    if (!label) return false;
    const labelRect = label.rect;
    const inputs = Array.from(document.querySelectorAll('input'))
      .filter((element) => visible(element))
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter((item) => {
        const nearX = item.rect.left >= labelRect.left - 20 && item.rect.left <= labelRect.left + 260;
        const nearY = item.rect.top >= labelRect.bottom - 5 && item.rect.top <= labelRect.bottom + 70;
        return nearX && nearY;
      })
      .sort((left, right) => (left.rect.top - right.rect.top) || (left.rect.left - right.rect.left));
    const input = inputs[0]?.element;
    if (!input) return false;
    input.setAttribute('data-agate-candidat-search', '1');
    return true;
  }).catch(() => false);
  if (marked) {
    const locator = page.locator('input[data-agate-candidat-search="1"]').first();
    if (await locator.count().catch(() => 0) && await locator.isVisible().catch(() => false)) return locator;
  }
  return null;
}

async function submitSearch(page, input, term) {
  await input.click({ timeout: 10000, force: true });
  await input.fill('');
  await input.type(term, { delay: 35 });
  await input.press('Enter').catch(() => null);
  const searchButton = page.getByRole('button', { name: /rechercher/i }).first();
  if (await searchButton.count().catch(() => 0)) {
    await searchButton.click({ force: true }).catch(() => null);
  } else {
    await page.evaluate(() => {
      const visible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const candidates = Array.from(document.querySelectorAll('button, a'))
        .filter((element) => visible(element))
        .map((element) => ({ element, rect: element.getBoundingClientRect(), text: String(element.textContent || element.title || '') }))
        .filter((item) => {
          const inTopActions = item.rect.top >= 130 && item.rect.top <= 230 && item.rect.left > window.innerWidth - 190;
          const looksSearch = /rechercher|search/i.test(item.text) || /fa-search|search|magnify/i.test(item.element.innerHTML || '');
          return inTopActions && looksSearch;
        })
        .sort((left, right) => left.rect.left - right.rect.left);
      const target = candidates[0]?.element;
      if (!target) return false;
      target.click();
      return true;
    }).catch(() => false);
  }
  await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => null);
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => null);
  await page.waitForTimeout(2000);
}

async function setInputValue(locator, value) {
  if (!(await locator.count().catch(() => 0))) return false;
  await locator.click({ force: true }).catch(() => null);
  await locator.fill('').catch(async () => {
    await locator.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => null);
    await locator.press('Backspace').catch(() => null);
  });
  await locator.type(value, { delay: 20 }).catch(async () => locator.fill(value));
  return true;
}

async function setAllSchoolsToYes(page) {
  const directSet = await page.evaluate(() => {
    const norm = (value) => String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
    const radios = Array.from(document.querySelectorAll('input[type="radio"][name="candidat_search[rechercheMultiEcoles]"]'));
    if (!radios.length) return { found: false, value: '' };
    const target = radios.find((radio) => norm(radio.getAttribute('data-label')) === 'oui')
      || radios.find((radio) => String(radio.value) === '1');
    if (!target) return { found: true, value: '' };
    target.checked = true;
    target.setAttribute('checked', 'checked');
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
    if (window.jQuery) {
      window.jQuery(target).prop('checked', true).trigger('change');
    }
    if (typeof window.rafraichir_bouton_candidat_search_rechercheMultiEcoles === 'function') {
      window.rafraichir_bouton_candidat_search_rechercheMultiEcoles();
    }
    const switchButton = document.querySelector('#switchMultiState_candidat_search_rechercheMultiEcoles');
    if (switchButton && target.getAttribute('data-label')) {
      switchButton.innerHTML = target.getAttribute('data-label');
      const color = target.getAttribute('data-color');
      if (color) switchButton.className = `btn ${color}`;
    }
    return {
      found: true,
      value: norm(target.getAttribute('data-label') || switchButton?.textContent || ''),
    };
  }).catch(() => ({ found: false, value: '' }));
  if (directSet.value === 'oui') return true;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const clicked = await page.evaluate(() => {
      const norm = (value) => String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
      const visible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const labels = Array.from(document.querySelectorAll('label, div, span'))
        .filter((element) => visible(element) && norm(element.textContent).includes('toutes les ecoles'));
      const label = labels
        .map((element) => ({ element, rect: element.getBoundingClientRect() }))
        .sort((left, right) => (left.rect.width * left.rect.height) - (right.rect.width * right.rect.height))[0];
      if (!label) return { found: false, value: '', clicked: false };

      const labelRect = label.rect;
      const candidates = Array.from(document.querySelectorAll('button, a, span, label, input, div'))
        .filter((element) => visible(element))
        .map((element) => ({
          element,
          rect: element.getBoundingClientRect(),
          text: norm(element.textContent || element.value || element.getAttribute('aria-label') || ''),
        }))
        .filter((item) => {
          const nearX = item.rect.left >= labelRect.left - 40 && item.rect.left <= labelRect.left + 280;
          const nearY = item.rect.top >= labelRect.bottom - 10 && item.rect.top <= labelRect.bottom + 90;
          return nearX && nearY && (item.text === 'non' || item.text === 'oui' || item.element.tagName === 'INPUT');
        })
        .sort((left, right) => {
          const leftDistance = Math.abs(left.rect.top - labelRect.bottom) + Math.abs(left.rect.left - labelRect.left);
          const rightDistance = Math.abs(right.rect.top - labelRect.bottom) + Math.abs(right.rect.left - labelRect.left);
          return leftDistance - rightDistance;
        });
      const current = candidates.find((item) => item.text === 'oui' || item.text === 'non') || candidates[0];
      if (!current) return { found: true, value: '', clicked: false };
      if (current.text === 'oui') return { found: true, value: 'oui', clicked: false };

      const target = current.element.closest('button, a, label, div[role="button"], div, span') || current.element;
      target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
      target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
      target.click();
      return { found: true, value: current.text, clicked: true };
    }).catch(() => ({ found: false, value: '', clicked: false }));

    if (!clicked.found) return false;
    if (clicked.value === 'oui') return true;
    await page.waitForTimeout(800);

    await page.evaluate(() => {
      const norm = (value) => String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
      const visible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const options = Array.from(document.querySelectorAll('button, a, span, label, li, div'))
        .filter((element) => visible(element) && norm(element.textContent || element.value || element.getAttribute('aria-label') || '') === 'oui')
        .map((element) => ({ element, rect: element.getBoundingClientRect() }))
        .sort((left, right) => (left.rect.width * left.rect.height) - (right.rect.width * right.rect.height));
      const target = options[0]?.element;
      if (!target) return false;
      target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
      target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
      target.click();
      return true;
    }).catch(() => false);
    await page.waitForTimeout(800);

    const isYes = await page.evaluate(() => {
      const norm = (value) => String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
      const visible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const label = Array.from(document.querySelectorAll('label, div, span'))
        .find((element) => visible(element) && norm(element.textContent).includes('toutes les ecoles'));
      if (!label) return false;
      const labelRect = label.getBoundingClientRect();
      return Array.from(document.querySelectorAll('button, a, span, label, input, div'))
        .filter((element) => visible(element))
        .some((element) => {
          const rect = element.getBoundingClientRect();
          const nearX = rect.left >= labelRect.left - 40 && rect.left <= labelRect.left + 280;
          const nearY = rect.top >= labelRect.bottom - 10 && rect.top <= labelRect.bottom + 90;
          return nearX && nearY && norm(element.textContent || element.value || element.getAttribute('aria-label') || '') === 'oui';
        });
    }).catch(() => false);
    if (isYes) return true;
  }

  return false;
}

async function setAgateFilters(page, candidate) {
  const academicYear = inferAcademicYear(candidate);
  const result = {
    academicYear,
    academicYearSet: false,
    allSchoolsSet: false,
  };

  const yearSelect = page.locator('select[name*="annee" i], select[id*="annee" i], select[name*="universitaire" i], select[id*="universitaire" i]').first();
  if (await yearSelect.count().catch(() => 0)) {
    await yearSelect.selectOption({ label: academicYear }).catch(async () => {
      await yearSelect.selectOption(academicYear).catch(() => null);
    });
    result.academicYearSet = true;
  } else {
    const yearInput = page.locator('input[name*="annee" i], input[id*="annee" i], input[name*="universitaire" i], input[id*="universitaire" i]').first();
    result.academicYearSet = await setInputValue(yearInput, academicYear);
  }

  result.allSchoolsSet = await setAllSchoolsToYes(page);

  await page.waitForTimeout(1000);
  return result;
}

async function waitForAgateListStable(page, timeout = 60000) {
  const deadline = Date.now() + timeout;
  let previousText = '';
  let stableCount = 0;

  while (Date.now() < deadline) {
    await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => null);
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => null);

    const loading = await page
      .locator('.spinner, .loading, .blockUI, .dataTables_processing, [aria-busy="true"]')
      .filter({ hasText: /charg|loading|traitement|processing/i })
      .count()
      .catch(() => 0);
    const text = (await visibleText(page)).replace(/\s+/g, ' ').slice(0, 1200);

    if (!loading && text && text === previousText) {
      stableCount += 1;
      if (stableCount >= 2) return true;
    } else {
      stableCount = 0;
      previousText = text;
    }

    await page.waitForTimeout(3000);
  }
  return false;
}

async function tryOpenSearchPage(page) {
  const searchLinks = [
    page.getByRole('link', { name: /candidat|etudiant|dossier|recherche/i }).first(),
    page.getByRole('button', { name: /candidat|etudiant|dossier|recherche/i }).first(),
    page.locator('a[href*="candidat"], a[href*="student"], a[href*="dossier"]').first(),
  ];

  for (const link of searchLinks) {
    if (await link.count().catch(() => 0) && await link.isVisible().catch(() => false)) {
      await link.click({ force: true }).catch(() => null);
      await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => null);
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => null);
      await page.waitForTimeout(1000);
      return true;
    }
  }
  return false;
}

async function clickEudonetImportButton(page) {
  const candidates = [
    page.locator('a[title*="Eudonet" i], button[title*="Eudonet" i]').first(),
    page.locator('a[data-original-title*="Eudonet" i], button[data-original-title*="Eudonet" i]').first(),
    page.locator('a[title*="import" i], button[title*="import" i]').first(),
    page.locator('a[title*="recup" i], button[title*="recup" i]').first(),
    page.locator('a:has(i[class*="download"]), button:has(i[class*="download"])').first(),
    page.locator('a:has(.fa-download), button:has(.fa-download)').first(),
    page.locator('a:has(svg), button:has(svg)').filter({ hasText: /^$/ }).nth(1),
  ];

  for (const candidate of candidates) {
    if (await candidate.count().catch(() => 0) && await candidate.isVisible().catch(() => false)) {
      await candidate.click({ force: true }).catch(() => null);
      await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => null);
      await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => null);
      await waitForAgateListStable(page, 90000);
      return true;
    }
  }
  const clickedTopImport = await page.evaluate(() => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const actions = Array.from(document.querySelectorAll('button, a'))
      .filter((element) => visible(element))
      .map((element) => ({
        element,
        rect: element.getBoundingClientRect(),
        html: String(element.innerHTML || ''),
        text: String(element.textContent || element.title || element.getAttribute('aria-label') || ''),
      }))
      .filter((item) => item.rect.top >= 130 && item.rect.top <= 230 && item.rect.left > window.innerWidth - 190)
      .sort((left, right) => left.rect.left - right.rect.left);
    const semantic = actions.find((item) => /eudonet|import|recup|download|telecharger|fa-download|download/i.test(`${item.text} ${item.html}`));
    const target = semantic?.element || actions[1]?.element;
    if (!target) return false;
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    target.click();
    return true;
  }).catch(() => false);
  if (clickedTopImport) {
    await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => null);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => null);
    await waitForAgateListStable(page, 90000);
    return true;
  }
  return false;
}

function matchCandidateText(text, candidate) {
  const haystack = normalize(text);
  const email = normalize(candidate.courriel);
  const lastName = normalize(candidate.nomContact);
  const firstName = normalize(candidate.prenom);
  return Boolean(
    (email && haystack.includes(email))
    || (lastName && firstName && haystack.includes(lastName) && haystack.includes(firstName))
  );
}

async function extractCandidateRows(page, candidate) {
  const rows = [];
  const tableRows = page.locator('table tbody tr');
  const count = await tableRows.count().catch(() => 0);
  for (let index = 0; index < count; index += 1) {
    const row = tableRows.nth(index);
    if (!await row.isVisible().catch(() => false)) continue;
    const cells = await row.locator('td').allInnerTexts().catch(() => []);
    const text = cells.join(' ').replace(/\s+/g, ' ').trim();
    if (!matchCandidateText(text, candidate)) continue;
    rows.push({
      text,
      cells,
      dossierOmnes: cells.find((cell) => /\d{6,}/.test(String(cell || '')))?.replace(/\s+/g, ' ').trim() || '',
    });
  }
  return rows;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(sessionPath)) throw new Error(`Session Agate introuvable: ${sessionPath}`);
  if (!fs.existsSync(options.candidatePath)) throw new Error(`Donnees candidat introuvables: ${options.candidatePath}`);

  fs.mkdirSync(reportDir, { recursive: true });
  const candidate = readJson(options.candidatePath);
  const terms = candidateSearchTerms(candidate);
  if (!terms.length) throw new Error('Aucune donnee de recherche disponible: email, nom ou prenom manquant.');

  const browser = await chromium.launch({
    headless: options.headless,
    channel: BROWSER_CHANNEL || undefined,
    slowMo: Number(process.env.SLOW_MO_MS || 100),
    args: options.headless ? [] : [`--window-size=${browserWidth},${browserHeight}`],
  });
  const context = await browser.newContext({
    storageState: sessionPath,
    viewport: { width: browserWidth, height: browserHeight },
    screen: { width: browserWidth, height: browserHeight },
  });

  const page = await context.newPage();
  const report = {
    status: 'unknown',
    startedAt: new Date().toISOString(),
    agateUrl: AGATE_URL,
    candidate: {
      nomContact: candidate.nomContact || '',
      prenom: candidate.prenom || '',
      courriel: candidate.courriel || '',
      ecoleInseec: candidate.ecoleInseec || '',
      sessionRentree: candidate.sessionRentree || '',
      statut: candidate.statut || '',
      etape: candidate.etape || '',
    },
    searchTerms: terms,
    attempts: [],
    screenshot: path.relative(projectRoot, screenshotPath).replace(/\\/g, '/'),
  };

  try {
    await page.goto(AGATE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(async (error) => {
      await page.waitForTimeout(2000).catch(() => null);
      const text = await visibleText(page).catch(() => '');
      const currentUrl = page.url();
      if (!/agate\.rec/i.test(currentUrl) && !/agate|liste des candidats|dashboard/i.test(text)) throw error;
      report.navigationWarning = `Timeout goto ignore car Agate est visible: ${error.message || error}`;
    });
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => null);
    const initialText = await visibleText(page);
    if (isAuthenticationPage(page.url(), initialText)) {
      report.status = 'blocked';
      report.blockingReason = 'Session Agate invalide ou expiree: relancer saveAgateSession.js.';
      return;
    }
    report.pageReady = await waitForAgateCandidatePage(page);
    await tryOpenSearchPage(page);
    report.eudonetImportClicked = await clickEudonetImportButton(page);
    report.filters = await setAgateFilters(page, candidate);

    const input = await findSearchInput(page);
    if (!input) {
      report.status = 'blocked';
      report.blockingReason = 'Champ de recherche Agate/FELIX introuvable.';
      return;
    }

    for (const term of terms) {
      await submitSearch(page, input, term);
      const text = await visibleText(page);
      const rows = await extractCandidateRows(page, candidate);
      const matched = rows.length > 0 || matchCandidateText(text, candidate);
      report.attempts.push({
        term,
        matched,
        url: page.url(),
        rows,
        excerpt: text.replace(/\s+/g, ' ').slice(0, 800),
      });
      if (matched) {
        report.status = 'found';
        report.matchedTerm = term;
        report.matchedRows = rows;
        report.dossierOmnes = rows[0]?.dossierOmnes || '';
        return;
      }
    }

    report.status = 'not-found';
    report.blockingReason = 'Aucun dossier Agate/FELIX trouve avec les donnees Eudonet.';
  } finally {
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => null);
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(report, null, 2));
    if (options.keepOpenMs > 0 && !options.headless) {
      await page.waitForTimeout(options.keepOpenMs).catch(() => null);
    }
    await browser.close().catch(() => null);
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
