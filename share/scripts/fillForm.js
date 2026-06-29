const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const runStartPage = require('./pages/start');
const runPage1 = require('./pages/page1');
const runPage2 = require('./pages/page2');
const runPage3 = require('./pages/page3');
const { resolveSchoolProfile } = require('./formProfiles');

const helpersLib = require('./utils/helpers');

const {
  applyDynamicJdd,
  makeEmailSuffix,
  alphaSuffix,
  withNameSuffix,
  incrementPhone,
  withEmailSuffix,
  getAndBumpRunCounter,
  readJsonFile,
  fixMojibake,
  selectDropdownByLabel,
  selectDropdownByIndex,
  waitForComboboxEnabled,
  waitForComboboxReady,
  openCombobox,
  waitForOptions,
  chooseOptionFromList,
  fillInputByLabel,
  fillDateInput,
  fillPhoneInput,
  fillParentEmailConfirm,
  fillFieldsByLabel,
  logRequiredFields,
  pauseForReview,
  clickNextAndWait,
  scrollToBottom,
  checkCheckboxByLabelText,
  checkAllVisibleCheckboxes,
  findSectionByText,
  acceptCookiesIfBlocking,
  ensureFormStart,
  fillDocumentsSection,
  logValidationState,
  fillMissingFromErrorMessages,
  fillMissingRequiredFields,
  hasValidationErrors,
} = helpersLib;

const projectRoot = path.resolve(__dirname, '..');
const dataDir = path.join(projectRoot, 'data', 'jdd');

const NAME_SUFFIX_ENABLED = true;
const PHONE_INCREMENT_ENABLED = true;
const AUTO_JDD = process.env.AUTO_JDD !== '0';
const STOP_AFTER_PAGE = Number(process.env.STOP_AFTER_PAGE ?? 0);
const KEEP_BROWSER_OPEN = process.env.KEEP_BROWSER_OPEN === '1';
const SLOW_MO_MS = Number(process.env.SLOW_MO_MS ?? 600);
const DEBUG_REQUIRED = process.env.DEBUG_REQUIRED === '1';
const DEBUG_PAYMENT = process.env.DEBUG_PAYMENT === '1';
const AUTO_TEST_PAYMENT = process.env.AUTO_TEST_PAYMENT === '1';
const PAYMENT_TEST_CARD = String(process.env.PAYMENT_TEST_CARD || '').replace(/\s+/g, '');
const PAYMENT_TEST_EXP = String(process.env.PAYMENT_TEST_EXP || '').trim();
const PAYMENT_TEST_CVV = String(process.env.PAYMENT_TEST_CVV || '').trim();
const PAYMENT_TEST_BRAND = String(process.env.PAYMENT_TEST_BRAND || '').trim().toUpperCase();
const CANDIDATE_CONTEXT_PATH = String(process.env.CANDIDATE_CONTEXT_PATH || '').trim();

function writeCandidateContext(data, status) {
  if (!CANDIDATE_CONTEXT_PATH) return;
  const targetPath = path.resolve(CANDIDATE_CONTEXT_PATH);
  const payload = {
    updatedAt: new Date().toISOString(),
    status,
    candidate: {
      nom: data?.page1?.nom || '',
      prenom: data?.page1?.prenom || '',
      dateNaissance: data?.page1?.date_naissance || '',
      email: data?.page1?.email || '',
      telephone: data?.page1?.telephone || '',
    },
    program: {
      schoolSlug: data?.school?.slug || '',
      schoolLabel: data?.school?.label || '',
      session: data?.page1?.session || '',
      campus: data?.page1?.campus || '',
      niveauAdmission: data?.page1?.niveau_admission || '',
      programme: data?.page1?.programme || '',
    },
  };
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`[INFO] Contexte candidat enregistre: ${targetPath}`);
}

async function captureEvidence(page, filePath, options = {}) {
  if (!page || !filePath) return;

  const screenshotOptions = {
    path: filePath,
    fullPage: true,
    animations: 'disabled',
    ...options,
  };

  try {
    await page.screenshot(screenshotOptions);
  } catch {
    try {
      await page.screenshot({ path: filePath, fullPage: false });
    } catch {
      // ignore screenshot failures
    }
  }
}

