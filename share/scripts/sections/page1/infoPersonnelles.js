module.exports = async function runInfoPersonnelles(ctx) {
  const { page, p1, schoolProfile, helpers } = ctx;
  const {
    fillInputByLabel,
    fillDateInput,
    fillPhoneInput,
    fillFieldsByLabel,
    logRequiredFields,
    DEBUG_REQUIRED,
  } = helpers;

  const labels = schoolProfile?.page1?.personal || {};
  const baseLabels = {
    nom: labels.nom || ['Nom de naissance'],
    prenom: labels.prenom || ['Prenom', 'Prénom'],
    email: labels.email || ['Email'],
    emailConfirm: labels.emailConfirm || ['Confirmez votre adresse email'],
    phone: labels.phone || ['Telephone', 'Telephone portable', 'Mobile', 'Numero de telephone'],
    country: labels.country || ['Pays de residence', 'Pays de résidence'],
    nationality: labels.nationality || ['Nationalite', 'Nationalité'],
    parentEmail: labels.parentEmail || [],
    parentEmailConfirm: labels.parentEmailConfirm || [],
    parentPhone: labels.parentPhone || [],
    extraFields: Array.isArray(labels.extraFields) ? labels.extraFields : [],
  };

  const tryFillByCandidates = async (candidates, value, options = {}) => {
    if (value === undefined || value === null || String(value).trim() === '') return false;
    const list = Array.isArray(candidates) ? candidates : [candidates];
    for (const label of list) {
      try {
        await fillInputByLabel(page, label, value, options);
        return true;
      } catch {
        // ignore and try next label
      }
    }
    return false;
  };

  const buildExtraFields = () => {
    const output = {};
    for (const field of baseLabels.extraFields) {
      const list = (Array.isArray(field.labels) ? field.labels : [field.label || field.key]).filter(Boolean);
      if (!list.length) continue;
      let value = field.defaultValue;
      if (field.key === 'birth_country') value = p1.birth_country || p1.birthCountry || p1.pays || field.defaultValue;
      if (field.key === 'birth_city') value = p1.birth_city || p1.birthCity || p1.ville_naissance || field.defaultValue;
      if (field.key === 'current_address') value = p1.current_address || p1.currentAddress || p1.adresse || field.defaultValue;
      if (field.key === 'program_language') value = p1.program_language || p1.programLanguage || field.defaultValue;
      if (field.key === 'program_school') value = p1.program_school || p1.programSchool || field.defaultValue;
      if (value === undefined || value === null || String(value).trim() === '') continue;
      for (const label of list) {
        output[label] = {
          value,
          type: field.type || 'text',
        };
      }
    }
    return output;
  };

  console.log('\n?? Informations personnelles');
  await page.waitForTimeout(2000);

  const nomOk = await tryFillByCandidates(baseLabels.nom, p1.nom, { exact: false, verify: true });
  if (!nomOk) {
    throw new Error(`Champ nom introuvable (${baseLabels.nom.join(' / ')})`);
  }

  const prenomOk = await tryFillByCandidates(baseLabels.prenom, p1.prenom, { exact: false, verify: true });
  if (!prenomOk) {
    throw new Error(`Champ prenom introuvable (${baseLabels.prenom.join(' / ')})`);
  }

  await fillDateInput(page, p1.date_naissance);

  const emailOk = await tryFillByCandidates(baseLabels.email, p1.email, { exact: false, index: 0, verify: true });
  if (!emailOk) {
    throw new Error(`Champ email introuvable (${baseLabels.email.join(' / ')})`);
  }

  const emailConfirmOk = await tryFillByCandidates(baseLabels.emailConfirm, p1.email_confirm, { exact: false, verify: true });
  if (!emailConfirmOk) {
    throw new Error(`Champ confirmation email introuvable (${baseLabels.emailConfirm.join(' / ')})`);
  }

  await fillPhoneInput(
    page,
    baseLabels.phone,
    p1.telephone,
    { fallbackIndex: 0, fallbackTextIndex: 5 }
  );

  await fillFieldsByLabel(page, {
    ...buildExtraFields(),
    ...(p1.fields || {}),
  }, 'Page 1/4');

  if (baseLabels.parentEmail.length) {
    await tryFillByCandidates(baseLabels.parentEmail, p1.email_parent, { exact: false, verify: true });
  }

  if (baseLabels.parentEmailConfirm.length) {
    await tryFillByCandidates(baseLabels.parentEmailConfirm, p1.email_parent_confirm, { exact: false, verify: true });
  }

  if (DEBUG_REQUIRED) {
    await logRequiredFields(page, 'Page 1/4');
  }

  if (baseLabels.parentPhone.length && p1.telephone_parent) {
    try {
      await fillPhoneInput(
        page,
        baseLabels.parentPhone,
        p1.telephone_parent,
        { fallbackIndex: 1, fallbackTextIndex: 6 }
      );
    } catch {
      console.log('  [INFO] Telephone parent non present sur cette variante');
    }
  }
};
