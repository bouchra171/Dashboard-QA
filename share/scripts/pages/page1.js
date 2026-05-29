const runChoixProgramme = require('../sections/page1/choixProgramme');
const runInfoPersonnelles = require('../sections/page1/infoPersonnelles');

module.exports = async function runPage1(ctx) {
  const { page, data, p1, schoolProfile, helpers } = ctx;
  const {
    pauseForReview,
    clickNextAndWait,
    fillMissingRequiredFields,
    fillMissingFromErrorMessages,
    logValidationState,
    checkAllVisibleCheckboxes,
    checkCheckboxByLabelText,
    DEBUG_REQUIRED,
    logRequiredFields,
  } = helpers;

  console.log('\n?? Page 1/4 — Choix du programme');
  await page.screenshot({ path: `reports/${data.id}-page1-start.png`, fullPage: true });

  await runChoixProgramme({ page, p1, schoolProfile, helpers });
  await runInfoPersonnelles({ page, p1, schoolProfile, helpers });
  await checkCheckboxByLabelText(page, /j'accepte|je consens|i agree|consent/i);
  await checkAllVisibleCheckboxes(page, true);
  await page.screenshot({ path: `reports/${data.id}-page1-filled.png`, fullPage: true });

  await pauseForReview('Page 1/4');

  const page2ReadyTexts = Array.isArray(schoolProfile?.page1?.page2ReadyTexts) && schoolProfile.page1.page2ReadyTexts.length
    ? schoolProfile.page1.page2ReadyTexts
    : [
        /ma candidature\s*2\s*\/\s*4/i,
        /my application\s*2\s*\/\s*4/i,
        /ma candidature\s*2\/4\s*:\s*etudes/i,
        /ma candidature\s*2\/4\s*:\s*études/i,
        /my application\s*2\/4\s*:\s*studies/i,
      ];

  const page2Locators = page2ReadyTexts.map((pattern) => page.getByText(pattern));
  const nextLabels = ['Suivant', 'Next step', 'Next'];

  try {
    await clickNextAndWait(
      page,
      data.id,
      'page-2',
      page2Locators, 
      [page.getByText(/choix du programme/i), page.getByText(/informations personnelles/i), page.getByText(/program choice/i), page.getByText(/personal information/i)],
      nextLabels
    );
  } catch (err) {
    const msg = String(err?.message || err);
    if (
      msg.includes('Validation errors detected') ||
      msg.includes('Navigation failed: page-2') ||
      msg.includes('Still on previous step: page-2')
    ) {
      console.log('[RETRY] Validation page 1 en echec, correction des champs obligatoires');
      if (DEBUG_REQUIRED) {
        await logRequiredFields(page, 'Page 1/4');
      }
      await logValidationState(page, data.id, 'page-1-validation');
      await fillMissingRequiredFields(page, p1);
      await fillMissingFromErrorMessages(page, p1);
      await checkCheckboxByLabelText(page, /j'accepte|je consens|i agree|consent/i);
      await checkAllVisibleCheckboxes(page, true);
      await clickNextAndWait(
        page,
        data.id,
        'page-2',
        page2Locators,
        [page.getByText(/choix du programme/i), page.getByText(/informations personnelles/i), page.getByText(/program choice/i), page.getByText(/personal information/i)],
        nextLabels
      );
    } else {
      throw err;
    }
  }

  console.log('? Page 1/4 ? OK');
};
