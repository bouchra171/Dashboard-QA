const STRUCTURE_GROUPS = {
  BACHELOR_PARENT_PAYMENT_4_PAGES: 'bachelor-parent-payment-4-pages',
  STANDARD_PAYMENT_4_PAGES: 'standard-payment-4-pages',
  STANDARD_NO_PAYMENT_4_PAGES: 'standard-no-payment-4-pages',
  MASTERS_PAYMENT_4_PAGES: 'masters-payment-4-pages',
  INTERNATIONAL_PAYMENT_4_PAGES: 'international-payment-4-pages',
  IUM_PAYMENT_4_PAGES: 'ium-payment-4-pages',
};

const PAGE1_SELECTION_MODES = {
  STRICT_JDD: 'strict-jdd',
  AVAILABLE_OPTIONS: 'available-options',
};

const AVAILABLE_OPTIONS_PAGE1_OVERRIDES = Object.freeze({
  page1: {
    session: '__RANDOM__',
    campus: '__RANDOM__',
    niveau_admission: '__RANDOM__',
    programme: '__RANDOM__',
  },
});

const STRUCTURE_FAMILIES = {
  [STRUCTURE_GROUPS.BACHELOR_PARENT_PAYMENT_4_PAGES]: {
    id: STRUCTURE_GROUPS.BACHELOR_PARENT_PAYMENT_4_PAGES,
    label: 'Meme structure que INSEEC Bachelor',
    pages: ['page1', 'page2', 'page3', 'page4-payment'],
    page1MainFields: ['session', 'campus', 'niveau_admission', 'programme', 'email', 'telephone', 'email_parent', 'telephone_parent'],
    page2MainFields: ['niveau_etude', 'type_etude', 'session_admission', 'pieces_jointes'],
    paymentMode: 'paytweak-card',
  },
  [STRUCTURE_GROUPS.STANDARD_PAYMENT_4_PAGES]: {
    id: STRUCTURE_GROUPS.STANDARD_PAYMENT_4_PAGES,
    label: 'Tunnel standard 4 pages avec paiement',
    pages: ['page1', 'page2', 'page3', 'page4-payment'],
    page1MainFields: ['session', 'campus', 'niveau_admission', 'programme', 'email', 'telephone'],
    page2MainFields: ['niveau_etude', 'etablissement_actuel', 'pieces_jointes'],
    paymentMode: 'paytweak-card',
  },
  [STRUCTURE_GROUPS.STANDARD_NO_PAYMENT_4_PAGES]: {
    id: STRUCTURE_GROUPS.STANDARD_NO_PAYMENT_4_PAGES,
    label: 'Tunnel standard 4 pages sans paiement',
    pages: ['page1', 'page2', 'page3', 'page4-validation'],
    page1MainFields: ['session', 'campus', 'niveau_admission', 'programme', 'email', 'telephone'],
    page2MainFields: ['niveau_etude', 'etablissement_actuel', 'pieces_jointes'],
    paymentMode: 'none',
  },
  [STRUCTURE_GROUPS.MASTERS_PAYMENT_4_PAGES]: {
    id: STRUCTURE_GROUPS.MASTERS_PAYMENT_4_PAGES,
    label: 'Tunnel MSC avec options programme',
    pages: ['page1', 'page2', 'page3', 'page4-payment'],
    page1MainFields: ['session', 'campus', 'niveau_admission', 'programme', 'specialisation', 'option'],
    page2MainFields: ['niveau_etude', 'etablissement_actuel', 'pieces_jointes'],
    paymentMode: 'paytweak-card',
  },
  [STRUCTURE_GROUPS.INTERNATIONAL_PAYMENT_4_PAGES]: {
    id: STRUCTURE_GROUPS.INTERNATIONAL_PAYMENT_4_PAGES,
    label: 'Tunnel international avec variantes programme',
    pages: ['page1', 'page2', 'page3', 'page4-payment'],
    page1MainFields: ['session', 'campus', 'niveau_admission', 'program_language', 'program_school', 'programme'],
    page2MainFields: ['niveau_etude', 'etablissement_actuel', 'pieces_jointes'],
    paymentMode: 'paytweak-card',
  },
  [STRUCTURE_GROUPS.IUM_PAYMENT_4_PAGES]: {
    id: STRUCTURE_GROUPS.IUM_PAYMENT_4_PAGES,
    label: 'Tunnel IUM anglais',
    pages: ['page1', 'page2', 'page3', 'page4-payment'],
    page1MainFields: ['session', 'campus', 'niveau_admission', 'programme', 'country', 'nationality'],
    page2MainFields: ['niveau_etude', 'etablissement_actuel', 'pieces_jointes'],
    paymentMode: 'paytweak-card',
  },
};

