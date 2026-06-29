const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const projectRoot = path.resolve(__dirname, '../..');
const defaultDataPath = path.join(projectRoot, 'share', 'data', 'eudonet', 'contact-test.json');
const sessionPath = path.join(projectRoot, 'authentification', 'eudonet-session.json');
const logPath = path.join(projectRoot, 'authentification', 'eudonet-new-contact.log');
const screenshotPath = path.join(projectRoot, 'authentification', 'eudonet-new-contact.png');
const createdScreenshotPath = path.join(projectRoot, 'authentification', 'eudonet-contact-created.png');
const usedDataPath = path.join(projectRoot, 'authentification', 'eudonet-contact-data-used.json');
const eudonetUrl = process.env.EUDONET_URL || 'https://test-omnes.eudonet.com/recette';
const browserChannel = String(process.env.PW_CHANNEL || 'chrome').trim();
const browserWidth = Number(process.env.EUDONET_BROWSER_WIDTH || 1400);
const browserHeight = Number(process.env.EUDONET_BROWSER_HEIGHT || 900);
let browser;
let activePage;

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  fs.appendFileSync(logPath, `${line}\n`, 'utf8');
}

function parseArgs(argv) {
  const options = {
    dataPath: defaultDataPath,
    submit: String(process.env.EUDONET_SUBMIT || '') === '1',
    headless: String(process.env.EUDONET_HEADLESS || '') === '1',
    diagnostic: String(process.env.EUDONET_DIAGNOSTIC || '') === '1',
    keepOpenMs: Number(process.env.KEEP_OPEN_MS || 5000),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--data' || arg === '--data-path') {
      options.dataPath = path.resolve(process.cwd(), argv[index + 1]);
      index += 1;
    } else if (arg === '--submit') {
      options.submit = true;
    } else if (arg === '--no-submit') {
      options.submit = false;
    } else if (arg === '--headless') {
      options.headless = true;
    } else if (arg === '--diagnostic') {
      options.diagnostic = true;
    } else if (arg === '--keep-open-ms') {
      options.keepOpenMs = Number(argv[index + 1]);
      index += 1;
    } else {
      throw new Error(`Option inconnue: ${arg}`);
    }
  }

  if (!Number.isFinite(options.keepOpenMs) || options.keepOpenMs < 0) {
    throw new Error('La valeur --keep-open-ms doit etre un nombre positif.');
  }

  return options;
}

function stripAccents(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function titleCaseName(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('fr-FR')
    .replace(/(^|[ -])(\p{L})/gu, (match, separator, letter) => (
      `${separator}${letter.toLocaleUpperCase('fr-FR')}`
    ));
}

function emailPart(value) {
  return stripAccents(value)
    .toLocaleLowerCase('fr-FR')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function formatPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.replace(/(\d{2})(?=\d)/g, '$1 ').trim();
}

function uniqueLetterSuffix(date = new Date()) {
  const digitLetters = 'abcdefghij';
  return date.toISOString()
    .replace(/\D/g, '')
    .split('')
    .map((digit) => digitLetters[Number(digit)])
    .join('');
}

function assertValidDate(value) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) {
    throw new Error('Date de naissance invalide: format attendu dd/mm/yyyy.');
  }

  const [, day, month, year] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    throw new Error(`Date de naissance invalide: ${value}`);
  }
}

function loadContact(dataPath) {
  if (!fs.existsSync(dataPath)) {
    throw new Error(`Fichier de donnees introuvable: ${dataPath}`);
  }

  const source = JSON.parse(fs.readFileSync(dataPath, 'utf8').replace(/^\uFEFF/, ''));
  const uniqueData = source.donneesUniques === true;
  const generatedLastName = uniqueData
    ? `${String(source.nomContact || 'Contact-Test').trim()}-${uniqueLetterSuffix()}`
    : source.nomContact;
  const contact = {
    nomContact: titleCaseName(generatedLastName),
    prenom: titleCaseName(source.prenom),
    paysResidence: String(source.paysResidence || '').trim(),
    nationalite: String(source.nationalite || '').trim(),
    dateNaissance: String(source.dateNaissance || '').trim(),
    courriel: uniqueData ? '' : String(source.courriel || '').trim(),
    portable: formatPhone(source.portable),
    pays: String(source.pays || '').trim(),
    sessionRentree: String(
      source.sessionRentree
      || process.env.EUDONET_SESSION_RENTREE
      || 'BBA - Bordeaux - AN1 - 100% English - Fall 2026'
    ).trim(),
    cycle: String(
      source.cycle
      || process.env.EUDONET_CYCLE
      || 'Classique - CL'
    ).trim(),
    statut: String(
      source.statut
      || process.env.EUDONET_STATUT
      || '04. Admis - Inscription en attente de paiement'
    ).trim(),
    etape: String(
      source.etape
      || process.env.EUDONET_ETAPE
      || 'Inscription'
    ).trim(),
    ecoleInseec: String(
      source.ecoleInseec
      || process.env.EUDONET_ECOLE_INSEEC
      || 'BBA INSEEC'
    ).trim(),
  };

  const namePattern = /^\p{L}+(?:[ -]\p{L}+)*$/u;
  for (const [label, value] of [
    ['Nom Contact', contact.nomContact],
    ['Prenom', contact.prenom],
  ]) {
    if (!namePattern.test(value)) {
      throw new Error(`${label} invalide: lettres, espaces et tirets uniquement.`);
    }
  }

  for (const [label, value] of [
    ['Pays de residence', contact.paysResidence],
    ['Nationalite', contact.nationalite],
    ['Pays', contact.pays],
  ]) {
    if (!value) throw new Error(`${label} est obligatoire.`);
  }

  assertValidDate(contact.dateNaissance);

  if (!contact.courriel) {
    contact.courriel = `${emailPart(contact.nomContact)}.${emailPart(contact.prenom)}@test.com`;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.courriel)) {
    throw new Error(`Courriel invalide: ${contact.courriel}`);
  }
  if (!/^\d{2}(?: \d{2}){4}$/.test(contact.portable)) {
    throw new Error('Portable invalide: 10 chiffres sont attendus.');
  }

  fs.mkdirSync(path.dirname(usedDataPath), { recursive: true });
  fs.writeFileSync(usedDataPath, `${JSON.stringify(contact, null, 2)}\n`, 'utf8');
  return contact;
}