function maskCardNumber(value) {
  const digits = String(value || '').replace(/\D+/g, '');
  if (digits.length <= 4) return digits;
  return `${'*'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

function parseExpiry(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{1,2})\s*\/\s*(\d{2}|\d{4})$/);
  if (!match) return null;
  const month = match[1].padStart(2, '0');
  let year = match[2];
  if (year.length === 2) {
    year = `20${year}`;
  }
  return { month, year };
}

function inferCardBrand(cardNumber) {
  const digits = String(cardNumber || '').replace(/\D+/g, '');
  if (/^3[47]/.test(digits)) return 'AMEX';
  if (/^4/.test(digits)) return 'VISA';
  if (/^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/.test(digits)) return 'MASTERCARD';
  return 'CB';
}

function extractHostname(rawUrl) {
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return '';
  }
}

async function dumpPaymentDiagnostics(page, requestUrls, stepLabel = 'current') {
  const frameUrls = page.frames().map((frame) => frame.url()).filter(Boolean);
  const domData = await page.evaluate(() => {
    const toAbs = (value) => {
      try {
        return new URL(value, window.location.href).href;
      } catch {
        return value || '';
      }
    };

    const scripts = Array.from(document.querySelectorAll('script[src]'))
      .map((node) => toAbs(node.getAttribute('src')))
      .filter(Boolean);

    const iframes = Array.from(document.querySelectorAll('iframe'))
      .map((node) => ({
        src: toAbs(node.getAttribute('src')),
        title: node.getAttribute('title') || '',
        name: node.getAttribute('name') || '',
      }))
      .filter((item) => item.src || item.title || item.name);

    const forms = Array.from(document.querySelectorAll('form'))
      .map((form) => ({
        action: toAbs(form.getAttribute('action')),
        method: form.getAttribute('method') || '',
        id: form.getAttribute('id') || '',
        className: form.getAttribute('class') || '',
      }))
      .filter((item) => item.action || item.id || item.className);

    const buttons = Array.from(document.querySelectorAll('button, a, [role="button"], input[type="submit"], input[type="button"]'))
      .map((node) => ({
        text: (node.innerText || node.textContent || node.value || '').trim(),
        aria: node.getAttribute('aria-label') || '',
        title: node.getAttribute('title') || '',
        type: node.getAttribute('type') || '',
        href: node.getAttribute('href') || '',
      }))
      .filter((item) => item.text || item.aria || item.title);

    const radios = Array.from(document.querySelectorAll('input[type="radio"]'))
      .map((node) => {
        const parentText = (node.closest('label, div, section, article')?.innerText || '').trim();
        return {
          name: node.getAttribute('name') || '',
          value: node.getAttribute('value') || '',
          checked: Boolean(node.checked),
          text: parentText,
        };
      });

    const inputs = Array.from(document.querySelectorAll('input, select, textarea'))
      .map((node) => ({
        tag: node.tagName.toLowerCase(),
        type: node.getAttribute('type') || '',
        name: node.getAttribute('name') || '',
        id: node.getAttribute('id') || '',
        placeholder: node.getAttribute('placeholder') || '',
        autocomplete: node.getAttribute('autocomplete') || '',
        ariaLabel: node.getAttribute('aria-label') || '',
        value: (node.value || '').slice(0, 60),
      }))
      .filter((item) => item.type || item.name || item.id || item.placeholder || item.ariaLabel);

    const images = Array.from(document.querySelectorAll('img'))
      .map((node) => ({
        alt: node.getAttribute('alt') || '',
        title: node.getAttribute('title') || '',
        src: toAbs(node.getAttribute('src')),
      }))
      .filter((item) => item.alt || item.title || item.src);

    const mercanetCardCandidates = Array.from(document.querySelectorAll('img'))
      .filter((node) => /logo pour le type de carte/i.test(node.getAttribute('alt') || ''))
      .map((node) => {
        const carrier = node.closest('a, button, label, td, li, div, form');
        const outer = carrier ? carrier.outerHTML : node.outerHTML;
        return {
          alt: node.getAttribute('alt') || '',
          src: toAbs(node.getAttribute('src')),
          href: carrier?.getAttribute?.('href') || '',
          onclick: carrier?.getAttribute?.('onclick') || '',
          name: carrier?.getAttribute?.('name') || '',
          id: carrier?.getAttribute?.('id') || '',
          className: carrier?.getAttribute?.('class') || '',
          html: String(outer || '').replace(/\s+/g, ' ').slice(0, 500),
        };
      });

    const bodyText = String(document.body?.innerText || document.documentElement?.innerText || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 1500);

    return {
      href: window.location.href,
      title: document.title || '',
      scripts,
      iframes,
      forms,
      buttons,
      radios,
      inputs,
      images,
      mercanetCardCandidates,
      bodyText,
    };
  });

  const providerHints = /payline|monext|worldline|ingenico|ogone|sips|atos|lyra|systempay|stripe|paypal|adyen|hipay|paybox|cybersource|checkout|braintree/i;
  const interestingUrls = Array.from(new Set([
    ...frameUrls,
    ...domData.scripts,
    ...domData.iframes.map((item) => item.src),
    ...domData.forms.map((item) => item.action),
    ...Array.from(requestUrls || []),
  ])).filter(Boolean);

  const providerUrls = interestingUrls.filter((value) => providerHints.test(value));
  const providerHosts = Array.from(new Set(interestingUrls.map(extractHostname).filter((host) => providerHints.test(host))));
  const allHosts = Array.from(new Set(interestingUrls.map(extractHostname).filter(Boolean))).sort();

  console.log(`[PAYMENT:${stepLabel}] URL:`, domData.href);
  console.log(`[PAYMENT:${stepLabel}] Title:`, domData.title || '(sans titre)');
  console.log(`[PAYMENT:${stepLabel}] Frames:`, JSON.stringify(frameUrls, null, 2));
  console.log(`[PAYMENT:${stepLabel}] Iframes:`, JSON.stringify(domData.iframes, null, 2));
  console.log(`[PAYMENT:${stepLabel}] Forms:`, JSON.stringify(domData.forms, null, 2));
  console.log(`[PAYMENT:${stepLabel}] Buttons:`, JSON.stringify(domData.buttons, null, 2));
  console.log(`[PAYMENT:${stepLabel}] Radios:`, JSON.stringify(domData.radios, null, 2));
  console.log(`[PAYMENT:${stepLabel}] Inputs:`, JSON.stringify(domData.inputs, null, 2));
  console.log(`[PAYMENT:${stepLabel}] Images:`, JSON.stringify(domData.images, null, 2));
  console.log(`[PAYMENT:${stepLabel}] Mercanet card candidates:`, JSON.stringify(domData.mercanetCardCandidates, null, 2));
  console.log(`[PAYMENT:${stepLabel}] Body text:`, domData.bodyText || '(vide)');
  console.log(`[PAYMENT:${stepLabel}] Provider hosts:`, JSON.stringify(providerHosts, null, 2));
  console.log(`[PAYMENT:${stepLabel}] Provider urls:`, JSON.stringify(providerUrls, null, 2));
  console.log(`[PAYMENT:${stepLabel}] All hosts:`, JSON.stringify(allHosts, null, 2));
}

async function waitForPaymentUrl(page, patterns, timeoutMs = 30000) {
  const endAt = Date.now() + timeoutMs;
  while (Date.now() < endAt) {
    const current = page.url();
    if (patterns.some((pattern) => pattern.test(current))) {
      return current;
    }
    await page.waitForTimeout(500);
  }
  return page.url();
}

async function clickFirstVisible(locators) {
  for (const locator of locators) {
    try {
      if (await locator.count()) {
        await locator.click({ force: true });
        return true;
      }
    } catch {
      // ignore
    }
  }
  return false;
}

async function waitForUrlChange(page, previousUrl, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const currentUrl = page.url();
    if (currentUrl && currentUrl !== previousUrl) {
      return currentUrl;
    }
    await page.waitForTimeout(500);
  }
  return page.url();
}

function normalizeForMatch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

async function readVisiblePageText(page, maxLen = 4000) {
  const text = await page.evaluate(() => String(document.body?.innerText || document.documentElement?.innerText || '')
    .replace(/\s+/g, ' ')
    .trim());
  return text.slice(0, maxLen);
}

function detectPaymentOutcomeFromText(text) {
  const normalized = normalizeForMatch(text);
  const refusedPatterns = [
    /paiement refuse/,
    /paiement a ete refuse/,
    /paiement est refuse/,
    /transaction refusee?/,
    /transaction annulee?/,
    /paiement annule/,
    /paiement a echoue/,
    /echec du paiement/,
    /payment refused/,
    /payment declined/,
    /payment failed/,
    /payment cancelled/,
  ];
  const acceptedPatterns = [
    /paiement accepte/,
    /paiement a ete accepte/,
    /transaction acceptee?/,
    /paiement valide/,
    /paiement confirme/,
    /merci pour votre paiement/,
    /votre candidature a bien ete envoyee/,
    /felicitations/,
    /payment successful/,
    /payment accepted/,
    /payment approved/,
    /transaction successful/,
  ];

  const refusedMatch = refusedPatterns.find((pattern) => pattern.test(normalized));
  if (refusedMatch) {
    return { status: 'refused', matchedPattern: refusedMatch.source };
  }

  const acceptedMatch = acceptedPatterns.find((pattern) => pattern.test(normalized));
  if (acceptedMatch) {
    return { status: 'accepted', matchedPattern: acceptedMatch.source };
  }

  return { status: 'unknown', matchedPattern: '' };
}

async function detectPaymentOutcome(page) {
  const text = await readVisiblePageText(page);
  const result = detectPaymentOutcomeFromText(text);
  return {
    ...result,
    text,
    excerpt: text.slice(0, 400),
  };
}

async function runTestPaymentFlow(page, dataId, requestUrls) {
  if (!PAYMENT_TEST_CARD || !PAYMENT_TEST_EXP || !PAYMENT_TEST_CVV) {
    throw new Error('Variables de test paiement manquantes: PAYMENT_TEST_CARD / PAYMENT_TEST_EXP / PAYMENT_TEST_CVV');
  }

  const expiry = parseExpiry(PAYMENT_TEST_EXP);
  if (!expiry) {
    throw new Error(`Format PAYMENT_TEST_EXP invalide: ${PAYMENT_TEST_EXP}`);
  }

  const brand = PAYMENT_TEST_BRAND || inferCardBrand(PAYMENT_TEST_CARD);
  console.log(`[PAYMENT] Test card configuree: ${maskCardNumber(PAYMENT_TEST_CARD)} brand=${brand} exp=${expiry.month}/${expiry.year} cvv=${'*'.repeat(PAYMENT_TEST_CVV.length)}`);

  const onAppPaymentPage = /prospect\.rec\.omneseducation\.com\/app\/.+\/payment/i.test(page.url());
  if (onAppPaymentPage) {
    const cardRadio = page.locator('input[type="radio"][value="payment-cb"]').first();
    if (await cardRadio.count()) {
      await cardRadio.check({ force: true }).catch(async () => {
        await cardRadio.click({ force: true });
      });
    }

    await clickFirstVisible([
      page.locator('img#MASTERCARD').first(),
      page.locator('img#VISA').first(),
      page.locator('img#CB').first(),
      page.getByText(/Carte Bancaire/i).first(),
      page.getByText(/Credit Card/i).first(),
    ]);

    const validateBtn = page
      .locator('button, a, [role="button"], div, span, input[type="submit"]')
      .filter({ hasText: /^(Valider|Validate)$/i })
      .last();
    if (await validateBtn.count()) {
      await validateBtn.click({ force: true });
    }
  }

  let currentUrl = await waitForPaymentUrl(
    page,
    [/secure\.inseec-recette\.paytweak\.com/i, /payment-web-mercanet\.test\.sips-services\.com/i],
    30000
  );

  if (/secure\.inseec-recette\.paytweak\.com/i.test(currentUrl)) {
    currentUrl = await waitForPaymentUrl(page, [/payment-web-mercanet\.test\.sips-services\.com/i], 30000);
  }

  if (/prospect\.rec\.omneseducation\.com\/app\/.+\/validation/i.test(currentUrl)) {
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(2000);
    const directValidationOutcome = await detectPaymentOutcome(page);
    if (directValidationOutcome.status === 'accepted') {
      console.log(`[PAYMENT] Validation finale detectee sans page carte: ${directValidationOutcome.matchedPattern || 'validation'}`);
      await captureEvidence(page, `reports/${dataId}-payment-after-finalize.png`);
      await captureEvidence(page, `reports/${dataId}-success-final-full.png`);
      return directValidationOutcome;
    }
    if (directValidationOutcome.status === 'refused') {
      throw new Error(`Paiement refuse detecte apres validation directe: ${directValidationOutcome.excerpt}`);
    }
  }

  if (/selectpaymentmethod/i.test(currentUrl)) {
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(3000);
    const preferredBrands = brand === 'CB'
      ? ['MASTERCARD', 'VISA', 'CB', 'AMEX']
      : [brand, 'MASTERCARD', 'VISA', 'CB', 'AMEX'];
    const brandOrder = Array.from(new Set(preferredBrands)).filter(Boolean);
    let cardPageReached = false;
    for (const brandCandidate of brandOrder) {
      const logo = page.locator(`img#${brandCandidate}`).first();
      try {
        if (!(await logo.count())) {
          continue;
        }
        try {
          await logo.scrollIntoViewIfNeeded();
        } catch {
          // ignore
        }
        await logo.click({ force: true });
        await page.waitForLoadState('domcontentloaded').catch(() => {});
        currentUrl = await waitForPaymentUrl(page, [/capturecarddetails/i, /selectpaymentmethod/i], 8000);
        if (/capturecarddetails/i.test(currentUrl)) {
          console.log(`[PAYMENT] Moyen de paiement Mercanet selectionne via ${brandCandidate}`);
          cardPageReached = true;
          break;
        }
      } catch {
        // ignore and try next logo
      }
    }
    if (!cardPageReached) {
      throw new Error('Impossible de selectionner le moyen de paiement carte sur Mercanet');
    }
  }

  if (!/capturecarddetails/i.test(currentUrl)) {
    const currentOutcome = await detectPaymentOutcome(page);
    if (currentOutcome.status === 'accepted') {
      console.log(`[PAYMENT] Statut accepte detecte sans page carte: ${currentOutcome.matchedPattern || 'accepted'}`);
      await captureEvidence(page, `reports/${dataId}-payment-after-finalize.png`);
      await captureEvidence(page, `reports/${dataId}-success-final-full.png`);
      return currentOutcome;
    }
    throw new Error(`Page de saisie carte non detectee: ${currentUrl}`);
  }

  await page.locator('#cardNumberField').fill('');
  await page.locator('#cardNumberField').type(PAYMENT_TEST_CARD, { delay: 30 });
  await page.selectOption('#expirydatefield-month', expiry.month);
  await page.selectOption('#expirydatefield-year', expiry.year);
  await page.locator('#cvvfield').fill('');
  await page.locator('#cvvfield').type(PAYMENT_TEST_CVV, { delay: 30 });

  await captureEvidence(page, `reports/${dataId}-payment-card-filled.png`);
  if (DEBUG_PAYMENT) {
    await dumpPaymentDiagnostics(page, requestUrls, 'card-filled');
  }

  const submitBtn = page.locator('#form_submit').first();
  if (!(await submitBtn.count())) {
    throw new Error('Bouton de validation carte introuvable');
  }
  await submitBtn.click({ force: true });

  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForTimeout(8000);
  await captureEvidence(page, `reports/${dataId}-payment-after-submit.png`);
  if (DEBUG_PAYMENT) {
    await dumpPaymentDiagnostics(page, requestUrls, 'after-card-submit');
  }

  const afterSubmitOutcome = await detectPaymentOutcome(page);
  if (afterSubmitOutcome.status === 'refused') {
    throw new Error(`Paiement refuse detecte sur la page Mercanet: ${afterSubmitOutcome.excerpt}`);
  }
  const acceptedAfterSubmit = afterSubmitOutcome.status === 'accepted';

  if (/\/fr\/payment\/receipt\//i.test(page.url())) {
    const beforeFinalizeUrl = page.url();
    const finalized = await clickFirstVisible([
      page.locator('a[href*="receipt.finalize"]').first(),
      page
        .locator('button, a, [role="button"], input[type="submit"]')
        .filter({ hasText: /Continuer/i })
        .first(),
    ]);

    if (finalized) {
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await page.waitForTimeout(5000);

      let finalizedUrl = await waitForPaymentUrl(
        page,
        [/secure\.inseec-recette\.paytweak\.com/i, /prospect\.rec\.omneseducation\.com\/app\//i],
        20000
      ).catch(async () => waitForUrlChange(page, beforeFinalizeUrl, 20000));

      if (finalizedUrl === beforeFinalizeUrl) {
        finalizedUrl = await waitForUrlChange(page, beforeFinalizeUrl, 10000);
      }

      console.log(`[PAYMENT] Confirmation Mercanet finalisee: ${finalizedUrl}`);
      await captureEvidence(page, `reports/${dataId}-payment-after-finalize.png`);
      if (DEBUG_PAYMENT) {
        await dumpPaymentDiagnostics(page, requestUrls, 'after-finalize');
      }

      const finalOutcome = await detectPaymentOutcome(page);
      const resolvedFinalOutcome = finalOutcome.status === 'unknown' && acceptedAfterSubmit
        ? { ...finalOutcome, status: 'accepted', matchedPattern: `${finalOutcome.matchedPattern || 'fallback-after-submit-accepted'}` }
        : finalOutcome;
      console.log(`[PAYMENT] Statut detecte apres retour: ${resolvedFinalOutcome.status}${resolvedFinalOutcome.matchedPattern ? ` (${resolvedFinalOutcome.matchedPattern})` : ''}`);
      if (resolvedFinalOutcome.excerpt) {
        console.log(`[PAYMENT] Extrait retour: ${resolvedFinalOutcome.excerpt}`);
      }
      if (resolvedFinalOutcome.status === 'refused') {
        throw new Error(`Paiement refuse detecte apres retour marchand: ${resolvedFinalOutcome.excerpt}`);
      }
      if (resolvedFinalOutcome.status === 'accepted') {
        await page.waitForTimeout(2000);
        await captureEvidence(page, `reports/${dataId}-success-final-full.png`);
      }
      return resolvedFinalOutcome;
    } else {
      console.log('[PAYMENT] Bouton Continuer introuvable sur la page de confirmation Mercanet');
    }
  }

  const fallbackOutcome = await detectPaymentOutcome(page);
  if (fallbackOutcome.status === 'accepted') {
    await page.waitForTimeout(2000);
    await captureEvidence(page, `reports/${dataId}-success-final-full.png`);
  }
  return fallbackOutcome;
}

