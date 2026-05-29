async function clickPreStartChoice(page, texts) {
  const candidates = Array.isArray(texts) ? texts : [texts];

  for (const rawText of candidates) {
    const text = String(rawText || '').trim();
    if (!text) continue;

    try {
      const byText = page.getByText(text, { exact: false }).first();
      if (await byText.count()) {
        await byText.click({ force: true });
        await page.waitForTimeout(1200);
        return text;
      }
    } catch {
      // ignore
    }

    try {
      const generic = page.locator('button, a, [role="button"], div, span, li').filter({ hasText: text }).first();
      if (await generic.count()) {
        await generic.click({ force: true });
        await page.waitForTimeout(1200);
        return text;
      }
    } catch {
      // ignore
    }
  }

  return '';
}

async function selectPreStartDropdownOption(page, descriptor) {
  const headerTexts = Array.isArray(descriptor?.headerTexts) ? descriptor.headerTexts : [descriptor?.headerText];
  const optionText = String(descriptor?.optionText || '').trim();
  if (!headerTexts.filter(Boolean).length || !optionText) return '';

  const pickedHeader = await clickPreStartChoice(page, headerTexts);
  if (!pickedHeader) return '';

  try {
    const byText = page.getByText(optionText, { exact: false }).first();
    if (await byText.count()) {
      await byText.click({ force: true });
      await page.waitForTimeout(1500);
      return `${pickedHeader} -> ${optionText}`;
    }
  } catch {
    // ignore
  }

  try {
    const generic = page.locator('a, button, [role="button"], div, span, li').filter({ hasText: optionText }).first();
    if (await generic.count()) {
      await generic.click({ force: true });
      await page.waitForTimeout(1500);
      return `${pickedHeader} -> ${optionText}`;
    }
  } catch {
    // ignore
  }

  return pickedHeader;
}

module.exports = async function runStartPage(ctx) {
  const { page, data, schoolProfile, acceptCookiesIfBlocking, ensureFormStart } = ctx;
  const startConfig = {
    ...(schoolProfile?.start || {}),
    ...((data?.school?.startConfig && typeof data.school.startConfig === 'object') ? data.school.startConfig : {}),
  };

  await page.goto(data.url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await acceptCookiesIfBlocking(page, 'startup');
  await page.waitForTimeout(800);
  await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(1200);

  if (Array.isArray(startConfig.preStartDropdowns) && startConfig.preStartDropdowns.length) {
    for (const descriptor of startConfig.preStartDropdowns) {
      const picked = await selectPreStartDropdownOption(page, descriptor);
      if (picked) {
        console.log(`[INFO] Profil de depart selectionne: ${picked}`);
      } else {
        console.log("[INFO] Aucun profil de depart n'a pu etre selectionne automatiquement");
      }
    }
  } else if (Array.isArray(startConfig.preStartChoiceTexts) && startConfig.preStartChoiceTexts.length) {
    const picked = await clickPreStartChoice(page, startConfig.preStartChoiceTexts);
    if (picked) {
      console.log(`[INFO] Profil de depart selectionne: ${picked}`);
      await page.waitForTimeout(1500);
    } else {
      console.log("[INFO] Aucun profil de depart n'a pu etre selectionne automatiquement");
    }
  }

  const started = await ensureFormStart(page, startConfig);
  if (!started) {
    throw new Error("Impossible d'ouvrir le formulaire (bouton demarrer)");
  }

  await page.waitForLoadState('networkidle', { timeout: 60000 });
  await page.waitForTimeout(2000);

  console.log('[OK] Page accueil ? OK');
};