function allFrames(context) {
  return context.pages().flatMap((page) => page.frames().slice().reverse());
}

async function firstVisibleLocator(context, candidates) {
  for (const frame of allFrames(context)) {
    for (const candidate of candidates) {
      const locator = candidate(frame).first();
      const count = await locator.count().catch(() => 0);
      if (count && await locator.isVisible().catch(() => false)) {
        return { frame, locator };
      }
    }
  }
  return null;
}

async function dumpVisibleInteractive(context, reason) {
  log(`Diagnostic elements visibles (${reason})`);
  for (const frame of allFrames(context)) {
    const items = await frame.evaluate(() => {
      const selector = [
        'button',
        'a',
        'input',
        'textarea',
        'select',
        '[role="button"]',
        '[role="option"]',
        '[onclick]',
        '[title]',
      ].join(',');
      return Array.from(document.querySelectorAll(selector))
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return rect.width > 0
            && rect.height > 0
            && style.visibility !== 'hidden'
            && style.display !== 'none';
        })
        .slice(0, 250)
        .map((element) => ({
          tag: element.tagName,
          text: (element.innerText || element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100),
          value: (element.getAttribute('value') || '').slice(0, 100),
          title: (element.getAttribute('title') || '').slice(0, 100),
          aria: (element.getAttribute('aria-label') || '').slice(0, 100),
          id: (element.id || '').slice(0, 100),
          name: (element.getAttribute('name') || '').slice(0, 100),
          classes: (element.className || '').toString().slice(0, 140),
        }));
    }).catch((error) => [{ error: error.message || String(error) }]);

    log(`Frame: ${frame.url() || 'main'}`);
    for (const item of items) log(`  ${JSON.stringify(item)}`);
  }
}

async function clickDomExactText(context, label) {
  for (const frame of allFrames(context)) {
    const clicked = await frame.evaluate((targetLabel) => {
      const selector = [
        'button',
        'a',
        'li',
        'div',
        'span',
        'input',
        '[role="button"]',
        '[onclick]',
      ].join(',');
      const normalize = (value) => String(value || '').trim().replace(/\s+/g, ' ');
      const target = Array.from(document.querySelectorAll(selector)).find((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        const visible = rect.width > 0
          && rect.height > 0
          && style.visibility !== 'hidden'
          && style.display !== 'none';
        return visible && [
          normalize(element.innerText || element.textContent),
          normalize(element.getAttribute('value')),
          normalize(element.getAttribute('title')),
        ].includes(targetLabel);
      });
      if (!target) return false;
      target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
      target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
      target.click();
      return true;
    }, label).catch(() => false);

    if (clicked) {
      log(`Clic DOM effectue sur ${label} dans la frame: ${frame.url() || 'main'}`);
      return true;
    }
  }
  return false;
}

async function clickVisible(context, label, candidates) {
  const target = await firstVisibleLocator(context, candidates);
  if (!target) {
    if (await clickDomExactText(context, label)) return;
    await dumpVisibleInteractive(context, `${label} introuvable`);
    throw new Error(`Bouton ${label} introuvable.`);
  }

  log(`Bouton ${label} trouve dans la frame: ${target.frame.url() || 'main'}`);
  await target.locator.scrollIntoViewIfNeeded().catch(() => null);
  await target.locator.click({ timeout: 10000 });
  log(`Clic effectue sur ${label}.`);
  return target;
}

