const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { loadConfig } = require('./config');

const projectRoot = path.resolve(__dirname, '..');
const authRoot = path.join(projectRoot, '.auth', 'squash');
const config = loadConfig();
const squashUrl = config.SQUASH_BASE_URL || 'https://saas-inseec01.henix.com/squash';
const loginUrl = `${squashUrl.replace(/\/$/, '')}/login`;

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

async function main() {
  ensureDir(authRoot);

  const context = await chromium.launchPersistentContext(authRoot, {
    headless: false,
    viewport: null,
    channel: process.env.PW_CHANNEL || undefined,
  });

  const page = context.pages()[0] || await context.newPage();
  await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

  console.log('[INFO] Navigateur ouvert pour la connexion Squash.');
  console.log('[INFO] Tentative de connexion automatique si les identifiants sont configures.');
  console.log('[INFO] Le script attend une session Squash valide cote backend.');

  async function backendOk() {
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
      if (await submit.count().catch(() => 0)) await submit.click({ force: true }).catch(() => null);
      else await passwordInput.press('Enter').catch(() => null);
    }
    await page.waitForTimeout(3000);
    return backendOk();
  }

  if (!(await backendOk()) && !(await tryAutoLogin())) {
    console.log('[ACTION] Connexion automatique non confirmee. Connecte-toi manuellement si la page reste sur login.');
  }

  const startedAt = Date.now();
  const timeoutMs = Number(config.SQUASH_LOGIN_TIMEOUT_MS || 10 * 60 * 1000);

  while (Date.now() - startedAt < timeoutMs) {
    await page.waitForTimeout(2000);
    const currentUrl = page.url();
    const title = await page.title().catch(() => '');
    const bodyText = await page.locator('body').innerText({ timeout: 1000 }).catch(() => '');
    const stillLogin = /\/login/i.test(currentUrl) || /connexion|login|mot de passe|password/i.test(bodyText);
    const isBackendOk = await backendOk();

    console.log(`[WAIT] backend=${isBackendOk ? 'OK' : 'KO'} title="${title}" url="${currentUrl.slice(0, 140)}"`);

    if (/saas-inseec01\.henix\.com\/squash/i.test(currentUrl) && !stillLogin && isBackendOk) {
      console.log('[OK] Session Squash detectee. Le profil Playwright persistant est conserve localement.');
      await context.storageState({ path: path.join(authRoot, 'storage-state.json') }).catch(() => null);
      await context.close();
      return;
    }
  }

  console.log('[TIMEOUT] Connexion Squash non confirmee dans le delai. Le profil local est conserve pour reprendre.');
  await context.close();
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
