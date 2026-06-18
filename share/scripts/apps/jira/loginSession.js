const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const projectRoot = path.resolve(__dirname, '../../..');
const authRoot = path.resolve(projectRoot, '..', '.auth', 'jira');
const jiraBaseUrl = (process.env.JIRA_BASE_URL || 'https://inseec-transfo-si.atlassian.net').replace(/\/$/, '');
const jiraUrl = process.env.JIRA_LOGIN_URL || `${jiraBaseUrl}/jira/for-you?tab=assigned`;

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

async function main() {
  ensureDir(authRoot);

  const context = await chromium.launchPersistentContext(authRoot, {
    headless: false,
    viewport: null,
    ignoreHTTPSErrors: true,
    channel: process.env.PW_CHANNEL || undefined,
  });

  const page = context.pages()[0] || await context.newPage();
  await page.goto(jiraUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

  console.log('[INFO] Navigateur ouvert pour la connexion Jira.');
  console.log('[ACTION] Connecte-toi manuellement avec ton compte Atlassian/Microsoft, puis laisse la page ouverte.');
  console.log('[INFO] La session sera conservee localement dans .auth/jira.');

  const startedAt = Date.now();
  const timeoutMs = Number(process.env.JIRA_LOGIN_TIMEOUT_MS || 10 * 60 * 1000);

  while (Date.now() - startedAt < timeoutMs) {
    await page.waitForTimeout(2000);
    const currentUrl = page.url();
    const title = await page.title().catch(() => '');
    const bodyText = await page.locator('body').innerText({ timeout: 1000 }).catch(() => '');
    const onJira = /atlassian\.net/i.test(currentUrl);
    const loginPage = /login|id\.atlassian|microsoftonline/i.test(currentUrl) || /log in|connexion|sign in/i.test(bodyText);
    const usable = onJira && !loginPage && /jira|your work|assigned|projet|project/i.test(`${title} ${bodyText}`);

    console.log(`[WAIT] title="${title}" url="${currentUrl.slice(0, 140)}"`);

    if (usable) {
      await page.goto(jiraUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => null);
      await page.waitForTimeout(1500).catch(() => null);
      await context.storageState({ path: path.join(authRoot, 'storage-state.json') }).catch(() => null);
      console.log('[OK] Session Jira detectee et sauvegardee dans .auth/jira.');
      await context.close();
      return;
    }
  }

  console.log('[TIMEOUT] Connexion Jira non confirmee dans le delai. Le profil local est conserve pour reprendre.');
  await context.storageState({ path: path.join(authRoot, 'storage-state.json') }).catch(() => null);
  await context.close();
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
