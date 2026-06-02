const runChoixProgramme = require('../sections/page1/choixProgramme');
const runInfoPersonnelles = require('../sections/page1/infoPersonnelles');

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

async function clickConfiguredPage1Choice(page, choiceTexts) {
  const choices = Array.isArray(choiceTexts) ? choiceTexts : [choiceTexts];
  for (const rawText of choices) {
    const text = String(rawText || '').trim();
    if (!text) continue;

    const textLocator = page.getByText(text, { exact: false }).first();
    if (await textLocator.count().catch(() => 0)) {
      const container = textLocator.locator('xpath=ancestor::*[self::label or self::div or self::section][.//*[@role="switch"] or .//input[@type="checkbox"] or .//button][1]');
      const scope = (await container.count().catch(() => 0)) ? container.first() : textLocator.locator('xpath=ancestor::*[self::label or self::div][1]');
      const targets = [
        scope.getByRole('switch').first(),
        scope.locator('input[type="checkbox"]').first(),
        scope.locator('button').first(),
      ];

      for (const target of targets) {
        if (!(await target.count().catch(() => 0))) continue;
        const checked = await target.evaluate((node) => node.checked === true || node.getAttribute('aria-checked') === 'true').catch(() => false);
        if (!checked) {
          const clicked = await target.evaluate((node) => {
            if (node.tagName === 'INPUT') {
              node.click();
              node.dispatchEvent(new Event('input', { bubbles: true }));
              node.dispatchEvent(new Event('change', { bubbles: true }));
              return true;
            }
            return false;
          }).catch(() => false);
          if (!clicked) {
            await target.click({ force: true }).catch(() => null);
          }
          await page.waitForTimeout(900);
        }
        const checkedAfter = await target.evaluate((node) => node.checked === true || node.getAttribute('aria-checked') === 'true').catch(() => false);
        if (checkedAfter) return text;
      }

      const box = await scope.boundingBox().catch(() => null);
      if (box) {
        await page.mouse.click(box.x + box.width - 36, box.y + Math.min(36, box.height / 2));
        await page.waitForTimeout(900);
        const switchedOn = await scope.locator('[role="switch"], input[type="checkbox"], button').first().evaluate((node) => (
          node.checked === true
          || node.getAttribute('aria-checked') === 'true'
          || /checked|active|selected|true/i.test(node.className || '')
        )).catch(() => false);
        if (switchedOn) return text;
      }
    }

    const normalizedTarget = normalizeText(text);
    const picked = await page.locator('label, div, section').filter({ hasText: /omnes/i }).evaluateAll((nodes, target) => {
      const normalize = (value) => String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
      const node = nodes.find((item) => normalize(item.innerText || item.textContent).includes(target));
      if (!node) return '';
      const switchNode = node.querySelector('[role="switch"], input[type="checkbox"], button');
      if (switchNode) switchNode.click();
      else node.click();
      return node.innerText || node.textContent || '';
    }, normalizedTarget).catch(() => '');
    if (picked) {
      await page.waitForTimeout(800);
      return text;
    }
  }
  return '';
}

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
  const page1ChoiceTexts = data?.school?.startConfig?.page1ChoiceTexts || data?.page1?.choiceTexts;
  if (page1ChoiceTexts) {
    const picked = await clickConfiguredPage1Choice(page, page1ChoiceTexts);
    if (picked) {
      console.log(`[INFO] Choix page 1 selectionne depuis Squash: ${picked}`);
    } else {
      console.log('[WARNING] Choix page 1 demande par Squash introuvable');
    }
  }
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