async function hoverContacts(context) {
  const deadline = Date.now() + 60000;
  let contacts = null;
  let lastError = null;

  while (Date.now() < deadline) {
    contacts = await firstVisibleLocator(context, [
      (frame) => frame.getByRole('link', { name: /^contacts$/i }),
      (frame) => frame.getByRole('button', { name: /^contacts$/i }),
      (frame) => frame.getByText(/^contacts$/i),
      (frame) => frame.locator('text=/^\\s*Contacts\\s*$/i'),
    ]);

    if (contacts) {
      await contacts.locator.scrollIntoViewIfNeeded().catch(() => null);
      try {
        await contacts.locator.hover({ timeout: 3000 });
        log(`Menu Contacts trouve dans la frame: ${contacts.frame.url() || 'main'}`);
        log('Hover effectue sur le menu Contacts.');
        return;
      } catch (error) {
        lastError = error;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  if (lastError) {
    throw new Error(`Menu Contacts bloque par le chargement Eudonet: ${lastError.message}`);
  }
  throw new Error('Menu Contacts introuvable dans la page Eudonet apres 60 secondes.');
}

async function fillContactSearch(context, value) {
  const searchInput = await firstVisibleLocator(context, [
    (frame) => frame.getByRole('textbox'),
    (frame) => frame.locator('input[type="search"]'),
    (frame) => frame.locator('input[type="text"]'),
    (frame) => frame.locator('input:not([type]), input:not([type="hidden"])'),
  ]);

  if (!searchInput) throw new Error('Champ de recherche Contacts introuvable apres le hover.');
  log(`Champ de recherche Contacts trouve dans la frame: ${searchInput.frame.url() || 'main'}`);
  await searchInput.locator.click({ timeout: 10000 });
  await searchInput.locator.fill(value, { timeout: 10000 });
  log(`Recherche Contacts saisie: ${value}`);
}

async function clickNewButton(context) {
  await clickVisible(context, 'Nouveau', [
    (frame) => frame.locator('li.navAction[onclick*="openLnkFileDialog"][onclick*=",200,"]'),
    (frame) => frame.locator('li.navAction').filter({ hasText: /^Nouveau$/i }),
    (frame) => frame.locator('xpath=//*[self::li or self::div or self::span or self::a][normalize-space(.)="Nouveau"]'),
    (frame) => frame.getByRole('button', { name: /^nouveau$/i }),
    (frame) => frame.getByRole('link', { name: /^nouveau$/i }),
    (frame) => frame.locator('input[type="button"][value*="Nouveau" i], input[type="submit"][value*="Nouveau" i]'),
    (frame) => frame.getByText(/^nouveau$/i),
  ]);
}

async function clickAddButton(context) {
  await clickVisible(context, 'Ajouter', [
    (frame) => frame.locator('xpath=//*[self::button or self::input or self::a or self::li or self::div or self::span][normalize-space(.)="Ajouter" or @value="Ajouter" or @title="Ajouter"]'),
    (frame) => frame.getByRole('button', { name: /^ajouter$/i }),
    (frame) => frame.getByRole('link', { name: /^ajouter$/i }),
    (frame) => frame.locator('input[type="button"][value*="Ajouter" i], input[type="submit"][value*="Ajouter" i]'),
    (frame) => frame.getByText(/^ajouter$/i),
  ]);
}

async function locateFieldByLabel(context, labels, token, allowReadonly = false) {
  const normalizedLabels = labels.map((label) => stripAccents(label).toLocaleLowerCase('fr-FR'));

  for (const frame of allFrames(context)) {
    const found = await frame.evaluate(({ acceptedLabels, marker, readonlyAllowed }) => {
      const normalize = (value) => String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/\s*\*+\s*$/, '')
        .replace(/\s*:\s*$/, '')
        .toLocaleLowerCase('fr-FR');
      const isVisible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0
          && rect.height > 0
          && style.visibility !== 'hidden'
          && style.display !== 'none'
          && !element.disabled;
      };
      const isEditable = (element) => element
        && ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)
        && element.type !== 'hidden'
        && (readonlyAllowed || !element.readOnly)
        && isVisible(element);
      const textElements = Array.from(document.querySelectorAll('label, td, th, div, span, p'));
      const labelElements = textElements.filter((element) => {
        const ownText = Array.from(element.childNodes)
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent)
          .join(' ');
        return acceptedLabels.includes(normalize(ownText || element.textContent));
      });
      if (!labelElements.length) return false;

      let input = null;
      for (const labelElement of labelElements) {
        if (labelElement.id) {
          input = document.getElementById(`${labelElement.id}_0_0_0`);
        }
        if (labelElement.tagName === 'LABEL' && labelElement.htmlFor) {
          input = document.getElementById(labelElement.htmlFor);
        }
        if (!isEditable(input)) {
          input = labelElement.querySelector('input:not([type="hidden"]), textarea, select');
        }

        let ancestor = labelElement;
        for (let depth = 0; !isEditable(input) && ancestor && depth < 4; depth += 1) {
          const candidates = Array.from(
            ancestor.querySelectorAll('input:not([type="hidden"]), textarea, select')
          ).filter(isEditable);
          if (candidates.length) input = candidates[0];
          ancestor = ancestor.parentElement;
        }
        if (isEditable(input)) break;
      }

      if (!isEditable(input)) {
        for (const labelElement of labelElements) {
          const labelRect = labelElement.getBoundingClientRect();
          const candidates = Array.from(
            document.querySelectorAll('input:not([type="hidden"]), textarea, select')
          ).filter(isEditable);
          candidates.sort((left, right) => {
            const distance = (element) => {
              const rect = element.getBoundingClientRect();
              const verticalPenalty = Math.abs(rect.top - labelRect.top) * 5;
              const horizontalPenalty = rect.left >= labelRect.left ? rect.left - labelRect.right : 10000;
              return verticalPenalty + horizontalPenalty;
            };
            return distance(left) - distance(right);
          });
          input = candidates[0];
          if (isEditable(input)) break;
        }
      }

      if (!isEditable(input)) return false;
      input.setAttribute('data-eudonet-field', marker);
      return true;
    }, {
      acceptedLabels: normalizedLabels,
      marker: token,
      readonlyAllowed: allowReadonly,
    }).catch(() => false);

    if (found) {
      const locator = frame.locator(`[data-eudonet-field="${token}"]`).first();
      if (await locator.isVisible().catch(() => false)) return { frame, locator };
    }
  }

  return null;
}

