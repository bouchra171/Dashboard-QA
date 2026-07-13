const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const projectRoot = path.resolve(__dirname, '../..');
const sessionPath = path.join(projectRoot, 'authentification', 'eudonet-session.json');
const contactPath = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : path.join(projectRoot, 'authentification', 'eudonet-contact-data-used.json');
const reportPath = path.join(projectRoot, 'authentification', 'eudonet-legacy-tabs-check.json');
const screenshotDir = path.join(projectRoot, 'authentification', 'eudonet-tabs');
const eudonetUrl = process.env.EUDONET_URL || 'https://test-omnes.eudonet.com/recette';
const browserChannel = String(process.env.PW_CHANNEL || 'chrome').trim();
const browserWidth = Number(process.env.EUDONET_BROWSER_WIDTH || 1400);
const browserHeight = Number(process.env.EUDONET_BROWSER_HEIGHT || 900);
let activePage;
let activeBrowser;

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function loadContact() {
  if (!fs.existsSync(contactPath)) {
    throw new Error(`Fichier contact introuvable: ${contactPath}`);
  }
  return JSON.parse(fs.readFileSync(contactPath, 'utf8'));
}

async function findVisibleFrame(page, selector) {
  for (const frame of page.frames().slice().reverse()) {
    const locator = frame.locator(selector).first();
    if (
      await locator.count().catch(() => 0)
      && await locator.isVisible().catch(() => false)
    ) {
      return { frame, locator };
    }
  }
  return null;
}

async function findVisibleAny(page, factories) {
  for (const frame of page.frames().slice().reverse()) {
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

async function searchContact(page, contact) {
  const contacts = await findVisibleAny(page, [
    (frame) => frame.locator('#tab_header_200'),
    (frame) => frame.getByText(/^Contacts$/i),
  ]);
  if (!contacts) throw new Error('Menu Contacts introuvable.');
  await contacts.locator.hover({ timeout: 5000 });

  let search = null;
  const searchDeadline = Date.now() + 10000;
  while (!search && Date.now() < searchDeadline) {
    search = await findVisibleAny(page, [
      (frame) => frame.locator('input.Lnk_srch-inpt, input.lnk_srch-inpt'),
      (frame) => frame.locator('input[type="text"], input').filter({ hasNotText: /^$/ }),
      (frame) => frame.locator('input').first(),
    ]);
    if (!search) await page.waitForTimeout(300);
  }
  const query = `${contact.nomContact} ${contact.prenom}`;
  if (search) {
    await search.locator.fill(query);
    log(`Recherche contact: ${query}`);
  } else {
    log('Champ de recherche Contacts non detecte, saisie clavier dans le menu visible.');
    await page.mouse.click(170, 95);
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await page.keyboard.type(query, { delay: 20 });
  }

  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    for (const frame of page.frames().slice().reverse()) {
      const rows = frame.locator('li.navLst[id]');
      const count = await rows.count().catch(() => 0);
      for (let index = 0; index < count; index += 1) {
        const row = rows.nth(index);
        if (!await row.isVisible().catch(() => false)) continue;
        const text = await row.innerText().catch(() => '');
        if (
          normalize(text).includes(normalize(contact.nomContact))
          && normalize(text).includes(normalize(contact.prenom))
        ) {
          log(`Contact trouve: ${text.trim().replace(/\s+/g, ' ')}`);
          await row.click({ timeout: 10000 });
          await page.waitForTimeout(1500);
          return;
        }
      }
    }
    await page.waitForTimeout(400);
  }
  throw new Error(`Contact introuvable: ${query}`);
}

async function clickLegacyTab(page, tabName) {
  for (const frame of page.frames().slice().reverse()) {
    const clicked = await frame.evaluate((name) => {
      const normalizeText = (value) => String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase();
      const visible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0
          && rect.height > 0
          && style.display !== 'none'
          && style.visibility !== 'hidden';
      };
      const expected = normalizeText(name);
      const target = Array.from(document.querySelectorAll('*'))
        .filter((element) => {
          if (!visible(element)) return false;
          const text = normalizeText(element.textContent);
          return text === expected || text.includes(expected);
        })
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.top > 300 && rect.top < 390;
        })
        .sort((left, right) => {
          const leftRect = left.getBoundingClientRect();
          const rightRect = right.getBoundingClientRect();
          return (leftRect.width - rightRect.width)
            || (normalizeText(left.textContent).length - normalizeText(right.textContent).length)
            || (leftRect.left - rightRect.left);
        })[0];
      const clickable = target?.closest?.('a, button, li, div, span, [onclick]') || target;
      if (!clickable) return false;
      clickable.click();
      return true;
    }, tabName).catch(() => false);
    if (clicked) {
      await page.waitForTimeout(900);
      return true;
    }
  }
  return false;
}

