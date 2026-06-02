module.exports = async function runPage3(ctx) {
  const { page, data, p2, p3, dataRoot, schoolProfile, helpers } = ctx;
  const {
    fillFieldsByLabel,
    fillDocumentsSection,
    logRequiredFields,
    DEBUG_REQUIRED,
    pauseForReview,
    scrollToBottom,
    checkAllVisibleCheckboxes,
    clickNextAndWait,
    hasValidationErrors,
    logValidationState,
  } = helpers;

  const page3ReadyTexts = Array.isArray(schoolProfile?.page3?.readyTexts) && schoolProfile.page3.readyTexts.length
    ? schoolProfile.page3.readyTexts
    : [
        /ma candidature\s*3\s*\/\s*4/i,
        /my application\s*3\s*\/\s*4/i,
        /valider mes informations/i,
        /vous ne pouvez plus modifier votre adresse mail/i,
      ];
  const page4ReadyTexts = Array.isArray(schoolProfile?.page3?.page4ReadyTexts) && schoolProfile.page3.page4ReadyTexts.length
      ? schoolProfile.page3.page4ReadyTexts
      : [
          /ma candidature\s*4\s*\/\s*4/i,
          /my application\s*4\s*\/\s*4/i,
          /^paiement$/i,
          /^payment$/i,
          /choisissez votre moyen de paiement/i,
        ];
  const submitButtons = Array.isArray(schoolProfile?.page3?.submitButtons) && schoolProfile.page3.submitButtons.length
    ? schoolProfile.page3.submitButtons
    : ['Valider mes informations', 'Valider'];

  const page3Locators = page3ReadyTexts.map((pattern) => page.getByText(pattern));
  const page4Locators = page4ReadyTexts.map((pattern) => page.getByText(pattern));

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

  const reinjectUploadsBeforeSubmit = async () => {
    if (!schoolProfile?.page3?.reinjectUploadsBeforeSubmit) return;
    if (!fillDocumentsSection || !p2?.attachments || !dataRoot) return;

    try {
      const fileInputs = page.locator('input[type="file"]');
      const count = await fileInputs.count();
      if (count === 0) return;

      let emptyCount = 0;
      for (let i = 0; i < count; i += 1) {
        try {
          const len = await fileInputs.nth(i).evaluate((el) => (el.files ? el.files.length : 0));
          if (len === 0) emptyCount += 1;
        } catch {
          emptyCount += 1;
        }
      }

      if (emptyCount === 0) return;

      console.log(`[INFO] Page 3/4: reinjection des pieces jointes avant validation (${emptyCount} input(s) vide(s))`);
      await fillDocumentsSection(page, p2.attachments, dataRoot);
      await page.waitForTimeout(1200);
    } catch (error) {
      console.log(`[WARNING] Reinjection PJ ignoree: ${error?.message || error}`);
    }
  };

  const waitForSummaryPopulation = async () => {
    if (!schoolProfile?.page3?.waitForSummaryValuesFromPage1) return;

    const expectedValues = [
      data?.page1?.session,
      data?.page1?.campus,
      data?.page1?.niveau_admission,
      data?.page1?.program_language,
      data?.page1?.program_school,
    ].filter(Boolean);

    if (!expectedValues.length) return;

    const threshold = Math.min(3, expectedValues.length);
    const startedAt = Date.now();

    while (Date.now() - startedAt < 10000) {
      let visibleCount = 0;
      for (const value of expectedValues) {
        try {
          if (await page.getByText(String(value), { exact: false }).first().isVisible()) {
            visibleCount += 1;
          }
        } catch {
          // ignore missing value
        }
      }

      if (visibleCount >= threshold) {
        console.log(`  [INFO] Page 3/4: recap programme hydrate (${visibleCount}/${expectedValues.length})`);
        return;
      }

      await page.waitForTimeout(500);
    }

    console.log('  [WARNING] Page 3/4: recap programme encore incomplet avant validation');
  };

  if (await isAnyVisible(page4Locators)) {
    await logValidationState(page, data.id, 'page-3-skipped');
    throw new Error('Page 3 sautee: page 4 detectee avant le recapitulatif');
  }

  await fillFieldsByLabel(page, p3.fields, 'Page 3/4');
  if (DEBUG_REQUIRED) {
    await logRequiredFields(page, 'Page 3/4');
  }

  console.log('\n?? Page 3/4 - Recapitulatif');
  if (!(await isAnyVisible(page3Locators))) {
    try {
      await page.locator('button, a, [role="button"]').filter({ hasText: /valider mes informations/i }).first().waitFor({ timeout: 15000 });
    } catch {
      if (await isAnyVisible(page4Locators)) {
        await logValidationState(page, data.id, 'page-3-skipped');
        throw new Error('Page 3 sautee: page 4 detectee avant le recapitulatif');
      }
      await logValidationState(page, data.id, 'page-3-missing');
      throw new Error('Page 3 non detectee');
    }
  }

  await pauseForReview('Page 3/4');
  await scrollToBottom(page);
  await checkAllVisibleCheckboxes(page, true);
  await waitForSummaryPopulation();
  await reinjectUploadsBeforeSubmit();
  await page.screenshot({ path: `reports/${data.id}-page3-filled.png`, fullPage: true });

  if (await hasValidationErrors(page)) {
    await logValidationState(page, data.id, 'page-3-before-submit');
    throw new Error('Validation errors detected: page-3');
  }

  await clickNextAndWait(
    page,
    data.id,
    'page-4',
    page4Locators,
    [page.locator('button, a, [role="button"]').filter({ hasText: /valider|validate/i })],
    submitButtons
  );

  console.log('? Page 3/4 ? OK');
};