async function waitForField(context, label, aliases, allowReadonly = false) {
  const token = `field-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const deadline = Date.now() + 15000;
  let target = null;

  while (!target && Date.now() < deadline) {
    target = await locateFieldByLabel(context, [label, ...aliases], token, allowReadonly);
    if (!target) await new Promise((resolve) => setTimeout(resolve, 500));
  }

  if (!target) {
    await dumpVisibleInteractive(context, `champ ${label} introuvable`);
    throw new Error(`Champ ${label} introuvable.`);
  }

  return target;
}

async function waitForExactField(context, label, ids, allowReadonly = false) {
  const deadline = Date.now() + 15000;

  while (Date.now() < deadline) {
    for (const frame of allFrames(context)) {
      for (const id of ids) {
        const locator = frame.locator(`#${id}`).first();
        if (!await locator.isVisible().catch(() => false)) continue;
        const usable = await locator.evaluate((element, readonlyAllowed) => (
          !element.disabled && (readonlyAllowed || !element.readOnly)
        ), allowReadonly).catch(() => false);
        if (usable) return { frame, locator };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Champ exact ${label} introuvable (${ids.join(', ')}).`);
}

async function fillField(context, label, aliases, value, ids = []) {
  const target = ids.length
    ? await waitForExactField(context, label, ids)
    : await waitForField(context, label, aliases);
  await target.locator.scrollIntoViewIfNeeded().catch(() => null);
  await target.locator.click({ timeout: 10000 });
  await target.locator.fill(value, { timeout: 10000 });
  log(`Champ ${label} saisi: ${value}`);
  return target;
}

async function closeTopModal(context) {
  for (const frame of allFrames(context)) {
    const closed = await frame.evaluate(() => {
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

      const suffix = modal.id.replace(/^ContainerModal_/, '');
      const selectors = [
        '[title*="Fermer" i]',
        '[title*="Close" i]',
        '[aria-label*="Fermer" i]',
        '[aria-label*="Close" i]',
        '[class*="close" i]',
        '[class*="cross" i]',
        '.icon-edn-cross',
        '.icon-cross',
      ];
      let closeButton = modal.querySelector(selectors.join(','));
      if (!closeButton && suffix) {
        closeButton = Array.from(document.querySelectorAll(`[id*="${suffix}"]`))
          .find((element) => /close|cross|cancel/i.test(`${element.id} ${element.className}`));
      }
      if (!closeButton || !isVisible(closeButton)) return false;
      closeButton.click();
      return true;
    }).catch(() => false);
    if (closed) return true;
  }
  return false;
}

async function dumpNationalityPopupControls(context, popupFrame) {
  const popupControls = await popupFrame.evaluate(() => Array.from(document.querySelectorAll(
    'button, input[type="button"], input[type="submit"], a, li[onclick], div[onclick], span[onclick], [title]'
  )).map((element) => ({
    tag: element.tagName,
    text: (element.innerText || element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80),
    value: element.getAttribute('value') || '',
    title: element.getAttribute('title') || '',
    id: element.id || '',
    classes: String(element.className || '').slice(0, 120),
    onclick: (element.getAttribute('onclick') || '').slice(0, 160),
  })).slice(-80)).catch(() => []);
  log(`Controles Catalogue nationalite: ${JSON.stringify(popupControls)}`);

  for (const frame of allFrames(context)) {
    const modalControls = await frame.evaluate(() => {
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
      if (!modal) return [];
      return Array.from(modal.querySelectorAll(
        'button, input, a, li, div, span, [title], [onclick]'
      )).filter(isVisible).map((element) => ({
        tag: element.tagName,
        text: (element.innerText || element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80),
        value: element.getAttribute('value') || '',
        title: element.getAttribute('title') || '',
        id: element.id || '',
        classes: String(element.className || '').slice(0, 120),
        onclick: (element.getAttribute('onclick') || '').slice(0, 160),
      })).slice(-80);
    }).catch(() => []);
    if (modalControls.length) {
      log(`Controles conteneur modal: ${JSON.stringify(modalControls)}`);
    }
  }
}

async function selectSingleCountry(context, label, aliases, value, diagnostic = false, ids = []) {
  const target = ids.length
    ? await waitForExactField(context, label, ids, true)
    : await waitForField(context, label, aliases, true);
  await target.locator.scrollIntoViewIfNeeded().catch(() => null);

  await target.locator.click({ timeout: 10000 });
  const filterInput = target.frame.locator('#eCatalogEditorSearch').first();
  try {
    await filterInput.waitFor({ state: 'visible', timeout: 5000 });
  } catch {
    if (diagnostic) await dumpVisibleInteractive(context, `liste ${label} non ouverte`);
    throw new Error(`La liste deroulante de ${label} ne s est pas ouverte.`);
  }
  log(`Liste deroulante ${label} ouverte.`);

  await filterInput.click();
  await filterInput.fill('');
  await filterInput.pressSequentially(value, { delay: 120 });
  await target.frame.waitForTimeout(900);

  const typedValue = await filterInput.inputValue();
  if (typedValue !== value) {
    throw new Error(`Filtre ${label} incorrect: "${typedValue}" au lieu de "${value}".`);
  }
  log(`Champ de recherche ${label} saisi: ${typedValue}`);

  let suggestion = null;
  const deadline = Date.now() + 10000;
  while (!suggestion && Date.now() < deadline) {
    const marker = `residence-country-${Date.now()}`;
    const marked = await target.frame.evaluate(({ expected, markerValue }) => {
      const normalize = (text) => String(text || '').trim().replace(/\s+/g, ' ');
      const expectedPattern = new RegExp(
        `^${expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s+[A-Z])?(?:\\s+\\d+)?$`,
        'i'
      );
      const isVisible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0
          && rect.height > 0
          && style.display !== 'none'
          && style.visibility !== 'hidden';
      };
      const matches = Array.from(document.querySelectorAll(
        '[role="option"], .ui-autocomplete li, .autocomplete li, .autocomplete-item, li, a, tr, td, div, span'
      )).filter((element) => (
        isVisible(element) && expectedPattern.test(normalize(element.textContent))
      ));
      const leafMatches = matches.filter((element) => !matches.some(
        (other) => other !== element && element.contains(other)
      ));
      const candidates = leafMatches.length ? leafMatches : matches;
      const selected = candidates
        .map((element) => {
          const clickable = element.closest(
            '[role="option"], li, a, tr, td, [onclick], [class*="item" i], [class*="result" i]'
          ) || element;
          return { element: clickable, area: clickable.getBoundingClientRect().width * clickable.getBoundingClientRect().height };
        })
        .sort((left, right) => left.area - right.area)[0]?.element;
      if (!selected) return false;
      selected.setAttribute('data-eudonet-result', markerValue);
      return true;
    }, { expected: value, markerValue: marker }).catch(() => false);

    if (marked) {
      const locator = target.frame.locator(`[data-eudonet-result="${marker}"]`).first();
      if (await locator.isVisible().catch(() => false)) suggestion = locator;
    }
    if (!suggestion) await target.frame.waitForTimeout(300);
  }

  if (!suggestion) {
    if (diagnostic) await dumpVisibleInteractive(context, `resultats filtres ${label}`);
    throw new Error(`La valeur ${value} est absente des resultats de ${label}.`);
  }

  const suggestionText = (await suggestion.innerText()).trim().replace(/\s+/g, ' ');
  const suggestionDetails = await suggestion.evaluate((element) => {
    const details = [];
    let current = element;
    for (let depth = 0; current && depth < 5; depth += 1) {
      details.push({
        tag: current.tagName,
        id: current.id || '',
        className: String(current.className || ''),
        onclick: current.getAttribute('onclick') || '',
        role: current.getAttribute('role') || '',
      });
      current = current.parentElement;
    }
    return details;
  });
  log(`Valeur attendue presente dans les resultats ${label}: ${suggestionText}`);
  log(`Cible resultat ${label}: ${JSON.stringify(suggestionDetails)}`);
  await suggestion.click({ timeout: 5000 });

  await filterInput.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => null);
  if (await filterInput.isVisible().catch(() => false)) {
    throw new Error(`La liste deroulante de ${label} est restee ouverte apres la selection.`);
  }
  log(`Liste deroulante ${label} fermee apres selection.`);

  const selectedValue = await target.locator.evaluate((element) => (
    element.value
    || element.getAttribute('title')
    || element.getAttribute('dbv')
    || ''
  ));
  if (!stripAccents(selectedValue).toLocaleLowerCase('fr-FR').includes(
    stripAccents(value).toLocaleLowerCase('fr-FR')
  )) {
    throw new Error(`Valeur finale ${label} incorrecte: "${selectedValue}".`);
  }
  log(`Valeur finale ${label} verifiee: ${selectedValue}`);
}

async function selectNationality(context, value, diagnostic = false, ids = []) {
  const label = 'Nationalite';
  const target = ids.length
    ? await waitForExactField(context, label, ids, true)
    : await waitForField(context, label, ['Nationalité', 'Nationalité(s)'], true);
  await target.locator.scrollIntoViewIfNeeded().catch(() => null);
  await target.locator.click({ timeout: 10000 });
  await target.frame.waitForTimeout(700);

  const popupSearch = await firstVisibleLocator(context, [
    (frame) => frame.locator('input#eTxtSrch.eTxtSrch'),
  ]);
  if (!popupSearch) {
    if (diagnostic) await dumpVisibleInteractive(context, 'catalogue Nationalite non ouvert');
    throw new Error('La popup Catalogue nationalite ne s est pas ouverte.');
  }
  const popupFrame = popupSearch.frame;
  log('Popup Catalogue nationalite ouverte.');

  await popupSearch.locator.click();
  await popupSearch.locator.fill('');
  await popupSearch.locator.pressSequentially(value, { delay: 120 });
  await popupFrame.waitForTimeout(900);

  const typedValue = await popupSearch.locator.inputValue();
  if (typedValue !== value) {
    throw new Error(`Recherche Nationalite incorrecte: "${typedValue}" au lieu de "${value}".`);
  }
  log(`Champ de recherche Nationalite saisi: ${typedValue}`);

  const sourceMarker = `nationality-source-${Date.now()}`;
  const sourceFound = await popupFrame.evaluate(({ expected, marker }) => {
    const normalize = (text) => String(text || '').trim().replace(/\s+/g, ' ');
    const rows = Array.from(document.querySelectorAll(
      '#eCEDValues #tbCatVal > li[id^="val_"]:not([id$="_sel"])'
    ));
    const row = rows.find((element) => {
      const label = element.querySelector('li.valwidth');
      return normalize(label?.textContent).toLocaleLowerCase('fr-FR')
        === normalize(expected).toLocaleLowerCase('fr-FR');
    });
    if (!row) return false;
    row.setAttribute('data-eudonet-nationality-source', marker);
    return true;
  }, { expected: value, marker: sourceMarker }).catch(() => false);

  if (!sourceFound) {
    if (diagnostic) await dumpVisibleInteractive(context, 'nationalite absente du tableau source');
    throw new Error(`La nationalite ${value} est absente du tableau des libelles.`);
  }

  const sourceRow = popupFrame.locator(
    `[data-eudonet-nationality-source="${sourceMarker}"]`
  ).first();
  const sourceText = (await sourceRow.innerText()).trim().replace(/\s+/g, ' ');
  log(`Nationalite presente dans le tableau des libelles: ${sourceText}`);
  await sourceRow.click({ timeout: 5000 });
  const selectedClass = await sourceRow.getAttribute('class');
  log(`Ligne Nationalite selectionnee dans le tableau source: ${selectedClass || 'selection active'}`);

  const addButton = popupFrame.locator('#BtnSelect').first();
  await addButton.waitFor({ state: 'visible', timeout: 5000 });
  await addButton.click({ timeout: 5000 });
  await popupFrame.waitForTimeout(800);

  const selectedMatch = await popupFrame.evaluate((expected) => {
    const normalize = (text) => String(text || '').trim().replace(/\s+/g, ' ');
    const rows = Array.from(document.querySelectorAll(
      '#eCEDSelValues #tbCatSelVal > li[id$="_sel"]'
    ));
    const row = rows.find((element) => {
      const label = element.querySelector('li.valwidth');
      return normalize(label?.textContent).toLocaleLowerCase('fr-FR')
        === normalize(expected).toLocaleLowerCase('fr-FR');
    });
    if (!row) return null;
    return {
      text: normalize(row.querySelector('li.valwidth')?.textContent),
      id: row.id || '',
    };
  }, value).catch(() => null);

  if (!selectedMatch) {
    if (diagnostic) await dumpVisibleInteractive(context, 'nationalite absente du tableau selectionne');
    throw new Error(`La nationalite ${value} n a pas rejoint le tableau des valeurs selectionnees.`);
  }
  log(`Nationalite presente dans le tableau selectionne: ${selectedMatch.text}`);

  let validateButton = null;
  const popupCandidates = [
    popupFrame.locator('div#ok[ednmodalbtn="1"]'),
    popupFrame.locator('div#ok:has(> #ok-mid)'),
    popupFrame.locator('#ok-mid'),
    popupFrame.getByRole('button', { name: /^valider$/i }),
    popupFrame.locator('input[type="button"][value="Valider" i], input[type="submit"][value="Valider" i]'),
    popupFrame.locator('[title="Valider" i]'),
    popupFrame.getByText(/^valider$/i),
  ];
  for (const candidate of popupCandidates) {
    const locator = candidate.first();
    if (
      await locator.count().catch(() => 0)
      && await locator.isVisible().catch(() => false)
    ) {
      validateButton = locator;
      break;
    }
  }

  if (!validateButton) {
    for (const frame of allFrames(context)) {
      const marker = `nationality-validate-${Date.now()}`;
      const marked = await frame.evaluate((markerValue) => {
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
        const normalize = (text) => String(text || '').trim().replace(/\s+/g, ' ');
        const candidates = Array.from(modal.querySelectorAll(
          '#ok[ednmodalbtn="1"], #ok:has(> #ok-mid), #ok-mid, button, input[type="button"], input[type="submit"], a, [role="button"], [title]'
        ));
        const button = candidates.find((element) => (
          isVisible(element)
          && [
            normalize(element.textContent),
            normalize(element.getAttribute('value')),
            normalize(element.getAttribute('title')),
          ].some((text) => /^valider$/i.test(text))
        ));
        if (!button) return false;
        button.setAttribute('data-eudonet-nationality-validate', markerValue);
        return true;
      }, marker).catch(() => false);
      if (marked) {
        validateButton = frame.locator(
          `[data-eudonet-nationality-validate="${marker}"]`
        ).first();
        break;
      }
    }
  }

  if (!validateButton) {
    if (diagnostic) {
      await dumpNationalityPopupControls(context, popupFrame);
      await dumpVisibleInteractive(context, 'bouton Valider catalogue Nationalite introuvable');
    }
    throw new Error('Bouton Valider de la popup Catalogue nationalite introuvable.');
  }

  await validateButton.click({ timeout: 5000 });
  await popupSearch.locator.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => null);
  if (await popupSearch.locator.isVisible().catch(() => false)) {
    throw new Error('La popup Catalogue nationalite est restee ouverte apres validation.');
  }
  log('Popup Catalogue nationalite fermee apres validation.');

  const selectedValue = await target.locator.evaluate((element) => (
    element.value
    || element.getAttribute('title')
    || element.getAttribute('dbv')
    || ''
  ));
  if (!stripAccents(selectedValue).toLocaleLowerCase('fr-FR').includes(
    stripAccents(value).toLocaleLowerCase('fr-FR')
  )) {
    throw new Error(`Valeur finale Nationalite incorrecte: "${selectedValue}".`);
  }
  log(`Valeur finale Nationalite verifiee: ${selectedValue}`);
}

async function selectInlineReference(context, label, aliases, value, diagnostic = false) {
  const target = await waitForField(context, label, aliases, true);
  await target.locator.scrollIntoViewIfNeeded().catch(() => null);

  // Le premier clic deploie la liste. La saisie suivante filtre cette liste.
  await target.locator.click({ timeout: 10000 });
  await target.frame.waitForTimeout(300);

  let filterFrame = target.frame;
  let filterInput = filterFrame.locator('#eCatalogEditorSearch').first();
  if (!await filterInput.isVisible().catch(() => false)) {
    await target.frame.waitForTimeout(700);
    const alternateFilter = await firstVisibleLocator(context, [
      (frame) => frame.locator('input#eTxtSrch.eTxtSrch'),
    ]);
    if (!alternateFilter) {
      if (diagnostic) await dumpVisibleInteractive(context, `liste ${label} non ouverte`);
      throw new Error(`Liste de resultats introuvable pour ${label}.`);
    }
    filterFrame = alternateFilter.frame;
    filterInput = alternateFilter.locator;
  }
  await filterInput.click();
  await filterInput.fill('');
  await filterInput.pressSequentially(value, { delay: 120 });
  await filterFrame.waitForTimeout(900);
  log(`Referentiel ${label} filtre avec la valeur: ${value}`);

  const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const referenceValue = new RegExp(
    `^\\s*${escapedValue}(?:\\s+[A-Z])?(?:\\s+\\d+)?\\s*$`,
    'i'
  );

  let suggestion = null;
  const deadline = Date.now() + 10000;
  while (!suggestion && Date.now() < deadline) {
    for (const frame of allFrames(context)) {
      const suggestionCandidates = [
        frame.getByRole('option', { name: referenceValue }),
        frame.locator('[role="listbox"] [role="option"]').filter({ hasText: referenceValue }),
        frame.locator('.ui-autocomplete li, .autocomplete li, .autocomplete-item').filter({ hasText: referenceValue }),
        frame.locator('li, a, div, span').filter({ hasText: referenceValue }),
      ];
      for (const candidate of suggestionCandidates) {
        const locator = candidate.first();
        if (
          await locator.count().catch(() => 0)
          && await locator.isVisible().catch(() => false)
        ) {
          suggestion = locator;
          break;
        }
      }
      if (suggestion) break;
    }
    if (!suggestion) await target.frame.waitForTimeout(300);
  }

  if (!suggestion) {
    if (diagnostic) {
      await dumpVisibleInteractive(context, `suggestion directe ${value} introuvable pour ${label}`);
    }
    throw new Error(`Suggestion ${value} introuvable sous le champ ${label}.`);
  }

  await suggestion.click({ timeout: 5000 });
  const addSelection = await firstVisibleLocator(context, [
    (frame) => frame.locator('#BtnSelect'),
  ]);
  if (addSelection) {
    await addSelection.locator.click({ timeout: 5000 });
    await addSelection.frame.waitForTimeout(500);
    const closed = await closeTopModal(context);
    if (!closed) await target.frame.page().keyboard.press('Escape');
    await target.frame.waitForTimeout(500);
  }
  log(`Proposition directe ${value} validee pour ${label}.`);
}

async function selectReference(context, label, aliases, value, diagnostic = false) {
  const target = await waitForField(context, label, aliases, true);
  const isReadonly = await target.locator.evaluate((element) => element.readOnly);

  if (!isReadonly) {
    await target.locator.fill(value);
    await target.locator.press('ArrowDown').catch(() => null);
  } else {
    await target.locator.click({ timeout: 10000 });
    await target.frame.waitForTimeout(1200);
    if (diagnostic) await dumpVisibleInteractive(context, `referentiel ${label} ouvert`);

    const search = await firstVisibleLocator(context, [
      (frame) => frame.locator('input.Lnk_srch-inpt, input.lnk_srch-inpt'),
      (frame) => frame.locator('input[type="search"]'),
      (frame) => frame.locator('input[type="text"]:not([readonly])'),
    ]);
    if (!search) throw new Error(`Champ de recherche du referentiel ${label} introuvable.`);
    await search.locator.fill(value);
    await search.locator.press('Enter').catch(() => null);
    await search.frame.waitForTimeout(1000);
  }

  const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const suggestion = await firstVisibleLocator(context, [
    (frame) => frame.getByRole('option', { name: new RegExp(`^${escapedValue}$`, 'i') }),
    (frame) => frame.locator('[role="listbox"] [role="option"]').filter({ hasText: new RegExp(`^\\s*${escapedValue}\\s*$`, 'i') }),
    (frame) => frame.locator('.ui-autocomplete li, .autocomplete li, ul[style*="display"] li').filter({ hasText: new RegExp(`^\\s*${escapedValue}\\s*$`, 'i') }),
    (frame) => frame.locator('a, td, li').filter({ hasText: new RegExp(`^\\s*${escapedValue}\\s*$`, 'i') }),
  ]);

  if (suggestion) {
    await suggestion.locator.click({ timeout: 5000 });
    const addSelection = suggestion.frame.locator('#BtnSelect').first();
    if (
      await addSelection.count().catch(() => 0)
      && await addSelection.isVisible().catch(() => false)
    ) {
      await addSelection.click({ timeout: 5000 });
      await suggestion.frame.waitForTimeout(800);
      log(`Valeur ${value} ajoutee a la selection multiple de ${label}.`);
    }
    log(`Proposition ${value} validee pour ${label}.`);
  } else if (isReadonly) {
    if (diagnostic) await dumpVisibleInteractive(context, `proposition ${value} introuvable pour ${label}`);
    throw new Error(`Proposition ${value} introuvable pour ${label}.`);
  } else {
    await target.locator.press('Enter');
    log(`Proposition ${value} validee au clavier pour ${label}.`);
  }
}

async function fillContactForm(context, contact, diagnostic = false) {
  await fillField(
    context,
    'Nom Contact',
    ['Nom du contact'],
    contact.nomContact,
    ['COL_200_201_0_0_0']
  );
  await fillField(
    context,
    'Prenom',
    ['Prénom'],
    contact.prenom,
    ['COL_200_202_0_0_0']
  );
  await selectSingleCountry(
    context,
    'Pays de residence',
    ['Pays de résidence'],
    contact.paysResidence,
    diagnostic,
    ['COL_200_232_0_0_0']
  );
  await selectNationality(
    context,
    contact.nationalite,
    diagnostic,
    ['COL_200_207_0_0_0']
  );
  await fillField(
    context,
    'Date de naissance',
    ['Naissance'],
    contact.dateNaissance,
    ['COL_200_238_0_0_0']
  );
  await fillField(
    context,
    'Courriel',
    ['Email', 'E-mail'],
    contact.courriel,
    ['COL_400_408_0_0_0']
  );
  await fillField(
    context,
    'Portable',
    ['Telephone portable', 'Téléphone portable'],
    contact.portable,
    ['COL_400_406_0_0_0']
  );
  await selectSingleCountry(
    context,
    'Pays',
    ['Pays adresse'],
    contact.pays,
    diagnostic,
    ['COL_400_403_0_0_0']
  );
}

async function verifyContactFormValues(context, contact) {
  const expectedFields = [
    ['Nom Contact', 'COL_200_201_0_0_0', contact.nomContact, 'exact'],
    ['Prenom', 'COL_200_202_0_0_0', contact.prenom, 'exact'],
    ['Pays de residence', 'COL_200_232_0_0_0', contact.paysResidence, 'reference'],
    ['Nationalite', 'COL_200_207_0_0_0', contact.nationalite, 'reference'],
    ['Date de naissance', 'COL_200_238_0_0_0', contact.dateNaissance, 'exact'],
    ['Courriel', 'COL_400_408_0_0_0', contact.courriel, 'exact'],
    ['Portable', 'COL_400_406_0_0_0', contact.portable, 'phone'],
    ['Pays', 'COL_400_403_0_0_0', contact.pays, 'reference'],
  ];

  for (const [label, id, expected, comparison] of expectedFields) {
    const target = await waitForExactField(context, label, [id], true);
    const actual = await target.locator.evaluate((element) => (
      element.value || element.getAttribute('title') || element.getAttribute('dbv') || ''
    ));
    const normalizedActual = stripAccents(actual).trim().toLocaleLowerCase('fr-FR');
    const normalizedExpected = stripAccents(expected).trim().toLocaleLowerCase('fr-FR');
    const matches = comparison === 'reference'
      ? normalizedActual.includes(normalizedExpected)
      : comparison === 'phone'
        ? actual.replace(/\D/g, '') === expected.replace(/\D/g, '')
        : normalizedActual === normalizedExpected;
    if (!matches) {
      throw new Error(`Controle avant validation echoue pour ${label}: "${actual}" au lieu de "${expected}".`);
    }
    log(`Controle avant validation ${label}: ${actual}`);
  }
}

async function clickValidateButton(context) {
  return clickVisible(context, 'Valider', [
    (frame) => frame.getByRole('button', { name: /^valider$/i }),
    (frame) => frame.locator('input[type="button"][value="Valider" i], input[type="submit"][value="Valider" i]'),
    (frame) => frame.locator('[title="Valider" i]'),
    (frame) => frame.getByText(/^valider$/i),
  ]);
}

async function visibleValidationMessages(page) {
  if (!page || page.isClosed()) return [];

  const messages = [];
  for (const frame of page.frames()) {
    const frameMessages = await frame.evaluate(() => {
      const selectors = [
        '[role="alert"]',
        '.field-validation-error',
        '.validation-summary-errors',
        '[class*="error"]',
        '[class*="Error"]',
      ].join(',');
      const normalize = (value) => String(value || '').trim().replace(/\s+/g, ' ');
      return Array.from(document.querySelectorAll(selectors))
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return rect.width > 0
            && rect.height > 0
            && style.display !== 'none'
            && style.visibility !== 'hidden';
        })
        .map((element) => normalize(element.innerText || element.textContent))
        .filter(Boolean);
    }).catch(() => []);
    messages.push(...frameMessages);
  }
  return [...new Set(messages)];
}

async function countContactSearchMatches(context, contact) {
  const verificationPage = await context.newPage();
  try {
    await verificationPage.goto(eudonetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await verificationPage.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => null);
    const scopedContext = { pages: () => [verificationPage] };
    await hoverContacts(scopedContext);
    await verificationPage.waitForTimeout(500);
    await fillContactSearch(scopedContext, contact.nomContact);
    await verificationPage.waitForTimeout(2500);

    const matches = [];
    for (const frame of verificationPage.frames()) {
      const frameMatches = await frame.evaluate(({ lastName, firstName }) => {
        const normalize = (value) => String(value || '')
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .trim()
          .replace(/\s+/g, ' ')
          .toLocaleLowerCase('fr-FR');
        const expectedLastName = normalize(lastName);
        const expectedFirstName = normalize(firstName);
        const containsContact = (element) => {
          const text = normalize(element.innerText || element.textContent);
          return text.includes(expectedLastName) && text.includes(expectedFirstName);
        };
        const isVisible = (element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return rect.width > 0
            && rect.height > 0
            && style.display !== 'none'
            && style.visibility !== 'hidden';
        };
        const nodes = Array.from(document.querySelectorAll(
          'li, tr, td, a, div[onclick], span[onclick]'
        )).filter((element) => isVisible(element) && containsContact(element));
        const leaves = nodes.filter((element) => (
          !Array.from(element.querySelectorAll('li, tr, td, a, div[onclick], span[onclick]'))
            .some((child) => child !== element && isVisible(child) && containsContact(child))
        ));
        return leaves.map((element, index) => ({
          key: element.id || `${element.tagName}:${index}:${normalize(element.textContent)}`,
          text: String(element.innerText || element.textContent || '').trim().replace(/\s+/g, ' '),
          tag: element.tagName,
          id: element.id || '',
          className: element.className || '',
        }));
      }, {
        lastName: contact.nomContact,
        firstName: contact.prenom,
      }).catch(() => []);
      matches.push(...frameMatches);
    }

    log(`Resultats Contacts pour ${contact.nomContact} ${contact.prenom}: ${matches.length}`);
    for (const match of matches.slice(0, 10)) {
      log(`  Resultat: ${JSON.stringify(match)}`);
    }
    return matches.length;
  } finally {
    await verificationPage.close().catch(() => null);
  }
}

async function verifyContactCreated(context, validationTarget, contact, diagnostic = false) {
  const formPage = validationTarget?.frame.page() || null;
  const deadline = Date.now() + 20000;

  while (Date.now() < deadline) {
    if (!formPage || formPage.isClosed()) {
      log('Creation confirmee: la fenetre de creation du contact est fermee.');
      return;
    }

    const profileTitle = formPage.locator('h3.profile-username-title').first();
    if (await profileTitle.isVisible().catch(() => false)) {
      const profileText = await profileTitle.innerText().catch(() => '');
      if (
        stripAccents(profileText).toLocaleLowerCase('fr-FR')
          .includes(stripAccents(contact.nomContact).toLocaleLowerCase('fr-FR'))
        && stripAccents(profileText).toLocaleLowerCase('fr-FR')
          .includes(stripAccents(contact.prenom).toLocaleLowerCase('fr-FR'))
      ) {
        log(`Creation confirmee par la fiche profil: ${profileText.trim().replace(/\s+/g, ' ')}`);
        return;
      }
    }

    const nameField = await locateFieldByLabel(
      { pages: () => [formPage] },
      ['Nom Contact', 'Nom du contact'],
      'nomcontact',
      true
    ).catch(() => null);
    if (!nameField || !await nameField.locator.isVisible().catch(() => false)) {
      log('Creation confirmee: le formulaire de creation du contact a disparu.');
      return;
    }

    await formPage.waitForTimeout(500);
  }

  const messages = await visibleValidationMessages(formPage);
  if (messages.length) {
    log(`Messages visibles apres validation: ${messages.join(' | ')}`);
    throw new Error(
      `Creation refusee pour ${contact.nomContact} ${contact.prenom}: ${messages.join(' | ')}`
    );
  }
  if (diagnostic) log('Le formulaire reste ouvert sans erreur visible; verification par recherche requise.');
}

async function takeScreenshot(page, targetPath) {
  await page.bringToFront().catch(() => null);
  await page.screenshot({ path: targetPath, fullPage: true }).catch(async () => {
    await page.screenshot({ path: targetPath });
  });
  log(`Capture enregistree: ${targetPath}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(sessionPath)) {
    throw new Error(`Session Eudonet introuvable: ${sessionPath}`);
  }

  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(logPath, '', 'utf8');
  const contact = loadContact(options.dataPath);

  log(`Ouverture Eudonet: ${eudonetUrl}`);
  log(`Session: ${sessionPath}`);
  log(`Donnees: ${options.dataPath}`);
  log(`Mode: ${options.submit ? 'creation avec validation' : 'saisie sans validation'}`);

  browser = await chromium.launch({
    headless: options.headless,
    channel: browserChannel || undefined,
    slowMo: Number(process.env.SLOW_MO_MS || 100),
    args: options.headless ? [] : [`--window-size=${browserWidth},${browserHeight}`],
  });

  const context = await browser.newContext({
    storageState: sessionPath,
    viewport: { width: browserWidth, height: browserHeight },
    screen: { width: browserWidth, height: browserHeight },
  });

  activePage = await context.newPage();
  await activePage.goto(eudonetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await activePage.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => null);
  log(`Page chargee: ${activePage.url()}`);

  const initialMatchCount = options.submit
    ? await countContactSearchMatches(context, contact)
    : null;

  await hoverContacts(context);
  await activePage.waitForTimeout(1000);
  await fillContactSearch(context, 'Test');
  await activePage.waitForTimeout(1200);
  await clickNewButton(context);
  await activePage.waitForTimeout(1200);
  await clickAddButton(context);
  await activePage.waitForTimeout(2500);

  if (options.diagnostic) {
    await dumpVisibleInteractive(context, 'fiche Contact ouverte');
  }
  await fillContactForm(context, contact, options.diagnostic);
  await verifyContactFormValues(context, contact);
  await takeScreenshot(activePage, screenshotPath);

  if (options.submit) {
    const validationTarget = await clickValidateButton(context);
    await verifyContactCreated(context, validationTarget, contact, options.diagnostic);
    let finalMatchCount = 0;
    const indexingDeadline = Date.now() + 90000;
    while (finalMatchCount <= initialMatchCount && Date.now() < indexingDeadline) {
      await activePage.waitForTimeout(5000);
      finalMatchCount = await countContactSearchMatches(context, contact);
      if (finalMatchCount <= initialMatchCount) {
        log('Contact non indexe dans la recherche; nouvel essai dans 5 secondes.');
      }
    }
    if (finalMatchCount <= initialMatchCount) {
      throw new Error(
        `Creation non confirmee par la recherche Contacts: `
        + `${initialMatchCount} resultat(s) avant, ${finalMatchCount} apres.`
      );
    }
    log(
      `Creation confirmee par la recherche Contacts: `
      + `${initialMatchCount} resultat(s) avant, ${finalMatchCount} apres.`
    );
    const resultPage = context.pages().filter((page) => !page.isClosed()).at(-1) || activePage;
    await takeScreenshot(resultPage, createdScreenshotPath);
    log(`Contact cree et verifie: ${contact.nomContact} ${contact.prenom}`);
  } else {
    log('Mode sans validation: le bouton Valider n a pas ete clique.');
  }

  if (options.keepOpenMs > 0) {
    log(`Navigateur conserve ouvert pendant ${Math.round(options.keepOpenMs / 1000)} secondes.`);
    await activePage.waitForTimeout(options.keepOpenMs);
  }
  await browser.close();
}

main().catch(async (error) => {
  log(`ERREUR: ${error.message || error}`);
  if (activePage && !activePage.isClosed()) {
    await takeScreenshot(activePage, screenshotPath).catch(() => null);
  }
  if (browser) await browser.close().catch(() => null);
  process.exitCode = 1;
});
