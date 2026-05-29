const runParcoursSection = require('../sections/page2/parcours');
const runSessionSection = require('../sections/page2/session');
const runDocumentsSection = require('../sections/page2/documents');
const runPage2Checkboxes = require('../sections/page2/checkboxes');

const DOWNLOAD_REQUESTED_DOCUMENTS = process.env.DOWNLOAD_REQUESTED_DOCUMENTS === '1';

module.exports = async function runPage2(ctx) {
  const { page, data, p2, dataRoot, schoolProfile, helpers } = ctx;
  const {
    findSectionByText,
    selectDropdownByLabel,
    waitForComboboxReady,
    openCombobox,
    waitForOptions,
    chooseOptionFromList,
    fillInputByLabel,
    fillFieldsByLabel,
    logRequiredFields,
    clickNextAndWait,
    logValidationState,
    DEBUG_REQUIRED,
  } = helpers;

  console.log('\n?? Page 2/4 - Etudes');

  try {
    const readyPatterns = Array.isArray(schoolProfile?.page2?.readyTexts) && schoolProfile.page2.readyTexts.length
      ? schoolProfile.page2.readyTexts
      : [
          /ma candidature\s*2\s*\/\s*4/i,
          /my application\s*2\s*\/\s*4/i,
          /ma candidature\s*2\/4\s*:\s*etudes/i,
          /ma candidature\s*2\/4\s*:\s*ÃƒÂ©tudes/i,
          /my application\s*2\/4\s*:\s*studies/i,
        ];
    let page2Detected = false;
    for (const pattern of readyPatterns) {
      try {
        await page.getByText(pattern).first().waitFor({ timeout: 5000 });
        page2Detected = true;
        break;
      } catch {
        // try next marker
      }
    }
    if (!page2Detected) {
      throw new Error('Page 2 non detectee');
    }
    await page.waitForLoadState('networkidle').catch(() => {});
  } catch {
    await logValidationState(page, data.id, 'page-2-missing');
    throw new Error('Page 2 non detectee');
  }

  const sectionLabels = schoolProfile?.page2?.sectionLabels || {};
  const sectionParcours = await findSectionByText(page, sectionLabels.parcours || [/parcours/i]);
  const sectionSession = await findSectionByText(page, sectionLabels.session || [/session d'admission/i]);
  const sectionDocuments = await findSectionByText(page, sectionLabels.documents || [/documents?|pieces jointes/i]);

  const selectInSection = async (section, label, value) => {
    try {
      const ok = await selectDropdownByLabel(page, label, value);
      if (ok) return true;
      throw new Error('Selection non effectuee');
    } catch (err) {
      try {
        const dropdowns = section.locator('[role="combobox"]');
        const count = await dropdowns.count();
        if (count === 1) {
          const dropdown = dropdowns.first();
          await waitForComboboxReady(page, dropdown);
          await openCombobox(page, dropdown);
          const options = await waitForOptions(page, dropdown, 8000);
          if (options) {
            await chooseOptionFromList(page, options, value, label);
            return true;
          }
        }
      } catch {
        // ignore
      }
      console.log(`  [WARNING] Page 2/4: impossible de selectionner '${label}' => '${value}' : ${err.message || err}`);
      return false;
    }
  };

  const clickRequestedDownloads = async (section) => {
    if (!section) return;
    const openedPopups = [];

    if (!DOWNLOAD_REQUESTED_DOCUMENTS) {
      console.log('  [INFO] Documents demandes: telechargement automatique desactive');
      return openedPopups;
    }

    const normalize = (value) =>
      (value || '')
        .toString()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    try {
      const candidates = section
        .locator('button, a, [role="button"]')
        .filter({ hasText: /Télécharger|Telecharger|Download/i });

      const visibleTargets = [];
      const seenKeys = new Set();
      const count = await candidates.count();

      for (let i = 0; i < count; i += 1) {
        const node = candidates.nth(i);
        try {
          if (!(await node.isVisible())) continue;
          const box = await node.boundingBox();
          if (!box || box.width < 8 || box.height < 8) continue;
          const text = normalize(
            ((await node.innerText().catch(() => '')) || (await node.textContent().catch(() => '')) || '')
          );
          const key = [
            Math.round(box.x),
            Math.round(box.y),
            Math.round(box.width),
            Math.round(box.height),
            text,
          ].join(':');
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);
          visibleTargets.push(node);
        } catch {
          // ignore hidden or duplicate candidate
        }
      }

      console.log(`  [DEBUG] Documents demandes: ${visibleTargets.length} bouton(s) reels detectes`);

      for (let i = 0; i < visibleTargets.length; i += 1) {
        const node = visibleTargets[i];
        try {
          await node.scrollIntoViewIfNeeded().catch(() => {});
          console.log(`  [INFO] Document demande a telecharger -> clic ${i + 1}/${visibleTargets.length}`);
          const downloadPromise = page.waitForEvent('download', { timeout: 2000 }).catch(() => null);
          const popupPromise = page.waitForEvent('popup', { timeout: 2000 }).catch(() => null);
          await node.click({ force: true });
          const [download, popup] = await Promise.all([downloadPromise, popupPromise]);
          if (download) {
            console.log('  [INFO] Document telecharge');
          }
          if (popup) {
            try {
              await popup.waitForLoadState('load', { timeout: 4000 }).catch(() => {});
              await popup.waitForTimeout(1500).catch(() => {});
              openedPopups.push(popup);
              console.log('  [INFO] Onglet document laisse ouvert temporairement');
            } catch {
              // ignore
            }
          }
          await page.waitForTimeout(400);
        } catch (error) {
          console.log(`  [WARNING] Clic document demande ignore: ${error?.message || error}`);
        }
      }
    } catch (error) {
      console.log(`  [DEBUG] Documents demandes: bloc ignore (${error?.message || error})`);
    }
    return openedPopups;
  };

  const closeDocumentPopups = async (popups = []) => {
    for (const popup of popups) {
      try {
        if (!popup || popup.isClosed()) continue;
        await popup.close({ runBeforeUnload: true });
        console.log('  [INFO] Onglet document referme automatiquement');
      } catch {
        // ignore
      }
    }
  };

  const fillOtherInstitutionNameIfVisible = async () => {
    const value =
      p2?.nom_etablissement ||
      p2?.etablissement_nom ||
      p2?.current_school_name ||
      'Lycee Test Automation';
    const labels = [
      'Saisissez le nom de votre etablissement',
      'Saisissez le nom de votre établissement',
      'Nom de votre etablissement',
      'Nom de votre établissement',
    ];

    for (const label of labels) {
      try {
        await fillInputByLabel(page, label, value, { exact: false, strictLabel: false, verify: true });
        console.log(`  ✅ Nom etablissement actuel => "${value}"`);
        return true;
      } catch {
        // field absent for most schools
      }
    }
    return false;
  };

  await runParcoursSection({ page, sectionParcours, selectInSection, p2, schoolProfile, helpers });
  await fillOtherInstitutionNameIfVisible();
  await runSessionSection({ sectionSession, selectInSection, p2, page, schoolProfile, helpers });
  const documentPopups = await clickRequestedDownloads(sectionDocuments);
  await runDocumentsSection({ sectionDocuments, p2, dataRoot, helpers, page });

  await fillFieldsByLabel(page, p2.fields, 'Page 2/4');
  await fillOtherInstitutionNameIfVisible();
  if (DEBUG_REQUIRED) {
    await logRequiredFields(page, 'Page 2/4');
  }

  await runPage2Checkboxes({ helpers, page });
  await page.screenshot({ path: `reports/${data.id}-page2-filled.png`, fullPage: true });

  const page3ReadyTexts = Array.isArray(schoolProfile?.page2?.page3ReadyTexts) && schoolProfile.page2.page3ReadyTexts.length
    ? schoolProfile.page2.page3ReadyTexts
    : [/page\s*3\s*\/\s*4/i, /valider mes informations/i, /vous ne pouvez plus modifier votre adresse mail/i];
  const page4ReadyTexts = Array.isArray(schoolProfile?.page3?.page4ReadyTexts) && schoolProfile.page3.page4ReadyTexts.length
    ? schoolProfile.page3.page4ReadyTexts
    : [/^Paiement$/i, /choisissez votre moyen de paiement/i, /frais de candidature/i];

  const page3Locators = page3ReadyTexts.map((pattern) => page.getByText(pattern));
  const page4Locators = page4ReadyTexts.map((pattern) => page.getByText(pattern));
  const nextLabels = ['Suivant', 'Next step', 'Next'];

  const isAnyVisible = async (locators) => {
    for (const locator of locators) {
      try {
        if (await locator.first().isVisible()) {
          return true;
        }
      } catch {
        // ignore
      }
    }
    return false;
  };

  try {
    await clickNextAndWait(
      page,
      data.id,
      'page-3',
      page3Locators,
      [
        page.getByText(/ma candidature\s*2\s*\/\s*4/i),
        page.getByText(/my application\s*2\s*\/\s*4/i),
        page.getByText(/^Parcours$/i),
      ],
      nextLabels
    );
  } catch (err) {
    const errMsg = String(err?.message || err);
    if (
      errMsg.includes('Validation errors detected: page-2') ||
      errMsg.includes('Validation errors detected: page-3') ||
      errMsg.includes('Navigation failed: page-3')
    ) {
      if (await isAnyVisible(page3Locators)) {
        await closeDocumentPopups(documentPopups);
        console.log('[INFO] Page 3/4 detectee, pas de retry page 2');
        console.log('? Page 2/4 ? OK');
        return;
      }

      if (await isAnyVisible(page4Locators)) {
        await closeDocumentPopups(documentPopups);
        await logValidationState(page, data.id, 'page-3-skipped-from-page-2');
        throw new Error('Page 3 sautee: page 4 detectee juste apres la page 2');
      }

      console.log('[RETRY] Validation page 2 en echec, nouvelle tentative PJ + cases');
      await runDocumentsSection({ sectionDocuments, p2, dataRoot, helpers, page });
      await runPage2Checkboxes({ helpers, page });
      await clickNextAndWait(
        page,
        data.id,
        'page-3',
        page3Locators,
        [
          page.getByText(/ma candidature\s*2\s*\/\s*4/i),
          page.getByText(/my application\s*2\s*\/\s*4/i),
          page.getByText(/^Parcours$/i),
        ],
        nextLabels
      );
    } else {
      throw err;
    }
  }

  await closeDocumentPopups(documentPopups);

  console.log('? Page 2/4 ? OK');
};
