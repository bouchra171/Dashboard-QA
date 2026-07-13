module.exports = async function runParcoursSection(ctx) {
  const { page, sectionParcours, selectInSection, p2, schoolProfile, helpers } = ctx;
  if (!sectionParcours) return;
  const { selectDropdownByIndex } = helpers;

  const fields = Array.isArray(schoolProfile?.page2?.parcoursFields)
    ? schoolProfile.page2.parcoursFields
    : [
        { key: 'niveau_etude', labels: ["Niveau d'etude", "Niveau d'etude"], required: false },
        { key: 'type_etude', labels: ["Type d'etude", "Type d'etude"], required: false },
      ];

  for (const field of fields) {
    const value = Object.prototype.hasOwnProperty.call(p2 || {}, field.key)
      ? p2[field.key]
      : field.defaultValue;
    if (value === undefined || value === null || String(value).trim() === '') continue;

    const labels = Array.isArray(field.labels) ? field.labels : [field.label || field.key];
    let selected = false;

    for (const label of labels) {
      selected = await selectInSection(sectionParcours, label, value);
      if (selected) break;
    }

    if (!selected && Number.isInteger(field.fallbackIndex)) {
      try {
        selected = await selectDropdownByIndex(page, field.fallbackIndex, value, labels[0] || field.key, sectionParcours);
      } catch {
        // ignore
      }
    }

    if (!selected && field.required) {
      throw new Error(`Page 2/4 bloquee: champ parcours requis non renseigne (${labels.join(' / ')})`);
    }

    if (selected && Number(field.waitAfterSelectMs || 0) > 0) {
      await page.waitForTimeout(Number(field.waitAfterSelectMs));
    }
  }
};
