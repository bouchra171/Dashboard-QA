const fs = require('fs');
const path = require('path');

const { projectRoot } = require('../../agent/config');
const { runNewform } = require('../../apps/newform/newformRunner');
const { runEudonet } = require('../../apps/eudonet/eudonetRunner');

function nowStamp(date = new Date()) {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

async function main() {
  const stamp = nowStamp();
  const processDir = path.join(projectRoot, 'authentification', 'process', `newform-eudonet-${stamp}`);
  const contextPath = path.join(processDir, 'candidate-context.json');
  fs.mkdirSync(processDir, { recursive: true });

  const executionPlan = {
    scenarioId: `newform-eudonet-${stamp}`,
    scenarioName: 'Newform Page Informations puis mise a jour Eudonet',
    campaignName: 'Parcours Newform Eudonet',
    target: {
      application: 'eudonet',
      apps: ['newform', 'eudonet'],
      schoolLabel: 'INSEEC Bachelor',
      schoolSlug: 'bachelorsinseec',
      candidateType: 'standard',
      expectedPayment: false,
      stopAfterPage: 1,
      candidateAge: 20,
      page1: {
        session: 'Septembre / Octobre 2026',
        campus: 'Paris',
        niveau_admission: 'Bachelor 1ere annee',
        programme: 'Banque Assurance - Resp en gestion financière',
      },
      eudonet: {
        initialStatut: '01. Candidat en cours',
        initialEtape: '2. Parcours & PJ',
        targetStatut: '04. Admis - Inscription en attente de paiement',
        targetEtape: 'Inscription',
      },
    },
  };

  const report = {
    startedAt: new Date().toISOString(),
    contextPath: path.relative(projectRoot, contextPath).replace(/\\/g, '/'),
    steps: [],
  };

  console.log('[PROCESS] Etape 1/2 - Newform Page Informations');
  const newformResult = await runNewform(executionPlan, { contextPath });
  report.steps.push(newformResult);
  if (newformResult.status !== 'OK') {
    throw new Error(`Echec Newform: ${newformResult.error || newformResult.lastStep}`);
  }

  console.log('[PROCESS] Etape 2/2 - Mise a jour Candidature Eudonet');
  const eudonetResult = await runEudonet(executionPlan, { contextPath });
  report.steps.push(eudonetResult);
  if (eudonetResult.status !== 'OK') {
    throw new Error(`Echec Eudonet: ${eudonetResult.error || eudonetResult.lastStep}`);
  }

  report.success = true;
  report.finishedAt = new Date().toISOString();
  const reportPath = path.join(processDir, 'process-result.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`[PROCESS] Parcours termine: ${reportPath}`);
}

main().catch((error) => {
  console.error(`[PROCESS][ERREUR] ${error.message || error}`);
  process.exitCode = 1;
});
