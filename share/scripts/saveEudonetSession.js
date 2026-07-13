const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SESSION_PATH = path.resolve(__dirname, '../../authentification/eudonet-session.json');
const EUDONET_URL = process.env.EUDONET_URL || 'https://test-omnes.eudonet.com/recette';
const EUDONET_HOST = new URL(EUDONET_URL).hostname;
const BROWSER_CHANNEL = String(process.env.PW_CHANNEL || 'chrome').trim();

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

async function waitForEudonetReady(context) {
  console.log('En attente de la connexion Eudonet...');
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
      if (currentUrl.hostname === EUDONET_HOST && /\/app\/eMain\.aspx$/i.test(currentUrl.pathname)) {
        await currentPage.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
        return;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error('Connexion Eudonet non detectee apres 5 minutes.');
  // Attendre l'application, et non la page intermediaire précédant le SSO.
}

async function main() {
  ensureDir(path.dirname(SESSION_PATH));

  console.log('');
  console.log('=== Sauvegarde de session Eudonet ===');
  console.log(`URL : ${EUDONET_URL}`);
  console.log(`Fichier session : ${SESSION_PATH}`);
  console.log(`Navigateur : ${BROWSER_CHANNEL || 'chromium'}`);
  console.log('');
  console.log('Le navigateur va s ouvrir. Connectez-vous normalement via le SSO Microsoft.');
  console.log('La session sera sauvegardee automatiquement une fois connecte.');
  console.log('');

  const browser = await chromium.launch({
    headless: false,
    slowMo: 0,
    channel: BROWSER_CHANNEL || undefined,
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(EUDONET_URL);

  await waitForEudonetReady(context);

  await context.storageState({ path: SESSION_PATH });

  console.log('');
  console.log('[OK] Session sauvegardee.');
  console.log(`Fichier : ${SESSION_PATH}`);
  console.log('');
  console.log('Vous pouvez fermer le navigateur ou il sera ferme dans 3 secondes.');

  await new Promise((resolve) => setTimeout(resolve, 3000));
  await browser.close();
}

main().catch((error) => {
  console.error('Erreur lors de la sauvegarde de session :', error.message);
  process.exit(1);
});