async function inspectVisibleYellowFields(page) {
  for (const frame of page.frames().slice().reverse()) {
    const fields = await frame.evaluate(() => {
      const visible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0
          && rect.height > 0
          && style.display !== 'none'
          && style.visibility !== 'hidden'
          && rect.top >= 0
          && rect.top <= window.innerHeight;
      };
      const isYellow = (element) => {
        const style = window.getComputedStyle(element);
        const bg = style.backgroundColor || '';
        return bg.includes('255, 255, 0') || bg.includes('rgb(255 255 0)');
      };
      const labelFor = (element) => {
        const row = element.closest('tr');
        const cells = row ? Array.from(row.querySelectorAll('td, th')) : [];
        const ownCell = element.closest('td, th');
        const ownIndex = cells.indexOf(ownCell);
        const before = ownIndex > 0
          ? cells.slice(Math.max(0, ownIndex - 2), ownIndex).map((cell) => cell.textContent).join(' ')
          : '';
        const near = before || element.getAttribute('title') || element.getAttribute('name') || element.id || '';
        return String(near).trim().replace(/\s+/g, ' ');
      };
      return Array.from(document.querySelectorAll('input, textarea, select'))
        .filter((element) => visible(element) && isYellow(element))
        .map((element) => ({
          label: labelFor(element),
          id: element.id || '',
          name: element.getAttribute('name') || '',
          value: String(element.value || element.getAttribute('title') || '').trim(),
        }))
        .filter((field, index, list) => (
          list.findIndex((other) => (other.id || other.name) === (field.id || field.name)) === index
        ));
    }).catch(() => []);
    if (fields.length) return fields;
  }
  return [];
}

async function main() {
  const contact = loadContact();
  fs.mkdirSync(screenshotDir, { recursive: true });

  const browser = await chromium.launch({
    headless: String(process.env.EUDONET_HEADLESS || '') === '1',
    channel: browserChannel || undefined,
    slowMo: Number(process.env.SLOW_MO_MS || 80),
    args: [`--window-size=${browserWidth},${browserHeight}`],
  });
  activeBrowser = browser;
  const context = await browser.newContext({
    storageState: sessionPath,
    viewport: { width: browserWidth, height: browserHeight },
    screen: { width: browserWidth, height: browserHeight },
  });
  const page = await context.newPage();
  activePage = page;
  await page.goto(eudonetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => null);
  await searchContact(page, contact);

  const tabs = [
    'TOUS',
    'Adresses',
    'Demandes entrantes',
    'Candidatures',
    'Inscrits/Présents',
    'Parcours scolaire',
    'Identification',
  ];
  const report = [];
  for (const tab of tabs) {
    const opened = await clickLegacyTab(page, tab);
    const fields = opened ? await inspectVisibleYellowFields(page) : [];
    const screenshotName = `${tab.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w-]+/g, '_')}.png`;
    await page.screenshot({ path: path.join(screenshotDir, screenshotName), fullPage: true }).catch(() => null);
    report.push({
      tab,
      opened,
      yellowFields: fields,
      emptyYellowFields: fields.filter((field) => !field.value),
      screenshot: path.join(screenshotDir, screenshotName),
    });
    log(`${tab}: ${opened ? 'ouvert' : 'introuvable'} - champs jaunes vides: ${fields.filter((field) => !field.value).length}`);
  }

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  log(`Rapport enregistre: ${reportPath}`);
  await browser.close();
}

main().catch(async (error) => {
  try {
    fs.mkdirSync(screenshotDir, { recursive: true });
    if (activePage) {
      await activePage.screenshot({
        path: path.join(screenshotDir, 'error.png'),
        fullPage: true,
      });
    }
    if (activeBrowser) await activeBrowser.close();
  } catch {
    // ignore
  }
  console.error(`[${new Date().toISOString()}] ERREUR: ${error.message || error}`);
  process.exitCode = 1;
});
