const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SESSION_PATH = path.resolve(__dirname, '../../authentification/agate-session.json');
const AGATE_URL = process.env.AGATE_URL || 'https://agate.rec.omneseducation.com/admin/felix/candidat/';
const AGATE_HOST = new URL(AGATE_URL).hostname;
const BROWSER_CHANNEL = String(process.env.PW_CHANNEL || 'chrome').trim();

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

async function waitForAgateReady(context) {
  console.log('En attente de la connexion Agate/FELIX...');
  console.log('(Connectez-vous via la fenetre du navigateur qui vient de s ouvrir)');

  const deadline = Date.now() + 300000;
  while (Date.now() < deadline) {
    for (const currentPage of context.pages()) {
      if (currentPage.isClosed()) continue;
      let currentUrl;
      try {
        currentUrl = new URL(currentPage.url());
      } catch {
        continue;
      }
      const sameHost = currentUrl.hostname === AGATE_HOST;
      const loginPage = /login|oauth|authorize|sso|microsoftonline/i.test(currentPage.url());
      const text = await currentPage.locator('body').innerText({ timeout: 3000 }).catch(() => '');
      const errorPage = /code erreur\s*:\s*404|oops|not found/i.test(text);
      const appPage = /felix|candidat|dossier|inscription|administratif|agate/i.test(text);
      if (sameHost && !loginPage && !errorPage && appPage) {
        await currentPage.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
        await currentPage.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
        return;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error('Connexion Agate/FELIX non detectee apres 5 minutes.');
}

async function main() {
  ensureDir(path.dirname(SESSION_PATH));

  console.log('');
  console.log('=== Sauvegarde de session Agate/FELIX ===');
  console.log(`URL : ${AGATE_URL}`);
  console.log(`Fichier session : ${SESSION_PATH}`);
  console.log(`Navigateur : ${BROWSER_CHANNEL || 'chromium'}`);
  console.log('');
  console.log('Le navigateur va s ouvrir. Connectez-vous normalement via le SSO.');
  console.log('La session sera sauvegardee automatiquement une fois Agate/FELIX ouvert.');
  console.log('');

  const browser = await chromium.launch({
    headless: false,
    slowMo: 0,
    channel: BROWSER_CHANNEL || undefined,
  });

  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(AGATE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

  await waitForAgateReady(context);
  await context.storageState({ path: SESSION_PATH });

  console.log('');
  console.log('[OK] Session Agate sauvegardee.');
  console.log(`Fichier : ${SESSION_PATH}`);
  console.log('');
  console.log('Vous pouvez fermer le navigateur ou il sera ferme dans 3 secondes.');

  await new Promise((resolve) => setTimeout(resolve, 3000));
  await browser.close();
}

main().catch((error) => {
  console.error('Erreur lors de la sauvegarde de session Agate :', error.message);
  process.exit(1);
});