async function promptSelectJdd(files) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    console.log('\nJDD disponibles :');
    files.forEach((f, i) => console.log(`  [${i}] ${f}`));
    rl.question('Choisis un JDD (index ou nom de fichier) : ', (answer) => {
      const trimmed = String(answer || '').trim();
      if (!trimmed) {
        rl.close();
        return resolve(files[0]);
      }
      const idx = parseInt(trimmed, 10);
      if (!Number.isNaN(idx) && idx >= 0 && idx < files.length) {
        rl.close();
        return resolve(files[idx]);
      }
      const byName = files.find((f) => f.toLowerCase() === trimmed.toLowerCase());
      if (byName) {
        rl.close();
        return resolve(byName);
      }
      console.log('Entree invalide, JDD par defaut utilise.');
      rl.close();
      return resolve(files[0]);
    });
  });
}

async function runOne(dataInput, runId) {
  let raw;
  let dataDirLocal;
  if (typeof dataInput === 'string') {
    raw = readJsonFile(dataInput);
    dataDirLocal = path.dirname(dataInput);
  } else if (dataInput && typeof dataInput === 'object') {
    raw = dataInput;
    dataDirLocal = path.join(__dirname, '../data');
  } else {
    throw new Error('Parametre de donnees invalide');
  }

  const data = fixMojibake(raw);
  const schoolProfile = resolveSchoolProfile(data.school || { slug: data?.school?.slug || '', journeyGroup: data?.school?.journeyGroup || '' });
  data.school = {
    ...(data.school || {}),
    profileId: schoolProfile.id,
    paymentMode: schoolProfile.paymentMode,
    journeyGroup: data?.school?.journeyGroup || schoolProfile.journeyGroup,
    structureGroup: data?.school?.structureGroup || schoolProfile.structureGroup || '',
  };
  if (AUTO_JDD) {
    applyDynamicJdd(data, runId);
  }

  const dataRoot = path.basename(dataDirLocal).toLowerCase() === 'jdd'
    ? path.resolve(dataDirLocal, '..')
    : dataDirLocal;

  const suffix = makeEmailSuffix(runId);
  const nameSuffix = String(process.env.NAME_SUFFIX_TOKEN || '').trim() || alphaSuffix(runId);

  data.id = `${data.id}-${suffix}`;

  if (!data.page1 || typeof data.page1 !== 'object') {
    throw new Error('[DATA] Le fichier ne contient pas "page1".');
  }

  if (NAME_SUFFIX_ENABLED && data.page1?.nom) {
    data.page1.nom = withNameSuffix(data.page1.nom, nameSuffix);
  }
  if (NAME_SUFFIX_ENABLED && data.page1?.prenom) {
    data.page1.prenom = withNameSuffix(data.page1.prenom, nameSuffix);
  }
  if (PHONE_INCREMENT_ENABLED && data.page1?.telephone) {
    data.page1.telephone = incrementPhone(data.page1.telephone, runId);
  }
  if (PHONE_INCREMENT_ENABLED && data.page1?.telephone_parent) {
    data.page1.telephone_parent = incrementPhone(data.page1.telephone_parent, runId);
  }
  if (data.page1?.email) {
    data.page1.email = withEmailSuffix(data.page1.email, suffix);
    data.page1.email_confirm = data.page1.email;
  }
  if (data.page1?.email_parent) {
    data.page1.email_parent = withEmailSuffix(data.page1.email_parent, suffix);
    data.page1.email_parent_confirm = data.page1.email_parent;
  }

  console.log(`[INFO] Identite utilisee: nom=${data.page1.nom}, prenom=${data.page1.prenom}`);
  console.log(`[INFO] Emails utilises: candidat=${data.page1.email}, parent=${data.page1.email_parent}`);
  console.log(`[INFO] Telephones utilises: candidat=${data.page1.telephone}, parent=${data.page1.telephone_parent}`);
  writeCandidateContext(data, 'prepared');

  let browser;
  let page;
  try {
    const requestedChannel = String(process.env.PW_CHANNEL || '').trim();
    const baseLaunchOptions = { headless: false, slowMo: SLOW_MO_MS };
    try {
      browser = await chromium.launch(requestedChannel ? { ...baseLaunchOptions, channel: requestedChannel } : baseLaunchOptions);
    } catch (error) {
      console.warn(`[WARNING] Impossible de lancer Chromium avec channel="${requestedChannel}". Fallback sur le navigateur Playwright. (${error?.message || error})`);
      browser = await chromium.launch(baseLaunchOptions);
    }
    page = await browser.newPage();
    const paymentRequestUrls = new Set();

    if (DEBUG_PAYMENT) {
      page.on('request', (request) => {
        try {
          const url = request.url();
          if (/pay|stripe|paypal|worldline|monext|ingenico|ogone|sips|atos|lyra|systempay|adyen|hipay|paybox|cybersource|checkout|braintree/i.test(url)) {
            paymentRequestUrls.add(url);
          }
        } catch {
          // ignore
        }
      });
    }

    console.log(`\n🚀 Demarrage : ${data.id}`);

    const helpers = {
      selectDropdownByLabel,
      selectDropdownByIndex,
      waitForComboboxEnabled,
      waitForComboboxReady,
      openCombobox,
      waitForOptions,
      chooseOptionFromList,
      fillInputByLabel,
      fillDateInput,
      fillPhoneInput,
      fillParentEmailConfirm,
      fillFieldsByLabel,
      logRequiredFields,
      pauseForReview,
      clickNextAndWait,
      scrollToBottom,
      checkCheckboxByLabelText,
      checkAllVisibleCheckboxes,
      findSectionByText,
      acceptCookiesIfBlocking,
      ensureFormStart,
      fillDocumentsSection,
      logValidationState,
      fillMissingFromErrorMessages,
      fillMissingRequiredFields,
      hasValidationErrors,
      DEBUG_REQUIRED,
    };

    await runStartPage({ page, data, schoolProfile, ...helpers });

    const p1 = data.page1;
    await runPage1({ page, data, p1, schoolProfile, helpers });
    writeCandidateContext(data, 'newform-page1-validated');
    if (STOP_AFTER_PAGE === 1) {
      console.log('[INFO] STOP_AFTER_PAGE=1 => arret apres la page 1/4');
      return;
    }

    const p2 = data.page2 || {};
    await runPage2({ page, data, p2, dataRoot, schoolProfile, helpers });
    if (STOP_AFTER_PAGE === 2) {
      console.log('[INFO] STOP_AFTER_PAGE=2 => arret apres la page 2/4');
      return;
    }

    const p3 = data.page3 || {};
    await runPage3({ page, data, p2, p3, dataRoot, schoolProfile, helpers });
    if (STOP_AFTER_PAGE === 3) {
      console.log('[INFO] STOP_AFTER_PAGE=3 => arret apres la page 3/4');
      return;
    }

    const paymentMode = String(schoolProfile.paymentMode || data?.school?.paymentMode || 'paytweak-card').toLowerCase();
    console.log(`\n⏸️  Page 4/4 : ${paymentMode === 'none' ? 'Validation finale' : 'Paiement'}`);
    await captureEvidence(page, `reports/${data.id}-page4-payment-start.png`);
    if (paymentMode === 'none') {
      await page.waitForTimeout(2000);
      await captureEvidence(page, `reports/${data.id}-success-final-full.png`);
      await captureEvidence(page, `reports/${data.id}-final.png`);
      console.log('✅ Etape finale sans paiement atteinte');
    } else if (AUTO_TEST_PAYMENT) {
      const paymentResult = await runTestPaymentFlow(page, data.id, paymentRequestUrls);
      await captureEvidence(page, `reports/${data.id}-final.png`);
      if (paymentResult?.status === 'accepted') {
        console.log('✅ Paiement test accepte');
      } else if (paymentResult?.status === 'unknown') {
        console.log('⚠️ Paiement test soumis, statut non confirme');
      }
    } else if (DEBUG_PAYMENT) {
      await dumpPaymentDiagnostics(page, paymentRequestUrls, 'payment-page');
      await captureEvidence(page, `reports/${data.id}-final.png`);
    } else {
      await captureEvidence(page, `reports/${data.id}-final.png`);
    }
    console.log(`✅ ${paymentMode === 'none' ? 'Page finale atteinte' : 'Page paiement atteinte'}`);
    console.log(`🎉 ${data.id} termine !`);
  } catch (error) {
    try {
      if (page) {
        await captureEvidence(page, `reports/${data.id}-blocked-full.png`);
      }
    } catch {
      // ignore
    }
    throw error;
  } finally {
    if (browser && !KEEP_BROWSER_OPEN) {
      await browser.close();
    } else if (browser && KEEP_BROWSER_OPEN) {
      console.log('[INFO] KEEP_BROWSER_OPEN=1 — navigateur laisse ouvert');
    }
  }
}

