module.exports = async function runSessionSection(ctx) {
  const { sectionSession, selectInSection, p2, page, schoolProfile, helpers } = ctx;
  if (!sectionSession) return;
  const { selectDropdownByIndex } = helpers;

  const fields = Array.isArray(schoolProfile?.page2?.sessionFields)
    ? schoolProfile.page2.sessionFields
    : [
        { key: 'session_admission', labels: ["Session d'admission"], required: false },
      ];

  for (const field of fields) {
    const value = Object.prototype.hasOwnProperty.call(p2 || {}, field.key)
      ? p2[field.key]
      : field.defaultValue;
    if (value === undefined || value === null || String(value).trim() === '') continue;

    const labels = Array.isArray(field.labels) ? field.labels : [field.label || field.key];
    let selected = false;
    for (const label of labels) {
      const ok = await selectInSection(sectionSession, label, value);
      if (ok) {
        selected = true;
        break;
      }
    }

    if (!selected && field.allowAnyWhenMissing && value !== '__RANDOM__') {
      console.log(`  [INFO] Page 2/4: '${labels[0] || field.key}' indisponible avec la valeur attendue, on prend une option disponible`);
      for (const label of labels) {
        const ok = await selectInSection(sectionSession, label, '__RANDOM__');
        if (ok) {
          selected = true;
          break;
        }
      }
    }

    if (!selected && Number.isInteger(field.fallbackIndex)) {
      try {
        selected = await selectDropdownByIndex(page, field.fallbackIndex, value, labels[0] || field.key, sectionSession);
      } catch {
        // ignore
      }
    }

    if (!selected && field.required) {
      throw new Error(`Page 2/4 bloquee: session requise non renseignee (${labels.join(' / ')})`);
    }

    if (selected && Number(field.waitAfterSelectMs || 0) > 0) {
      await page.waitForTimeout(Number(field.waitAfterSelectMs));
    }
  }

  if (p2.amenagement === true) {
    try {
      const toggle = page.getByLabel(/amenagement|tiers temps|accommodation/i).first();
      if (await toggle.count()) {
        const checked = await toggle.isChecked().catch(() => false);
        if (!checked) await toggle.check({ force: true });
      }
    } catch {
      // ignore
    }
  }
};
