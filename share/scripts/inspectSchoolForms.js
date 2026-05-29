const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const { getCampaign } = require('./campaignConfig');
const { acceptCookiesIfBlocking, fixMojibake } = require('./utils/helpers');

const projectRoot = path.resolve(__dirname, '..');
const reportsRoot = path.join(projectRoot, 'reports', 'structure-inspection');

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

function uniqueSorted(values) {
  return Array.from(new Set((values || []).filter(Boolean))).sort((left, right) => left.localeCompare(right, 'fr'));
}

async function capture(page, filePath) {
  try {
    await page.screenshot({ path: filePath, fullPage: true, animations: 'disabled' });
  } catch {
    try {
      await page.screenshot({ path: filePath, fullPage: false });
    } catch {
      // ignore
    }
  }
}

async function collectLandingSnapshot(page) {
  return page.evaluate(() => {
    const norm = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const isVisible = (node) => {
      if (!node) return false;
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style && style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };

    const readTexts = (selector, limit = 40) => Array.from(document.querySelectorAll(selector))
      .filter((node) => isVisible(node))
      .map((node) => norm(node.innerText || node.textContent || node.value || ''))
      .filter(Boolean)
      .slice(0, limit);

    const headings = readTexts('h1, h2, h3');
    const buttons = readTexts('button, a, [role="button"], input[type="button"], input[type="submit"]', 60);
    const badges = readTexts('aside, nav, .sidebar, .hero, .banner, .card', 40);
    const bodyExcerpt = norm(document.body?.innerText || '').slice(0, 1800);

    return {
      title: document.title || '',
      headings,
      buttons,
      badges,
      bodyExcerpt,
    };
  });
}

async function clickStartVariant(page) {
  const patterns = [
    /D.marrer une nouvelle candidature/i,
    /Demarrer une nouvelle candidature/i,
    /Commencer/i,
    /Nouvelle candidature/i,
    /Postuler/i,
    /Candidater/i,
    /Apply/i,
    /Start/i,
  ];

  for (const pattern of patterns) {
    try {
      const byRole = page.getByRole('button', { name: pattern }).first();
      if (await byRole.count()) {
        await byRole.click({ force: true });
        return pattern.source;
      }
    } catch {
      // ignore
    }

    try {
      const generic = page.locator('button, a, [role="button"], input[type="button"], input[type="submit"]').filter({ hasText: pattern }).first();
      if (await generic.count()) {
        await generic.click({ force: true });
        return pattern.source;
      }
    } catch {
      // ignore
    }
  }

  return '';
}

async function collectFormStructure(page) {
  return page.evaluate(() => {
    const norm = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const visible = (node) => {
      if (!node) return false;
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };

    const findLabel = (control) => {
      const id = control.getAttribute('id') || '';
      if (id) {
        const linked = document.querySelector(`label[for="${id}"]`);
        if (linked && visible(linked)) {
          const text = norm(linked.innerText || linked.textContent);
          if (text) return text;
        }
      }

      const wrapped = control.closest('label');
      if (wrapped && visible(wrapped)) {
        const text = norm(wrapped.innerText || wrapped.textContent);
        if (text) return text;
      }

      const container = control.closest('.form-group, .field, .rw-widget-container, .input-group, .form-floating, .row, .col, div, section');
      if (container) {
        const labelNode = container.querySelector('label, legend, .form-label, .field-label, .control-label, h3, h4, strong');
        if (labelNode && visible(labelNode)) {
          const text = norm(labelNode.innerText || labelNode.textContent);
          if (text) return text;
        }
      }

      return norm(control.getAttribute('aria-label') || control.getAttribute('placeholder') || control.getAttribute('name') || '');
    };

    const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
      .filter((node) => visible(node))
      .map((node) => norm(node.innerText || node.textContent))
      .filter(Boolean)
      .slice(0, 30);

    const stepLabels = Array.from(document.querySelectorAll('aside li, nav li, .stepper li, .steps li, .sidebar li, .progress li, aside a, nav a'))
      .filter((node) => visible(node))
      .map((node) => norm(node.innerText || node.textContent))
      .filter(Boolean)
      .slice(0, 30);

    const combos = Array.from(document.querySelectorAll('[role="combobox"], select, .rw-dropdown-list, .rw-combobox'))
      .filter((node) => visible(node))
      .map((node) => findLabel(node))
      .filter(Boolean);

    const textInputs = Array.from(document.querySelectorAll('input, textarea'))
      .filter((node) => visible(node))
      .filter((node) => {
        const type = (node.getAttribute('type') || '').toLowerCase();
        return !['hidden', 'checkbox', 'radio', 'submit', 'button'].includes(type);
      })
      .map((node) => findLabel(node))
      .filter(Boolean);

    const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"], input[type="radio"]'))
      .filter((node) => visible(node))
      .map((node) => findLabel(node))
      .filter(Boolean);

    const buttons = Array.from(document.querySelectorAll('button, a, [role="button"], input[type="submit"], input[type="button"]'))
      .filter((node) => visible(node))
      .map((node) => norm(node.innerText || node.textContent || node.value || ''))
      .filter(Boolean)
      .slice(0, 60);

    const markers = {
      sessionRentree: /session de rentr[ée]e/i.test(document.body?.innerText || ''),
      campus: /campus/i.test(document.body?.innerText || ''),
      programme: /programme/i.test(document.body?.innerText || ''),
      page2: /session d'admission|pi[eè]ces jointes|documents|niveau d[' ]etude/i.test(document.body?.innerText || ''),
      payment: /paiement|frais de candidature/i.test(document.body?.innerText || ''),
    };

    return {
      url: window.location.href,
      title: document.title || '',
      headings,
      stepLabels,
      comboboxLabels: combos,
      inputLabels: textInputs,
      checkboxLabels: checkboxes,
      actionLabels: buttons,
      markers,
      bodyExcerpt: norm(document.body?.innerText || '').slice(0, 2200),
    };
  });
}