(async () => {
  const counterPath = path.join(projectRoot, 'data', 'run-counter.json');
  const absoluteJddPath = process.env.JDD_ABS_FILE ? path.resolve(process.env.JDD_ABS_FILE) : '';
  const requested = process.env.JDD_FILE;
  const idxEnv = process.env.JDD_INDEX;
  const forcePrompt = process.env.JDD_PROMPT === '1' || process.argv.includes('--prompt');

  if (absoluteJddPath) {
    if (!fs.existsSync(absoluteJddPath)) {
      throw new Error(`JDD absolu introuvable: ${absoluteJddPath}`);
    }

    const runId = getAndBumpRunCounter(counterPath);
    await runOne(absoluteJddPath, runId);
    console.log(`\n? JDD traite : ${path.basename(absoluteJddPath)}`);
    return;
  }

  if (!fs.existsSync(dataDir)) {
    throw new Error(`Dossier JDD introuvable: ${dataDir}`);
  }
  const files = fs.readdirSync(dataDir).filter((f) => f.endsWith('.json')).sort();
  if (files.length === 0) {
    throw new Error(`Aucun JDD trouve dans ${dataDir}`);
  }

  let file = files[0];
  if (requested && files.includes(requested)) {
    file = requested;
  } else if (!forcePrompt && idxEnv) {
    const idx = Math.max(0, parseInt(idxEnv, 10) || 0);
    file = files[idx % files.length];
  } else if (forcePrompt) {
    file = await promptSelectJdd(files);
  }

  const runId = getAndBumpRunCounter(counterPath);
  if (!requested && !idxEnv && !forcePrompt) {
    file = files[(runId - 1) % files.length];
  }

  await runOne(path.join(dataDir, file), runId);
  console.log(`\n? JDD traite : ${file}`);
})();