function buildSchool(definition, defaults) {
  return {
    page1SelectionMode: PAGE1_SELECTION_MODES.STRICT_JDD,
    ...defaults,
    ...definition,
  };
}

function buildAvailableOptionsSchool(definition, defaults) {
  const page1Overrides = {
    ...AVAILABLE_OPTIONS_PAGE1_OVERRIDES.page1,
    ...((definition.jddOverrides && definition.jddOverrides.page1) || {}),
  };

  return buildSchool(
    {
      ...definition,
      page1SelectionMode: PAGE1_SELECTION_MODES.AVAILABLE_OPTIONS,
      jddOverrides: {
        ...(definition.jddOverrides || {}),
        page1: page1Overrides,
      },
    },
    defaults
  );
}

function buildSchoolFamily(definitions, defaults) {
  return definitions.map((definition) => buildSchool(definition, defaults));
}

const BACHELOR_LIKE_SCHOOLS = buildSchoolFamily(
  [
    {
      slug: 'bachelorsinseec',
      label: 'INSEEC Bachelor',
      url: 'https://prospect.rec.omneseducation.com/app/bachelorsinseec/program',
      page1SelectionMode: PAGE1_SELECTION_MODES.STRICT_JDD,
    },
    buildAvailableOptionsSchool({
      slug: 'supdepub',
      label: 'SUP DE PUB',
      url: 'https://prospect.rec.omneseducation.com/app/supdepub/program',
    }),
    buildAvailableOptionsSchool({
      slug: 'supdecreation',
      label: 'SUP DE CREA',
      url: 'https://prospect.rec.omneseducation.com/app/supdecreation/program',
    }),
  ],
  {
    profileId: 'fr-standard-parent-payment',
    journeyGroup: 'fr-standard-parent-payment',
    structureGroup: STRUCTURE_GROUPS.BACHELOR_PARENT_PAYMENT_4_PAGES,
    baseJdd: 'candidat-01.json',
  }
);