async function inspectSchool(browser, school, targetDir) {
  const page = await browser.newPage();
  page.setDefaultTimeout(25000);
  const result = {
    slug: school.slug,
    label: school.label,
    url: school.url,
    journeyGroup: school.journeyGroup || '',
    landing: {},
    form: {},
    startAction: '',
    startSuccess: false,
    error: '',
  };

  const schoolPrefix = `${sanitizeName(school.slug)}-${nowStamp()}`;

  try {
    await page.goto(school.url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);
    await acceptCookiesIfBlocking(page, `inspect ${school.slug}`);
    await page.waitForTimeout(1200);

    result.landing = fixMojibake(await collectLandingSnapshot(page));
    await capture(page, path.join(targetDir, `${schoolPrefix}-landing.png`));

    result.startAction = await clickStartVariant(page);
    if (result.startAction) {
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await page.waitForTimeout(2500);
      await acceptCookiesIfBlocking(page, `inspect-start ${school.slug}`);
    }

    result.form = fixMojibake(await collectFormStructure(page));
    result.startSuccess = Boolean(result.form?.markers?.sessionRentree || result.form?.markers?.campus || result.form?.markers?.programme);
    await capture(page, path.join(targetDir, `${schoolPrefix}-form.png`));
  } catch (error) {
    result.error = String(error?.message || error);
    try {
      await capture(page, path.join(targetDir, `${schoolPrefix}-error.png`));
    } catch {
      // ignore
    }
  } finally {
    await page.close().catch(() => {});
  }

  return result;
}

async function main() {
  const campaign = getCampaign('tnr-front-recette');
  const stamp = nowStamp();
  const targetDir = path.join(reportsRoot, stamp);
  ensureDir(targetDir);

  const browser = await chromium.launch({ headless: true });
  const results = [];

  try {
    for (const school of campaign.schools) {
      console.log(`[INSPECT] ${school.label} (${school.slug})`);
      const snapshot = await inspectSchool(browser, school, targetDir);
      results.push(snapshot);
    }
  } finally {
    await browser.close().catch(() => {});
  }

  const summary = {
    inspectedAt: new Date().toISOString(),
    campaignId: campaign.id,
    totalSchools: campaign.schools.length,
    results,
    quickView: results.map((item) => ({
      slug: item.slug,
      label: item.label,
      startSuccess: item.startSuccess,
      startAction: item.startAction,
      comboboxCount: item.form?.comboboxLabels?.length || 0,
      inputCount: item.form?.inputLabels?.length || 0,
      checkboxCount: item.form?.checkboxLabels?.length || 0,
      markers: item.form?.markers || {},
      error: item.error,
    })),
  };

  fs.writeFileSync(path.join(targetDir, 'inspection.json'), JSON.stringify(summary, null, 2), 'utf8');
  console.log(`[OK] Inspection enregistree dans ${path.relative(projectRoot, targetDir).replace(/\\/g, '/')}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
