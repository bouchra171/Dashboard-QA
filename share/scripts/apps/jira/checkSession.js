const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const projectRoot = path.resolve(__dirname, '../../..');
const authRoot = path.resolve(projectRoot, '..', '.auth', 'jira');
const storageStatePath = path.join(authRoot, 'storage-state.json');
const jiraBaseUrl = (process.env.JIRA_BASE_URL || 'https://inseec-transfo-si.atlassian.net').replace(/\/$/, '');

async function main() {
  if (!fs.existsSync(authRoot)) {
    console.log(JSON.stringify({ connected: false, error: 'Aucune session Jira locale.' }));
    process.exitCode = 1;
    return;
  }

  const context = await chromium.launchPersistentContext(authRoot, {
    headless: true,
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
    channel: process.env.PW_CHANNEL || undefined,
  });

  try {
    const page = context.pages()[0] || await context.newPage();
    await page.goto(`${jiraBaseUrl}/jira/for-you?tab=assigned`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2500);
    const currentUrl = page.url();
    const title = await page.title().catch(() => '');
    const bodyText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
    const connected = /atlassian\.net/i.test(currentUrl)
      && !/id\.atlassian|login|microsoftonline/i.test(currentUrl)
      && !/log in|sign in|connexion/i.test(bodyText);

    await context.storageState({ path: storageStatePath }).catch(() => null);
    console.log(JSON.stringify({
      connected,
      title,
      url: currentUrl,
      storageStatePath,
      error: connected ? '' : 'Session Jira non connectee ou expiree.',
    }));
    process.exitCode = connected ? 0 : 1;
  } finally {
    await context.close().catch(() => null);
  }
}

main().catch((error) => {
  console.log(JSON.stringify({ connected: false, error: error.message || String(error) }));
  process.exitCode = 1;
});