const STANDARD_PAYMENT_SCHOOLS = buildSchoolFamily(
  [
      buildAvailableOptionsSchool({
      slug: 'ece',
      label: 'ECE',
      url: 'https://prospect.rec.omneseducation.com/app/ece/program',
      profileId: 'fr-standard-payment-speciality-only',
      startConfig: {
        preStartDropdowns: [
          {
            headerTexts: ['Je suis en Terminale', 'Bachelier ou Bac+1'],
            optionText: '1ère année du Bachelor',
          },
        ],
      },
    }),
    buildAvailableOptionsSchool({
      slug: 'heip',
      label: 'HEIP',
      url: 'https://prospect.rec.omneseducation.com/app/HEIP/program',
      profileId: 'fr-standard-payment-speciality-only',
    }),
    buildAvailableOptionsSchool({
      slug: 'isbe',
      label: 'INSEEC Grande Ecole',
      url: 'https://prospect.rec.omneseducation.com/app/isbe/program',
      profileId: 'fr-standard-payment-speciality',
      jddOverrides: {
        page2: {
          niveau_etude: '__RANDOM__',
          type_etude: '__RANDOM__',
          specialite: '__RANDOM__',
          etablissement_actuel: '__RANDOM__',
          session_admission: '__RANDOM__',
        },
      },
    }),
    buildAvailableOptionsSchool({
      slug: 'inseecbba',
      label: 'INSEEC BBA',
      url: 'https://prospect.rec.omneseducation.com/app/inseecbba/program',
      profileId: 'fr-standard-payment-session',
      jddOverrides: {
        page2: {
          niveau_etude: '__RANDOM__',
          etablissement_actuel: '__RANDOM__',
          session_admission: '__RANDOM__',
        },
      },
    }),
    buildAvailableOptionsSchool({
      slug: 'esce',
      label: 'ESCE',
      url: 'https://prospect.rec.omneseducation.com/app/esce/program',
      profileId: 'fr-standard-payment-speciality-only',
      jddOverrides: {
        page2: {
          niveau_etude: 'Terminale',
          type_etude: 'Professionnelle',
          specialite: 'Autres',
          session_admission: 'English',
        },
      },
    }),
  ],
  {
    profileId: 'fr-standard-payment',
    journeyGroup: 'fr-standard-payment',
    structureGroup: STRUCTURE_GROUPS.STANDARD_PAYMENT_4_PAGES,
    baseJdd: 'candidat-01.json',
  }
);

const STANDARD_NO_PAYMENT_SCHOOLS = buildSchoolFamily(
  [
    buildAvailableOptionsSchool({
      slug: 'supcareer',
      label: 'SUPCAREER Alternance',
      url: 'https://prospect.rec.omneseducation.com/app/supcareer/program',
    }),
    buildAvailableOptionsSchool({
      slug: 'inseecbts',
      aliases: ['inseecbta'],
      label: 'INSEEC BTS (v1)',
      url: 'https://prospect.rec.omneseducation.com/app/inseecbts/program',
    }),
  ],
  {
    profileId: 'fr-standard-no-payment',
    journeyGroup: 'fr-standard-no-payment',
    structureGroup: STRUCTURE_GROUPS.STANDARD_NO_PAYMENT_4_PAGES,
    baseJdd: 'candidat-01.json',
  }
);

const CAMPAIGNS = {
  'tnr-front-recette': {
    id: 'tnr-front-recette',
    title: 'Campagne TNR Front - Formulaires de candidature',
    environment: 'Recette',
    browser: 'Chrome',
    tool: 'Playwright',
    expectedSchoolCount: 14,
    schools: [
      ...BACHELOR_LIKE_SCHOOLS,
      buildAvailableOptionsSchool({
        slug: 'ium',
        label: 'IUM Monaco',
        url: 'https://prospect.rec.omneseducation.com/app/ium/program',
        profileId: 'en-ium-payment',
        journeyGroup: 'en-ium-payment',
        structureGroup: STRUCTURE_GROUPS.IUM_PAYMENT_4_PAGES,
        baseJdd: 'candidat-01.json',
        jddOverrides: {
          page1: {
            pays: 'France',
            nationalite: 'France',
          },
        },
      }),
      ...STANDARD_PAYMENT_SCHOOLS,
      ...STANDARD_NO_PAYMENT_SCHOOLS,
    buildAvailableOptionsSchool({
      slug: 'mastersinseec',
      label: 'INSEEC MSC',
      url: 'https://prospect.rec.omneseducation.com/app/mastersinseec/program',
      profileId: 'fr-masters-payment',
      journeyGroup: 'fr-masters-payment',
      structureGroup: STRUCTURE_GROUPS.MASTERS_PAYMENT_4_PAGES,
      baseJdd: 'candidat-01.json',
      jddOverrides: {
        page1: {
          nationalite: 'Française',
        },
        page2: {
          niveau_etude: '__RANDOM__',
        },
      },
    }),
      {
        slug: 'international',
        label: 'INTERNATIONAL',
        url: 'https://prospect.rec.omneseducation.com/app/international/program',
        profileId: 'fr-international-payment',
        journeyGroup: 'fr-international-payment',
        structureGroup: STRUCTURE_GROUPS.INTERNATIONAL_PAYMENT_4_PAGES,
        baseJdd: 'candidat-01.json',
        page1SelectionMode: PAGE1_SELECTION_MODES.STRICT_JDD,
        jddOverrides: {
          page1: {
            session: 'Septembre / Octobre 2028',
            campus: 'Lyon',
            niveau_admission: 'Programme Grande Ecole M2',
            program_language: 'Anglais',
            program_school: 'ESCE',
            programme: 'Master in Management - International Business Development',
          },
        },
      },
    ],
  },
};

