const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const projectRoot = path.resolve(__dirname, '../..');
const sessionPath = path.join(projectRoot, 'authentification', 'eudonet-session.json');
const defaultContactPath = path.join(projectRoot, 'authentification', 'eudonet-contact-data-used.json');
const logPath = path.join(projectRoot, 'authentification', 'eudonet-new-candidature.log');
const screenshotPath = path.join(projectRoot, 'authentification', 'eudonet-new-candidature-popup.png');
const identificationScreenshotPath = path.join(
  projectRoot,
  'authentification',
  'eudonet-new-identification-popup.png'
);
const eudonetUrl = process.env.EUDONET_URL || 'https://test-omnes.eudonet.com/recette';
const browserChannel = String(process.env.PW_CHANNEL || 'chrome').trim();
const browserWidth = Number(process.env.EUDONET_BROWSER_WIDTH || 1400);
const browserHeight = Number(process.env.EUDONET_BROWSER_HEIGHT || 900);
const defaultSessionRentree = process.env.EUDONET_SESSION_RENTREE
  || 'BBA - Bordeaux - AN1 - 100% English - Fall 2026';
const defaultCycle = process.env.EUDONET_CYCLE || 'Classique - CL';
const defaultStatut = process.env.EUDONET_STATUT
  || '04. Admis - Inscription en attente de paiement';
const defaultEtape = process.env.EUDONET_ETAPE || 'Inscription';
const defaultEcoleInseec = process.env.EUDONET_ECOLE_INSEEC || 'BBA INSEEC';
let browser;
let activePage;

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  fs.appendFileSync(logPath, `${line}\n`, 'utf8');
}

function parseArgs(argv) {
  const options = {
    contactPath: defaultContactPath,
    headless: String(process.env.EUDONET_HEADLESS || '') === '1',
    keepOpenMs: Number(process.env.KEEP_OPEN_MS || 5000),
    submit: String(process.env.EUDONET_CANDIDATURE_SUBMIT || '') === '1',
    identificationOnly: false,
    identificationSubmit: String(process.env.EUDONET_IDENTIFICATION_SUBMIT || '') === '1',
    identificationCheckOnly: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--contact' || arg === '--data') {
      options.contactPath = path.resolve(process.cwd(), argv[index + 1]);
      index += 1;
    } else if (arg === '--headless') {
      options.headless = true;
    } else if (arg === '--submit') {
      options.submit = true;
    } else if (arg === '--no-submit') {
      options.submit = false;
    } else if (arg === '--identification-only') {
      options.identificationOnly = true;
    } else if (arg === '--identification-submit') {
      options.identificationOnly = true;
      options.identificationSubmit = true;
    } else if (arg === '--identification-check') {
      options.identificationCheckOnly = true;
    } else if (arg === '--keep-open-ms') {
      options.keepOpenMs = Number(argv[index + 1]);
      index += 1;
    } else {
      throw new Error(`Option inconnue: ${arg}`);
    }
  }

  return options;
}

