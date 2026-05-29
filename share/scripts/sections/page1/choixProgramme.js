module.exports = async function runChoixProgramme(ctx) {
  const { page, p1, schoolProfile, helpers } = ctx;
  const { selectDropdownByLabel, selectDropdownByIndex, waitForComboboxEnabled } = helpers;

  const descriptors = Array.isArray(schoolProfile?.page1?.programDropdowns) && schoolProfile.page1.programDropdowns.length
    ? schoolProfile.page1.programDropdowns
    : [
        { key: 'session', labels: ['Session de rentree', 'Session de rentrée'], fallbackIndex: 0, required: true },
        { key: 'campus', labels: ['Campus'], fallbackIndex: 1, required: true },
        { key: 'niveau_admission', labels: ["Niveau d'admission", "Niveau d admission"], fallbackIndex: 2, required: true },
        { key: 'programme', labels: ['Nom du programme', 'Programme'], fallbackIndex: 3, required: true },
        { key: 'pays', labels: ['Pays de residence', 'Pays de résidence'], fallbackIndex: 4, required: false },
        { key: 'nationalite', labels: ['Nationalite', 'Nationalité'], fallbackIndex: 5, required: false },
      ];

  const chooseDropdown = async (descriptor, value) => {
    const labels = Array.from(
      new Map(
        (Array.isArray(descriptor.labels) ? descriptor.labels : [descriptor.label || descriptor.key])
          .filter(Boolean)
          .map((label) => [String(label).trim().toLowerCase(), label])
      ).values()
    );
    const fallbackIndex = Number.isInteger(descriptor.fallbackIndex) ? descriptor.fallbackIndex : null;
    const preferIndex = descriptor.preferIndex === true;
    let labelResolved = false;

    const tryIndexFirst = async () => {
      if (fallbackIndex === null) return false;
      try {
        await selectDropdownByIndex(page, fallbackIndex, value, labels[0] || descriptor.key);
        return true;
      } catch {
        return false;
      }
    };

    if (preferIndex) {
      const indexSelected = await tryIndexFirst();
      if (indexSelected) return true;
    }

    for (const label of labels) {
      try {
        await waitForComboboxEnabled(page, label, 5000);
      } catch {
        // ignore
      }

      try {
        const ok = await selectDropdownByLabel(page, label, value);
        labelResolved = true;
        if (ok) return true;
      } catch (error) {
        if (!/Dropdown introuvable/i.test(String(error?.message || ''))) {
          labelResolved = true;
        }
      }
    }

    if (!preferIndex && !labelResolved) {
      const indexSelected = await tryIndexFirst();
      if (indexSelected) return true;
    }

    return false;
  };

  for (const descriptor of descriptors) {
    const value = Object.prototype.hasOwnProperty.call(p1 || {}, descriptor.key)
      ? p1[descriptor.key]
      : descriptor.defaultValue;

    if (value === undefined || value === null || String(value).trim() === '') {
      continue;
    }

    const ok = await chooseDropdown(descriptor, value);
    if (!ok) {
      const labels = Array.isArray(descriptor.labels) ? descriptor.labels.join(' / ') : String(descriptor.key || '');
      if (descriptor.required) {
        console.log(`  [WARNING] Page 1/4: impossible de selectionner '${labels}' => '${value}'`);
      } else {
        console.log(`  [INFO] Page 1/4: variante non presente pour '${labels}', on continue`);
      }
    } else if (Number(descriptor.waitAfterSelectMs || 0) > 0) {
      await page.waitForTimeout(Number(descriptor.waitAfterSelectMs));
    }
  }
};