function buildIntegrationCampaignFromRecette() {
  const recette = CAMPAIGNS['tnr-front-recette'];
  return {
    ...recette,
    id: 'tnr-front-integration',
    title: 'Campagne TNR Front - Formulaires de candidature - Integration',
    environment: 'Integration',
    schools: recette.schools.map((school) => ({
      ...school,
      url: `https://prospect.dev.omneseducation.com/app/${school.slug}/program`,
    })),
  };
}

CAMPAIGNS['tnr-front-integration'] = buildIntegrationCampaignFromRecette();

function buildPreprodCampaignFromRecette() {
  const recette = CAMPAIGNS['tnr-front-recette'];
  return {
    ...recette,
    id: 'tnr-front-preprod',
    title: 'Campagne TNR Front - Formulaires de candidature - Preprod',
    environment: 'Preprod',
    schools: recette.schools.map((school) => ({
      ...school,
      url: `https://prospect.preprod.omneseducation.com/app/${school.slug}/program`,
    })),
  };
}

CAMPAIGNS['tnr-front-preprod'] = buildPreprodCampaignFromRecette();

function getCampaign(campaignId = 'tnr-front-recette') {
  const campaign = CAMPAIGNS[campaignId];
  if (!campaign) {
    throw new Error(`Campagne introuvable: ${campaignId}`);
  }
  return campaign;
}

function findSchool(campaignId, schoolSlug) {
  const campaign = getCampaign(campaignId);
  const needle = String(schoolSlug || '').trim().toLowerCase();
  return campaign.schools.find((school) => {
    const aliases = Array.isArray(school.aliases) ? school.aliases : [];
    return [school.slug, ...aliases].some((value) => String(value).toLowerCase() === needle);
  }) || null;
}

function findSchoolsByStructureGroup(campaignId, structureGroup) {
  const campaign = getCampaign(campaignId);
  const needle = String(structureGroup || '').trim().toLowerCase();
  if (!needle) return [];
  return campaign.schools.filter((school) => String(school.structureGroup || '').trim().toLowerCase() === needle);
}

function findSchoolsSharingStructure(campaignId, schoolSlug) {
  const referenceSchool = findSchool(campaignId, schoolSlug);
  if (!referenceSchool || !referenceSchool.structureGroup) return [];
  return findSchoolsByStructureGroup(campaignId, referenceSchool.structureGroup);
}

function getStructureFamily(structureGroup) {
  const key = String(structureGroup || '').trim();
  return STRUCTURE_FAMILIES[key] || null;
}

module.exports = {
  AVAILABLE_OPTIONS_PAGE1_OVERRIDES,
  BACHELOR_LIKE_SCHOOLS,
  CAMPAIGNS,
  PAGE1_SELECTION_MODES,
  STANDARD_NO_PAYMENT_SCHOOLS,
  STANDARD_PAYMENT_SCHOOLS,
  STRUCTURE_FAMILIES,
  STRUCTURE_GROUPS,
  findSchool,
  findSchoolsByStructureGroup,
  findSchoolsSharingStructure,
  getCampaign,
  getStructureFamily,
};