function stripAccents(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalize(value) {
  return stripAccents(value).trim().replace(/\s+/g, ' ').toLocaleLowerCase('fr-FR');
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

async function waitForVisible(context, factories, label, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const target = await firstVisible(context, factories);
    if (target) return target;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`${label} introuvable apres ${Math.round(timeout / 1000)} secondes.`);
}

async function hoverContacts(context) {
  const deadline = Date.now() + 60000;
  let lastError = null;

  while (Date.now() < deadline) {
    const contacts = await firstVisible(context, [
      (frame) => frame.locator('#tab_header_200'),
      (frame) => frame.getByText(/^contacts$/i),
    ]);
    if (contacts) {
      try {
        await contacts.locator.hover({ timeout: 3000 });
        log('Menu Contacts survole.');
        return;
      } catch (error) {
        lastError = error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error(`Menu Contacts indisponible: ${lastError?.message || 'introuvable'}`);
}

async function searchAndOpenContact(context, contact) {
  await hoverContacts(context);
  const search = await waitForVisible(context, [
    (frame) => frame.locator('input.Lnk_srch-inpt, input.lnk_srch-inpt'),
    (frame) => frame.getByRole('textbox'),
  ], 'Champ de recherche Contacts');
  const queries = [`${contact.nomContact} ${contact.prenom}`, contact.nomContact];
  let result = null;

  for (const query of queries) {
    await search.locator.click();
    await search.locator.fill(query);
    log(`Recherche Contacts saisie: ${query}`);

    const deadline = Date.now() + 12000;
    while (!result && Date.now() < deadline) {
      for (const frame of allFrames(context)) {
        const candidates = frame.locator('li.navLst[id]');
        const count = await candidates.count().catch(() => 0);
        const matches = [];
        for (let index = 0; index < count; index += 1) {
          const candidate = candidates.nth(index);
          if (!await candidate.isVisible().catch(() => false)) continue;
          const text = await candidate.innerText().catch(() => '');
          if (
            normalize(text).includes(normalize(contact.nomContact))
            && normalize(text).includes(normalize(contact.prenom))
          ) {
            const nestedMatches = await candidate.locator('li.navLst[id]').count().catch(() => 0);
            if (!nestedMatches) matches.push({ candidate, text });
          }
        }
        matches.sort((left, right) => left.text.length - right.text.length);
        result = matches[0]?.candidate || null;
        if (result) break;
      }
      if (!result) await activePage.waitForTimeout(400);
    }
    if (result) break;
    log(`Aucun resultat avec la recherche: ${query}`);
  }

  if (!result) {
    throw new Error(
      `Contact ${contact.nomContact} ${contact.prenom} absent des resultats.`
    );
  }
  const resultText = (await result.innerText()).trim().replace(/\s+/g, ' ');
  log(`Contact trouve dans la liste: ${resultText}`);
  await result.click({ timeout: 10000 });
  log('Contact selectionne.');
}

async function verifyContactProfile(context, contact) {
  const profile = await waitForVisible(context, [
    (frame) => frame.locator('h3.profile-username-title'),
    (frame) => frame.locator('.profile-username-title'),
    (frame) => frame.locator('h1, h2, h3, h4').filter({
      hasText: new RegExp(
        `${contact.prenom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*`
        + `${contact.nomContact.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
        'i'
      ),
    }),
  ], 'Titre de la fiche Contact', 30000);
  const details = await profile.locator.evaluate((element) => ({
    text: String(element.textContent || '').trim().replace(/\s+/g, ' '),
    title: String(element.getAttribute('title') || '').trim(),
    tag: element.tagName,
    className: element.className || '',
  }));
  if (
    !normalize(details.text).includes(normalize(contact.nomContact))
    || !normalize(details.text).includes(normalize(contact.prenom))
  ) {
    throw new Error(
      `Fiche incorrecte: titre="${details.title}", contenu="${details.text}".`
    );
  }
  log(`Fiche Contact ouverte et verifiee: ${details.text}`);
  log(`Element titre utilise: ${details.tag}.${details.className || '(sans classe)'}`);
}

async function openBookmarks(context) {
  const bookmarks = await waitForVisible(context, [
    (frame) => frame.locator('a.nav-tab--btn[href="#signet"]'),
    (frame) => frame.getByRole('link', { name: /signets/i }),
  ], 'Onglet Signets');

  if (await bookmarks.locator.getAttribute('aria-expanded') === 'true') {
    log('Onglet Signets deja ouvert.');
    return;
  }

  const waiter = bookmarks.frame.locator('#waiter.waitOn');
  await waiter.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => null);
  await bookmarks.locator.click({ timeout: 10000 });
  log('Onglet Signets ouvert.');
}

async function findBookmarkCard(context, expectedTitle) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    for (const frame of allFrames(context)) {
      const headers = frame.locator('.box-header.bkm-header.with-border');
      const count = await headers.count().catch(() => 0);
      for (let index = 0; index < count; index += 1) {
        const header = headers.nth(index);
        if (!await header.isVisible().catch(() => false)) continue;
        const title = await header.locator('.box-title').innerText().catch(() => '');
        if (normalize(title).includes(normalize(expectedTitle))) {
          const card = header.locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " box ")][1]');
          if (await card.count().catch(() => 0)) {
            log(`Carte Signets visible: ${title.trim().replace(/\s+/g, ' ')}`);
            return { frame, card, header };
          }
        }
      }
    }
    await activePage.waitForTimeout(400);
  }
  throw new Error(`Carte Signets ${expectedTitle} introuvable.`);
}

async function fillAndVerifyTextField(locator, label, value, comparison = 'exact') {
  await locator.waitFor({ state: 'visible', timeout: 10000 });
  await locator.click({ timeout: 10000 });
  await locator.fill(value, { timeout: 10000 });
  const actualValue = (await locator.inputValue()).trim().replace(/\s+/g, ' ');
  const isValid = comparison === 'digits'
    ? actualValue.replace(/\D/g, '') === String(value).replace(/\D/g, '')
    : normalize(actualValue) === normalize(value);
  if (!isValid) {
    throw new Error(`${label} incorrect apres saisie: "${actualValue}".`);
  }
  log(`Champ ${label} saisi et verifie: ${actualValue}`);
}

async function selectLinkedCandidature(context, fieldInput, contact) {
  await fieldInput.scrollIntoViewIfNeeded().catch(() => null);
  await fieldInput.click({ timeout: 10000 });

  const search = await waitForVisible(context, [
    (frame) => frame.locator('#eCatalogEditorSearch'),
    (frame) => frame.locator('input#eTxtSrch.Lnk_srch-inpt'),
    (frame) => frame.locator('input.Lnk_srch-inpt:not([readonly])'),
  ], 'Champ de recherche Candidatures de la fiche Identification');
  await search.locator.click();
  await search.locator.fill('');
  await search.locator.pressSequentially(contact.nomContact, { delay: 60 });
  log(`Recherche Candidature saisie: ${contact.nomContact}`);

  const deadline = Date.now() + 30000;
  let matchingResult = null;
  while (!matchingResult && Date.now() < deadline) {
    const popupRows = search.frame.locator('tr');
    const popupRowCount = await popupRows.count().catch(() => 0);
    for (let index = 0; index < popupRowCount; index += 1) {
      const row = popupRows.nth(index);
      if (!await row.isVisible().catch(() => false)) continue;
      const text = (await row.innerText().catch(() => ''))
        .trim()
        .replace(/\s+/g, ' ');
      if (
        normalize(text).includes(normalize(contact.nomContact))
        && normalize(text).includes(normalize(contact.prenom))
      ) {
        matchingResult = row;
        break;
      }
    }
    if (matchingResult) break;

    for (const frame of allFrames(context)) {
      const resultRows = frame.locator(
        '#eCatalogEditorSearchResults tr, #eCatalogEditorValues tr'
      );
      const rowCount = await resultRows.count().catch(() => 0);
      for (let index = 0; index < rowCount; index += 1) {
        const row = resultRows.nth(index);
        if (!await row.isVisible().catch(() => false)) continue;
        const text = (await row.innerText().catch(() => ''))
          .trim()
          .replace(/\s+/g, ' ');
        if (
          normalize(text).includes(normalize(contact.nomContact))
          && normalize(text).includes(normalize(contact.prenom))
        ) {
          matchingResult = row;
          break;
        }
      }
      if (matchingResult) break;

      const results = frame.locator(
        '#eCatalogEditorSearchResults td.eCatalogEditorMenuItem, '
        + '#eCatalogEditorValues td.eCatalogEditorMenuItem, '
        + 'td[id^="CatValueResult_"]'
      );
      const count = await results.count().catch(() => 0);
      for (let index = 0; index < count; index += 1) {
        const result = results.nth(index);
        if (!await result.isVisible().catch(() => false)) continue;
        const text = (await result.innerText().catch(() => ''))
          .trim()
          .replace(/\s+/g, ' ');
        if (
          normalize(text).includes(normalize(contact.nomContact))
          && normalize(text).includes(normalize(contact.prenom))
        ) {
          matchingResult = result;
          break;
        }
      }
      if (matchingResult) break;
    }
    if (!matchingResult) await activePage.waitForTimeout(400);
  }
  if (!matchingResult) {
    throw new Error(
      `Candidature de ${contact.nomContact} ${contact.prenom} absente des resultats.`
    );
  }

  const resultDetails = await matchingResult.evaluate((element) => ({
    id: element.id || '',
    dbv: element.getAttribute('dbv') || '',
    text: String(element.textContent || '').trim().replace(/\s+/g, ' '),
  }));
  log(`Candidature correspondante trouvee: ${JSON.stringify(resultDetails)}`);
  await matchingResult.click({ timeout: 10000 });

  const closeDeadline = Date.now() + 10000;
  while (Date.now() < closeDeadline) {
    if (!await search.locator.isVisible().catch(() => false)) break;
    await activePage.waitForTimeout(200);
  }
  if (await search.locator.isVisible().catch(() => false)) {
    throw new Error('La liste Candidatures est restee ouverte apres selection.');
  }

  const finalValue = (await fieldInput.inputValue().catch(() => '')
    || await fieldInput.getAttribute('title').catch(() => '')
    || '').trim().replace(/\s+/g, ' ');
  if (
    !normalize(finalValue).includes(normalize(contact.nomContact))
    || !normalize(finalValue).includes(normalize(contact.prenom))
  ) {
    throw new Error(
      `Champ Candidatures incorrect apres selection: "${finalValue}".`
    );
  }
  log(`Champ Candidatures alimente et verifie: ${finalValue}`);
}

async function openNewIdentification(context, contact, ecoleInseec) {
  const identificationCard = await findBookmarkCard(context, 'Identification');
  const identificationCountBefore = await identificationCard.card
    .locator('tbody.tbody_asso tr[role="row"]')
    .count()
    .catch(() => 0);
  log(`Identifications presentes avant creation: ${identificationCountBefore}`);
  const actionButton = identificationCard.card.locator('button .action-title')
    .filter({ hasText: /^Actions/i })
    .locator('xpath=ancestor::button[1]')
    .first();
  await actionButton.waitFor({ state: 'visible', timeout: 10000 });
  await actionButton.click();
  log('Menu Actions de la carte Identification ouvert.');

  let newOption = null;
  const optionDeadline = Date.now() + 5000;
  while (!newOption && Date.now() < optionDeadline) {
    const newOptions = identificationCard.card.locator(
      'a[href="#!"]:has(i.fa-plus-square), a, button, li, [role="menuitem"]'
    );
    const optionCount = await newOptions.count().catch(() => 0);
    for (let index = 0; index < optionCount; index += 1) {
      const candidate = newOptions.nth(index);
      if (
        await candidate.isVisible().catch(() => false)
        && /^Nouveau$/i.test((await candidate.innerText().catch(() => '')).trim())
      ) {
        newOption = candidate;
        break;
      }
    }
    if (!newOption) await activePage.waitForTimeout(250);
  }
  let optionDetails = null;
  if (newOption) {
    optionDetails = await newOption.evaluate((element) => ({
      tag: element.tagName,
      text: String(element.textContent || '').trim().replace(/\s+/g, ' '),
      outerHTML: element.outerHTML.slice(0, 800),
    }));
    await newOption.click({ timeout: 10000 });
  } else {
    optionDetails = await identificationCard.frame.evaluate(() => {
      const normalizeText = (value) => String(value || '').trim().replace(/\s+/g, ' ');
      const isVisible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0
          && rect.height > 0
          && style.display !== 'none'
          && style.visibility !== 'hidden';
      };
      const elements = Array.from(document.querySelectorAll('*'))
        .filter((element) => isVisible(element) && /^Nouveau$/i.test(normalizeText(element.textContent)))
        .sort((left, right) => left.children.length - right.children.length);
      const target = elements[0];
      if (!target) return null;
      const clickable = target.closest('a, button, li, [role="menuitem"], [onclick]') || target;
      const details = {
        tag: clickable.tagName,
        text: normalizeText(clickable.textContent),
        outerHTML: clickable.outerHTML.slice(0, 800),
      };
      clickable.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      clickable.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      clickable.click();
      return details;
    }).catch(() => null);
  }
  if (!optionDetails) {
    throw new Error('Option Nouveau de la carte Identification introuvable.');
  }
  log(`Option Nouveau Identification ciblee: ${JSON.stringify(optionDetails)}`);

  const birthNameFactories = [
    (frame) => frame.locator('#COL_15400_15401_0_0_0'),
    (frame) => frame.locator(
      'input[name="COL_15400_15401_0_0_0"][eaction="LNKFREETEXT"]'
    ),
  ];
  let birthName = null;
  const directFormDeadline = Date.now() + 5000;
  while (!birthName && Date.now() < directFormDeadline) {
    birthName = await firstVisible(context, birthNameFactories);
    if (!birthName) await activePage.waitForTimeout(300);
  }

  if (!birthName) {
    const addButton = await waitForVisible(context, [
      (frame) => frame.locator('a[title="Nouvelle fiche Identification"]'),
      (frame) => frame.locator('.lnkFieldsAdd').filter({ hasText: /^Ajouter$/i }),
      (frame) => frame.getByRole('button', { name: /^ajouter$/i }),
      (frame) => frame.getByRole('link', { name: /^ajouter$/i }),
    ], 'Bouton Ajouter de la popup Identification');
    await addButton.locator.click({ timeout: 10000 });
    log('Bouton Ajouter de la popup Identification intermediaire clique.');
    birthName = await waitForVisible(
      context,
      birthNameFactories,
      'Champ Nom de naissance de la fiche Identification',
      30000
    );
  } else {
    log('La fiche Identification s est ouverte directement, sans popup Ajouter intermediaire.');
  }

  const fieldDetails = await birthName.locator.evaluate((element) => ({
    id: element.id || '',
    name: element.getAttribute('name') || '',
    className: element.className || '',
    eaction: element.getAttribute('eaction') || '',
  }));
  log(`Popup Identification ouverte, champ Nom de naissance verifie: ${JSON.stringify(fieldDetails)}`);

  const firstName = await waitForVisible(context, [
    (frame) => frame.locator('#COL_15400_15402_0_0_0'),
  ], 'Champ Prenom de la fiche Identification');
  const email = await waitForVisible(context, [
    (frame) => frame.locator('#COL_15400_15404_0_0_0'),
  ], 'Champ Courriel principal de la fiche Identification');
  const mobile = await waitForVisible(context, [
    (frame) => frame.locator('#COL_15400_15406_0_0_0'),
  ], 'Champ Portable de la fiche Identification');
  const country = await waitForVisible(context, [
    (frame) => frame.locator('#COL_15400_15412_0_0_0'),
  ], 'Champ Pays de la fiche Identification');
  const nationality = await waitForVisible(context, [
    (frame) => frame.locator('#COL_15400_15415_0_0_0'),
  ], 'Champ Nationalite de la fiche Identification');
  const birthDate = await waitForVisible(context, [
    (frame) => frame.locator('#COL_15400_15416_0_0_0'),
  ], 'Champ Date de naissance de la fiche Identification');
  const school = await waitForVisible(context, [
    (frame) => frame.locator('#COL_15400_15422_0_0_0'),
  ], 'Champ Ecole INSEEC de la fiche Identification');
  const candidature = await waitForVisible(context, [
    (frame) => frame.locator('#COL_15400_1401_0_0_0'),
  ], 'Champ Candidatures de la fiche Identification');
  log(
    'Champs Prenom, Courriel principal, Portable, Pays, Nationalite '
    + 'Date de naissance, Ecole INSEEC et Candidatures visibles et verifies.'
  );

  await fillAndVerifyTextField(
    birthName.locator,
    'Nom de naissance',
    contact.nomContact
  );
  await fillAndVerifyTextField(
    firstName.locator,
    'Prenom',
    contact.prenom
  );
  await fillAndVerifyTextField(
    email.locator,
    'Courriel principal',
    contact.courriel
  );
  await fillAndVerifyTextField(
    mobile.locator,
    'Portable',
    contact.portable,
    'digits'
  );
  await selectAdvancedCatalogValue(
    context,
    country.locator,
    'Pays Identification',
    contact.paysResidence
  );
  await selectAdvancedCatalogValue(
    context,
    nationality.locator,
    'Nationalite Identification',
    contact.pays
  );
  await fillAndVerifyTextField(
    birthDate.locator,
    'Date de naissance',
    contact.dateNaissance,
    'digits'
  );
  await selectAdvancedCatalogValue(
    context,
    school.locator,
    'Ecole INSEEC',
    ecoleInseec
  );
  await selectLinkedCandidature(context, candidature.locator, contact);

  return {
    birthNameInput: birthName.locator,
    firstNameInput: firstName.locator,
    emailInput: email.locator,
    mobileInput: mobile.locator,
    countryInput: country.locator,
    nationalityInput: nationality.locator,
    birthDateInput: birthDate.locator,
    schoolInput: school.locator,
    candidatureInput: candidature.locator,
    identificationCountBefore,
  };
}

async function openNewCandidature(context) {
  await findBookmarkCard(context, 'Identification');
  const candidatureCard = await findBookmarkCard(context, 'Candidatures');
  const candidatureCountBefore = await candidatureCard.card
    .locator('tbody.tbody_asso tr[role="row"]')
    .count()
    .catch(() => 0);
  log(`Candidatures presentes avant creation: ${candidatureCountBefore}`);
  const actionButton = candidatureCard.card.locator('button .action-title')
    .filter({ hasText: /^Actions/i })
    .locator('xpath=ancestor::button[1]')
    .first();
  await actionButton.waitFor({ state: 'visible', timeout: 10000 });
  await actionButton.click();
  log('Menu Actions de la carte Candidatures ouvert.');

  const modernNewOptions = candidatureCard.card.locator(
    'a[href="#!"]:has(i.fa-plus-square)'
  );
  let exactNewOption = null;
  const modernOptionCount = await modernNewOptions.count().catch(() => 0);
  for (let index = 0; index < modernOptionCount; index += 1) {
    const candidate = modernNewOptions.nth(index);
    if (
      await candidate.isVisible().catch(() => false)
      && /^Nouveau$/i.test((await candidate.innerText().catch(() => '')).trim())
    ) {
      exactNewOption = candidate;
      break;
    }
  }
  if (!exactNewOption) {
    const legacyNewOptions = candidatureCard.frame.locator(
      'a[onclick*="openLnkFileDialog(1,200"][onclick*="add-new-file-rightmenu"]'
    );
    const legacyOptionCount = await legacyNewOptions.count().catch(() => 0);
    for (let index = 0; index < legacyOptionCount; index += 1) {
      const candidate = legacyNewOptions.nth(index);
      if (await candidate.isVisible().catch(() => false)) {
        exactNewOption = candidate;
        break;
      }
    }
  }
  let clickedNew = null;
  if (exactNewOption && await exactNewOption.isVisible().catch(() => false)) {
    clickedNew = await exactNewOption.evaluate((element) => ({
      tag: element.tagName,
      id: element.id || '',
      className: element.className || '',
      text: String(element.textContent || '').trim().replace(/\s+/g, ' '),
      outerHTML: element.outerHTML.slice(0, 800),
    }));
    await exactNewOption.click({ timeout: 10000 });
  } else {
    clickedNew = await candidatureCard.frame.evaluate(() => {
    const normalizeText = (value) => String(value || '').trim().replace(/\s+/g, ' ');
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0
        && rect.height > 0
        && style.display !== 'none'
        && style.visibility !== 'hidden';
    };
    const elements = Array.from(document.querySelectorAll('*'))
      .filter((element) => isVisible(element) && /^Nouveau$/i.test(normalizeText(element.textContent)))
      .sort((left, right) => left.children.length - right.children.length);
    const target = elements[0];
    if (!target) return null;
    const clickable = target.closest('a, button, li, [role="menuitem"], [onclick]') || target;
    const details = {
      tag: clickable.tagName,
      id: clickable.id || '',
      className: clickable.className || '',
      text: normalizeText(clickable.textContent),
      outerHTML: clickable.outerHTML.slice(0, 800),
    };
    clickable.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    clickable.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    clickable.click();
    return details;
    }).catch(() => null);
  }
  if (!clickedNew) throw new Error('Option Nouveau du menu Actions introuvable dans le DOM.');
  log(`Option Nouveau ciblee: ${JSON.stringify(clickedNew)}`);
  log('Option Nouveau de la carte Candidatures selectionnee.');

  const popup = await waitForVisible(context, [
    (frame) => frame.locator('.ContainerModal'),
    (frame) => frame.locator('[role="dialog"]'),
    (frame) => frame.locator('.modal:visible'),
    (frame) => frame.locator('.window_iframe'),
  ], 'Popup de creation de candidature', 30000);
  const popupText = await popup.locator.innerText().catch(() => '');
  log(`Popup de creation de candidature visible: ${popupText.trim().replace(/\s+/g, ' ').slice(0, 200)}`);

  const sessionFieldFactories = [
    (frame) => frame.locator(
      'td#COL_1400_1443[did="1443"][lib="Session de rentrée"][eltvalid="COL_1400_1443_0_0_0"]'
    ),
    (frame) => frame.locator('td#COL_1400_1443[title="Session de rentrée"]'),
  ];
  let sessionLabel = null;
  const directFormDeadline = Date.now() + 5000;
  while (!sessionLabel && Date.now() < directFormDeadline) {
    sessionLabel = await firstVisible(context, sessionFieldFactories);
    if (!sessionLabel) await activePage.waitForTimeout(300);
  }

  if (!sessionLabel) {
    const addButton = await waitForVisible(context, [
      (frame) => frame.locator('a[title="Nouvelle fiche Candidatures"]'),
      (frame) => frame.locator('.lnkFieldsAdd').filter({ hasText: /^Ajouter$/i }),
      (frame) => frame.getByRole('button', { name: /^ajouter$/i }),
      (frame) => frame.getByRole('link', { name: /^ajouter$/i }),
      (frame) => frame.locator('a, button, li, div').filter({ hasText: /^Ajouter$/i }),
    ], 'Bouton Ajouter de la popup');
    await addButton.locator.click({ timeout: 10000 });
    log('Bouton Ajouter de la popup intermediaire clique.');
    sessionLabel = await waitForVisible(
      context,
      sessionFieldFactories,
      'Champ Session de rentree de la fiche Candidature',
      30000
    );
  } else {
    log('La fiche Candidature s est ouverte directement, sans popup Ajouter intermediaire.');
  }

  const sessionDetails = await sessionLabel.locator.evaluate((element) => ({
    text: String(element.textContent || '').trim().replace(/\s+/g, ' '),
    title: element.getAttribute('title') || '',
    id: element.id || '',
    fieldId: element.getAttribute('eltvalid') || '',
  }));
  const sessionInput = sessionLabel.frame.locator('#COL_1400_1443_0_0_0').first();
  if (!await sessionInput.isVisible().catch(() => false)) {
    throw new Error('Le libelle Session de rentree est visible, mais son champ associe est absent.');
  }
  const cycleInput = sessionLabel.frame.locator('#COL_1400_1432_0_0_0').first();
  const statutInput = sessionLabel.frame.locator('#COL_1400_1402_0_0_0').first();
  const etapeInput = sessionLabel.frame.locator('#COL_1400_1442_0_0_0').first();
  if (!await cycleInput.isVisible().catch(() => false)) {
    throw new Error('Le champ Cycle est absent de la fiche Candidature.');
  }
  if (!await statutInput.isVisible().catch(() => false)) {
    throw new Error('Le champ Statut est absent de la fiche Candidature.');
  }
  if (!await etapeInput.isVisible().catch(() => false)) {
    throw new Error('Le champ Etape est absent de la fiche Candidature.');
  }
  log(`Fiche Candidature ouverte: ${JSON.stringify(sessionDetails)}`);
  log('Champs Session de rentree, Cycle, Statut et Etape visibles et verifies.');

  return {
    sessionInput,
    cycleInput,
    statutInput,
    etapeInput,
    candidatureCountBefore,
  };
}

async function openFieldCatalog(context, fieldInput, fieldLabel) {
  const allValuesFactories = [
    (frame) => frame.locator('#eCatalogEditorAdvanced'),
    (frame) => frame.locator('.eCatalogEditorMenuItemAdv').filter({
      hasText: /Toute la liste/i,
    }),
  ];
  const fieldDetails = await fieldInput.evaluate((element) => ({
    outerHTML: element.outerHTML.slice(0, 1000),
    parentHTML: element.parentElement?.outerHTML.slice(0, 1600) || '',
    rect: element.getBoundingClientRect().toJSON(),
  }));
  log(`Champ ${fieldLabel} cible: ${JSON.stringify(fieldDetails)}`);

  const openAttempts = [
    async () => fieldInput.click({ timeout: 10000 }),
    async () => fieldInput.evaluate((element) => {
      for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
        element.dispatchEvent(new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          view: window,
        }));
      }
    }),
    async () => fieldInput.locator('xpath=parent::*').click({
      force: true,
      timeout: 10000,
    }),
    async () => fieldInput.dblclick({ force: true, timeout: 10000 }),
  ];

  let allValues = null;
  for (let index = 0; index < openAttempts.length; index += 1) {
    await openAttempts[index]();
    log(`Tentative ${index + 1} d ouverture du champ ${fieldLabel} effectuee.`);
    const deadline = Date.now() + 3000;
    while (!allValues && Date.now() < deadline) {
      allValues = await firstVisible(context, allValuesFactories);
      if (!allValues) await activePage.waitForTimeout(200);
    }
    if (allValues) break;
  }
  if (!allValues) {
    throw new Error(`Option Toute la liste du champ ${fieldLabel} introuvable.`);
  }
  const allValuesText = (await allValues.locator.innerText().catch(() => ''))
    .trim()
    .replace(/\s+/g, ' ');
  if (!normalize(allValuesText).includes(normalize('Toute la liste'))) {
    throw new Error(`Option Toute la liste incorrecte: "${allValuesText}".`);
  }
  await allValues.locator.click({ timeout: 10000 });
  log(`Option Toute la liste selectionnee pour ${fieldLabel}.`);
}

async function selectSessionRentree(context, sessionInput, expectedSession) {
  await openFieldCatalog(context, sessionInput, 'Session de rentree');

  const search = await waitForVisible(context, [
    (frame) => frame.locator('#eTxtSrch.Lnk_srch-inpt'),
    (frame) => frame.locator('input#eTxtSrch'),
  ], 'Champ de recherche de la popup Associer', 30000);
  const historyButton = await waitForVisible(context, [
    (frame) => frame.locator('#histoFilter'),
    (frame) => frame.locator('.histoFilter').filter({
      hasText: /Afficher l['’]historique/i,
    }),
  ], 'Bouton Afficher l historique de la popup Associer', 30000);
  log('Popup Associer ouverte et verifiee.');

  const historyBefore = (await historyButton.locator.innerText().catch(() => ''))
    .trim()
    .replace(/\s+/g, ' ');
  if (!/Afficher l['’]historique/i.test(historyBefore)) {
    throw new Error(
      `Etat initial inattendu du bouton historique: "${historyBefore}".`
    );
  }
  await historyButton.locator.click({ timeout: 10000 });

  const historyAfter = await waitForVisible(context, [
    (frame) => frame.locator('#histoFilter').filter({
      hasText: /Masquer l['’]historique/i,
    }),
    (frame) => frame.locator('#histoFilterTxt').filter({
      hasText: /Masquer l['’]historique/i,
    }),
  ], 'Etat Masquer l historique', 10000);
  const historyAfterText = (await historyAfter.locator.innerText().catch(() => ''))
    .trim()
    .replace(/\s+/g, ' ');
  log(`Historique affiche: ${historyAfterText}`);

  await search.locator.click();
  await search.locator.fill('');
  await search.locator.pressSequentially(expectedSession, { delay: 25 });
  log(`Recherche Session de rentree saisie: ${expectedSession}`);

  const deadline = Date.now() + 30000;
  let matchingCell = null;
  while (!matchingCell && Date.now() < deadline) {
    for (const frame of allFrames(context)) {
      const cells = frame.locator(
        'table#mt_3200 tbody td[id^="COL_3200_3201_"]'
      );
      const count = await cells.count().catch(() => 0);
      for (let index = 0; index < count; index += 1) {
        const cell = cells.nth(index);
        if (!await cell.isVisible().catch(() => false)) continue;
        const text = (await cell.innerText().catch(() => '')).trim().replace(/\s+/g, ' ');
        if (normalize(text) === normalize(expectedSession)) {
          matchingCell = cell;
          break;
        }
      }
      if (matchingCell) break;
    }
    if (!matchingCell) await activePage.waitForTimeout(400);
  }
  if (!matchingCell) {
    throw new Error(
      `Session "${expectedSession}" absente du tableau apres filtrage.`
    );
  }
  log(`Session presente dans le tableau: ${expectedSession}`);

  const resultRow = matchingCell.locator('xpath=ancestor::tr[1]');
  await resultRow.click({ timeout: 10000 });
  const selectedRow = await resultRow.evaluate((element) => ({
    id: element.id || '',
    className: element.className || '',
    eid: element.getAttribute('eid') || '',
  }));
  log(`Session selectionnee dans le tableau: ${JSON.stringify(selectedRow)}`);

  const validate = await waitForVisible(context, [
    (frame) => frame.locator('div#ok[ednmodalbtn="1"]'),
    (frame) => frame.locator('#ok-mid').filter({ hasText: /^Valider$/i }),
  ], 'Bouton Valider de la popup Associer');
  await validate.locator.click({ timeout: 10000 });
  log('Bouton Valider de la popup Associer clique.');

  const popupClosedDeadline = Date.now() + 20000;
  while (Date.now() < popupClosedDeadline) {
    const visibleSearch = await firstVisible(context, [
      (frame) => frame.locator('#eTxtSrch.Lnk_srch-inpt'),
      (frame) => frame.locator('input#eTxtSrch'),
    ]);
    if (!visibleSearch) break;
    await activePage.waitForTimeout(300);
  }
  const popupStillVisible = await firstVisible(context, [
    (frame) => frame.locator('#eTxtSrch.Lnk_srch-inpt'),
    (frame) => frame.locator('input#eTxtSrch'),
  ]);
  if (popupStillVisible) {
    throw new Error('La popup Associer est toujours visible apres validation.');
  }

  await sessionInput.waitFor({ state: 'visible', timeout: 10000 });
  const finalValue = (await sessionInput.inputValue()).trim().replace(/\s+/g, ' ');
  if (normalize(finalValue) !== normalize(expectedSession)) {
    throw new Error(
      `Session de rentree incorrecte apres validation: "${finalValue}".`
    );
  }
  log(`Champ Session de rentree alimente et verifie: ${finalValue}`);
}

async function selectAdvancedCatalogValue(context, fieldInput, fieldLabel, expectedValue) {
  await openFieldCatalog(context, fieldInput, fieldLabel);

  const search = await waitForVisible(context, [
    (frame) => frame.locator('input#eTxtSrch.eTxtSrch'),
    (frame) => frame.locator('input#eTxtSrch'),
  ], `Champ Recherche du catalogue ${fieldLabel}`, 30000);
  log(`Popup Catalogue ${fieldLabel} ouverte et verifiee.`);

  await search.locator.click();
  await search.locator.fill('');
  await search.locator.pressSequentially(expectedValue, { delay: 25 });
  log(`Recherche ${fieldLabel} saisie: ${expectedValue}`);

  const deadline = Date.now() + 30000;
  let matchingLabel = null;
  while (!matchingLabel && Date.now() < deadline) {
    for (const frame of allFrames(context)) {
      const labels = frame.locator('[id^="lbl_"]');
      const count = await labels.count().catch(() => 0);
      for (let index = 0; index < count; index += 1) {
        const label = labels.nth(index);
        if (!await label.isVisible().catch(() => false)) continue;
        const text = (await label.innerText().catch(() => ''))
          .trim()
          .replace(/\s+/g, ' ');
        if (normalize(text) === normalize(expectedValue)) {
          matchingLabel = label;
          break;
        }
      }
      if (!matchingLabel) {
        const matchingId = await frame.evaluate((expected) => {
          const normalizeText = (value) => String(value || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .trim()
            .replace(/\s+/g, ' ')
            .toLocaleLowerCase('fr-FR');
          const candidate = Array.from(document.querySelectorAll('[id^="lbl_"]'))
            .find((element) => {
              const rect = element.getBoundingClientRect();
              const style = window.getComputedStyle(element);
              return rect.width > 0
                && rect.height > 0
                && style.display !== 'none'
                && style.visibility !== 'hidden'
                && normalizeText(element.textContent) === normalizeText(expected);
            });
          return candidate?.id || '';
        }, expectedValue).catch(() => '');
        if (matchingId) {
          matchingLabel = frame.locator(`[id="${matchingId}"]`).first();
        }
      }
      if (!matchingLabel) {
        const exactTexts = frame.getByText(expectedValue, { exact: true });
        const exactTextCount = await exactTexts.count().catch(() => 0);
        for (let index = 0; index < exactTextCount; index += 1) {
          const candidate = exactTexts.nth(index);
          if (await candidate.isVisible().catch(() => false)) {
            matchingLabel = candidate;
            break;
          }
        }
      }
      if (matchingLabel) break;
    }
    if (!matchingLabel) await activePage.waitForTimeout(400);
  }
  if (!matchingLabel) {
    throw new Error(
      `Valeur "${expectedValue}" absente du catalogue ${fieldLabel}.`
    );
  }
  log(`Valeur presente dans le catalogue ${fieldLabel}: ${expectedValue}`);

  const resultRow = matchingLabel.locator(
    'xpath=ancestor-or-self::li[@bd][1] '
    + '| ancestor-or-self::li[starts-with(@id, "val_")][1] '
    + '| ancestor-or-self::*[contains(@onclick, "clickVal")][1]'
  );
  const rowId = await resultRow.getAttribute('id').catch(() => '');
  let clicked = false;
  const clickDeadline = Date.now() + 10000;
  while (!clicked && Date.now() < clickDeadline) {
    for (const frame of allFrames(context)) {
      clicked = await frame.evaluate((targetId) => {
        const element = document.getElementById(targetId);
        if (!element) return false;
        element.dispatchEvent(new MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
          view: window,
        }));
        element.dispatchEvent(new MouseEvent('mouseup', {
          bubbles: true,
          cancelable: true,
          view: window,
        }));
        element.click();
        return true;
      }, rowId).catch(() => false);
      if (clicked) break;
    }
    if (!clicked) await activePage.waitForTimeout(200);
  }
  if (!clicked) {
    throw new Error(`Ligne ${fieldLabel} impossible a selectionner: ${rowId}.`);
  }
  const selectedRow = await firstVisible(context, [
    (frame) => frame.locator(`[id="${rowId}"]`),
  ]).then((target) => target?.locator.evaluate((element) => ({
    id: element.id || '',
    className: element.className || '',
    ednval: element.getAttribute('ednval') || '',
  }))).catch(() => ({ id: rowId, className: '', ednval: '' }));
  log(`Valeur ${fieldLabel} selectionnee: ${JSON.stringify(selectedRow)}`);

  const validate = await waitForVisible(context, [
    (frame) => frame.locator('div#ok[ednmodalbtn="1"]'),
    (frame) => frame.locator('#ok-mid').filter({ hasText: /^Valider$/i }),
  ], `Bouton Valider du catalogue ${fieldLabel}`);
  await validate.frame.locator('#waiter.waitOn').waitFor({
    state: 'hidden',
    timeout: 20000,
  }).catch(() => null);
  await validate.locator.click({ timeout: 10000 }).catch(async () => {
    await validate.locator.click({ force: true, timeout: 5000 });
  });
  log(`Bouton Valider du catalogue ${fieldLabel} clique.`);

  const popupClosedDeadline = Date.now() + 20000;
  while (Date.now() < popupClosedDeadline) {
    const visibleSearch = await firstVisible(context, [
      (frame) => frame.locator('input#eTxtSrch.eTxtSrch'),
    ]);
    if (!visibleSearch) break;
    await activePage.waitForTimeout(300);
  }
  const popupStillVisible = await firstVisible(context, [
    (frame) => frame.locator('input#eTxtSrch.eTxtSrch'),
  ]);
  if (popupStillVisible) {
    throw new Error(`Le catalogue ${fieldLabel} est toujours visible apres validation.`);
  }

  await fieldInput.waitFor({ state: 'visible', timeout: 10000 });
  const finalValue = (await fieldInput.inputValue()).trim().replace(/\s+/g, ' ');
  if (normalize(finalValue) !== normalize(expectedValue)) {
    throw new Error(
      `${fieldLabel} incorrect apres validation: "${finalValue}".`
    );
  }
  log(`Champ ${fieldLabel} alimente et verifie: ${finalValue}`);
}

async function saveAndVerifyCandidature(context, contact, expected, countBefore) {
  const save = await waitForVisible(context, [
    (frame) => frame.locator('div#save[ednmodalbtn="1"]'),
    (frame) => frame.locator('#save-mid').filter({ hasText: /^Valider$/i }),
  ], 'Bouton Valider de la fiche Candidature');
  await save.locator.click({ timeout: 10000 });
  log('Bouton Valider de la fiche Candidature clique.');

  await verifyContactProfile(context, contact);
  log('Retour a la fiche Contact confirme apres creation de la candidature.');
  await openBookmarks(context);

  const deadline = Date.now() + 60000;
  let matchingRow = null;
  let candidatureCountAfter = 0;
  while (!matchingRow && Date.now() < deadline) {
    const card = await findBookmarkCard(context, 'Candidatures').catch(() => null);
    if (card) {
      const rows = card.card.locator('tbody.tbody_asso tr[role="row"]');
      candidatureCountAfter = await rows.count().catch(() => 0);
      for (let index = 0; index < candidatureCountAfter; index += 1) {
        const row = rows.nth(index);
        const text = (await row.innerText().catch(() => ''))
          .trim()
          .replace(/\s+/g, ' ');
        if (
          normalize(text).includes(normalize(expected.sessionRentree))
          && normalize(text).includes(normalize(expected.cycle))
          && normalize(text).includes(normalize(expected.statut))
          && normalize(text).includes(normalize(expected.etape))
          && normalize(text).includes(normalize(contact.nomContact))
        ) {
          matchingRow = row;
          break;
        }
      }
    }
    if (!matchingRow) await activePage.waitForTimeout(1000);
  }

  if (!matchingRow) {
    throw new Error(
      `Candidature creee introuvable dans la fiche Contact `
      + `(avant=${countBefore}, apres=${candidatureCountAfter}).`
    );
  }
  if (candidatureCountAfter <= countBefore) {
    throw new Error(
      `Aucune nouvelle ligne Candidature detectee `
      + `(avant=${countBefore}, apres=${candidatureCountAfter}).`
    );
  }

  const rowDetails = await matchingRow.evaluate((element) => ({
    dataref: element.getAttribute('dataref') || '',
    text: String(element.textContent || '').trim().replace(/\s+/g, ' '),
    fileId: element.querySelector('[fileid]')?.getAttribute('fileid') || '',
  }));
  log(`Candidature creee et verifiee: ${JSON.stringify(rowDetails)}`);
  log(`Candidatures presentes apres creation: ${candidatureCountAfter}`);
}

async function verifyIdentificationOnContact(context, contact, countBefore = null) {
  const deadline = Date.now() + 60000;
  let matchingRow = null;
  let identificationCountAfter = 0;
  let visibleRows = [];
  while (!matchingRow && Date.now() < deadline) {
    const card = await findBookmarkCard(context, 'Identification').catch(() => null);
    if (card) {
      const rows = card.card.locator('tbody.tbody_asso tr[role="row"]');
      identificationCountAfter = await rows.count().catch(() => 0);
      visibleRows = [];
      for (let index = 0; index < identificationCountAfter; index += 1) {
        const row = rows.nth(index);
        const text = (await row.innerText().catch(() => ''))
          .trim()
          .replace(/\s+/g, ' ');
        visibleRows.push(text);
        if (
          normalize(text).includes(normalize(contact.nomContact))
          && normalize(text).includes(normalize(contact.prenom))
        ) {
          matchingRow = row;
          break;
        }
      }

      const countConfirmsCreation = countBefore !== null
        && identificationCountAfter > countBefore;
      if (!matchingRow && identificationCountAfter > 0 && (countBefore === null || countConfirmsCreation)) {
        matchingRow = rows.last();
        log(
          'Identification confirmee par le compteur de la carte '
          + `(avant=${countBefore ?? 'non mesure'}, apres=${identificationCountAfter}).`
        );
      }
    }
    if (!matchingRow) await activePage.waitForTimeout(1000);
  }

  if (!matchingRow) {
    throw new Error(
      `Identification introuvable dans la fiche Contact `
      + `(avant=${countBefore ?? 'non mesure'}, apres=${identificationCountAfter}, `
      + `lignes=${JSON.stringify(visibleRows)}).`
    );
  }
  if (countBefore !== null && identificationCountAfter <= countBefore) {
    throw new Error(
      `Aucune nouvelle ligne Identification detectee `
      + `(avant=${countBefore}, apres=${identificationCountAfter}).`
    );
  }

  const rowDetails = await matchingRow.evaluate((element) => ({
    dataref: element.getAttribute('dataref') || '',
    text: String(element.textContent || '').trim().replace(/\s+/g, ' '),
    fileId: element.querySelector('[fileid]')?.getAttribute('fileid') || '',
  }));
  log(`Identification presente et verifiee: ${JSON.stringify(rowDetails)}`);
  log(`Identifications presentes sur la fiche Contact: ${identificationCountAfter}`);
  return rowDetails;
}

async function saveAndVerifyIdentification(context, contact, countBefore) {
  const save = await waitForVisible(context, [
    (frame) => frame.locator('div#save[ednmodalbtn="1"]'),
    (frame) => frame.locator('#save-mid').filter({ hasText: /^Valider$/i }),
  ], 'Bouton Valider de la fiche Identification');
  await save.locator.click({ timeout: 10000 });
  log('Bouton Valider de la fiche Identification clique.');

  await verifyContactProfile(context, contact);
  log('Retour a la fiche Contact confirme apres creation de l Identification.');
  await openBookmarks(context);
  await verifyIdentificationOnContact(context, contact, countBefore);
}

async function takeScreenshot(page, targetPath = screenshotPath) {
  await page.bringToFront().catch(() => null);
  await page.screenshot({ path: targetPath, fullPage: true }).catch(async () => {
    await page.screenshot({ path: targetPath });
  });
  log(`Capture enregistree: ${targetPath}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(sessionPath)) throw new Error(`Session introuvable: ${sessionPath}`);
  if (!fs.existsSync(options.contactPath)) {
    throw new Error(`Donnees du contact introuvables: ${options.contactPath}`);
  }

  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(logPath, '', 'utf8');
  const contact = JSON.parse(fs.readFileSync(options.contactPath, 'utf8').replace(/^\uFEFF/, ''));
  if (!contact.nomContact || !contact.prenom) {
    throw new Error('Les donnees doivent contenir nomContact et prenom.');
  }
  const sessionRentree = String(contact.sessionRentree || defaultSessionRentree).trim();
  const cycle = String(contact.cycle || defaultCycle).trim();
  const statut = String(contact.statut || defaultStatut).trim();
  const etape = String(contact.etape || defaultEtape).trim();
  const ecoleInseec = String(contact.ecoleInseec || defaultEcoleInseec).trim();
  if (!sessionRentree) {
    throw new Error('La donnee sessionRentree est obligatoire.');
  }
  if (!cycle) throw new Error('La donnee cycle est obligatoire.');
  if (!statut) throw new Error('La donnee statut est obligatoire.');
  if (!etape) throw new Error('La donnee etape est obligatoire.');
  if (!ecoleInseec) throw new Error('La donnee ecoleInseec est obligatoire.');

  log(`Contact cible: ${contact.nomContact} ${contact.prenom}`);
  log(`Session de rentree cible: ${sessionRentree}`);
  log(`Cycle cible: ${cycle}`);
  log(`Statut cible: ${statut}`);
  log(`Etape cible: ${etape}`);
  log(`Ecole INSEEC cible: ${ecoleInseec}`);
  log(
    options.identificationCheckOnly
      ? 'Mode: verification seule de la fiche Identification'
      : options.identificationOnly
        ? 'Mode: ouverture de la fiche Identification'
        : `Mode candidature: ${options.submit ? 'creation avec validation' : 'saisie sans validation'}`
  );
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

  await searchAndOpenContact(context, contact);
  await verifyContactProfile(context, contact);
  await openBookmarks(context);
  if (options.identificationCheckOnly) {
    await verifyIdentificationOnContact(context, contact);
    await takeScreenshot(activePage, identificationScreenshotPath);
    if (options.keepOpenMs > 0) {
      log(`Navigateur conserve ouvert pendant ${Math.round(options.keepOpenMs / 1000)} secondes.`);
      await activePage.waitForTimeout(options.keepOpenMs);
    }
    await browser.close();
    return;
  }
  if (options.identificationOnly) {
    const identification = await openNewIdentification(context, contact, ecoleInseec);
    if (options.identificationSubmit) {
      await saveAndVerifyIdentification(
        context,
        contact,
        identification.identificationCountBefore
      );
    }
    await takeScreenshot(activePage, identificationScreenshotPath);
    if (options.keepOpenMs > 0) {
      log(`Navigateur conserve ouvert pendant ${Math.round(options.keepOpenMs / 1000)} secondes.`);
      await activePage.waitForTimeout(options.keepOpenMs);
    }
    await browser.close();
    return;
  }

  const candidature = await openNewCandidature(context);
  await selectSessionRentree(context, candidature.sessionInput, sessionRentree);
  await selectAdvancedCatalogValue(context, candidature.cycleInput, 'Cycle', cycle);
  await selectAdvancedCatalogValue(context, candidature.statutInput, 'Statut', statut);
  await selectAdvancedCatalogValue(context, candidature.etapeInput, 'Etape', etape);
  if (options.submit) {
    await saveAndVerifyCandidature(
      context,
      contact,
      { sessionRentree, cycle, statut, etape },
      candidature.candidatureCountBefore
    );
  }
  await takeScreenshot(activePage);

  if (options.keepOpenMs > 0) {
    log(`Navigateur conserve ouvert pendant ${Math.round(options.keepOpenMs / 1000)} secondes.`);
    await activePage.waitForTimeout(options.keepOpenMs);
  }
  await browser.close();
}

main().catch(async (error) => {
  log(`ERREUR: ${error.message || error}`);
  if (activePage && !activePage.isClosed()) await takeScreenshot(activePage).catch(() => null);
  if (browser) await browser.close().catch(() => null);
  process.exitCode = 1;
});
