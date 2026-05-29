const { CAMPAIGNS, STRUCTURE_GROUPS } = require('./campaignConfig');

function normalizeSlug(value) {
  return String(value || '').trim().toLowerCase();
}

const STEP_2_READY = [
  /ma candidature\s*2\s*\/\s*4/i,
  /my application\s*2\s*\/\s*4/i,
  /ma candidature\s*2\/4\s*:\s*etudes/i,
  /ma candidature\s*2\/4\s*:\s*etudes/i,
  /my application\s*2\/4\s*:\s*studies/i,
];

const STEP_3_READY = [
  /ma candidature\s*3\s*\/\s*4/i,
  /my application\s*3\s*\/\s*4/i,
  /valider mes informations/i,
  /vous ne pouvez plus modifier votre adresse mail/i,
  /validate my information/i,
];

const STEP_4_PAYMENT_READY = [
  /ma candidature\s*4\s*\/\s*4/i,
  /my application\s*4\s*\/\s*4/i,
  /choisissez votre moyen de paiement/i,
  /choose your payment method/i,
  /frais de candidature/i,
  /application fees/i,
];

const STEP_4_VALIDATION_READY = [
  /ma candidature\s*4\s*\/\s*4/i,
  /my application\s*4\s*\/\s*4/i,
  /validation finale/i,
  /final validation/i,
];

const STANDARD_PAGE2_FIELDS = [
  {
    key: 'niveau_etude',
    labels: [
      "Niveau d'etude",
      "Niveau d'etude actuel",
      "Selectionnez votre niveau d'etude actuel",
      'Level of studies',
    ],
    required: true,
    fallbackIndex: 0,
  },
  {
    key: 'etablissement_actuel',
    labels: [
      'Votre etablissement actuel ou dernier frequente',
      'Etablissement actuel ou dernier frequente',
      'Current or last institution attended',
      'Current school',
      'School attended',
    ],
    required: true,
    defaultValue: '__RANDOM__',
    fallbackIndex: 1,
  },
];

const BACHELOR_LIKE_PAGE2_FIELDS = [
  {
    key: 'niveau_etude',
    labels: ["Niveau d'etude", "Niveau d'etude actuel", 'Level of studies'],
    required: true,
    fallbackIndex: 0,
  },
  {
    key: 'type_etude',
    labels: ["Type d'etude", 'Type of studies'],
    required: true,
    fallbackIndex: 1,
  },
];

const BACHELOR_LIKE_SESSION_FIELDS = [
  {
    key: 'session_admission',
    labels: ["Session d'admission", 'Admission session'],
    required: true,
    allowAnyWhenMissing: true,
  },
];

const STANDARD_PAYMENT_SPECIALITY_PAGE2_FIELDS = [
  {
    key: 'niveau_etude',
    labels: [
      "Niveau d'etude",
      "Niveau d'etude actuel",
      "Selectionnez votre niveau d'etude actuel",
      'Level of studies',
    ],
    required: true,
    fallbackIndex: 0,
  },
  {
    key: 'type_etude',
    labels: [
      "Type d'etude",
      "Renseignez votre type d'etude",
      'Type of studies',
    ],
    required: true,
    defaultValue: '__RANDOM__',
    fallbackIndex: 1,
  },
  {
    key: 'specialite',
    labels: [
      'Specialite',
      'Renseignez votre specialite',
      'Speciality',
      'Specialization',
    ],
    required: true,
    defaultValue: '__RANDOM__',
    fallbackIndex: 2,
  },
  {
    key: 'etablissement_actuel',
    labels: [
      'Selectionnez votre etablissement actuel',
      'Votre etablissement actuel ou dernier frequente',
      'Etablissement actuel ou dernier frequente',
      'Current or last institution attended',
      'Current school',
      'School attended',
    ],
    required: true,
    defaultValue: '__RANDOM__',
    fallbackIndex: 3,
  },
];

const STANDARD_PAYMENT_SPECIALITY_SESSION_FIELDS = [
  {
    key: 'session_admission',
    labels: [
      "Choisissez votre session d'admission",
      "Session d'admission",
      'Admission session',
    ],
    required: true,
    defaultValue: '__RANDOM__',
    fallbackIndex: 0,
    allowAnyWhenMissing: true,
    waitAfterSelectMs: 900,
  },
];

const STANDARD_PAYMENT_SPECIALITY_ONLY_PAGE2_FIELDS = [
  {
    key: 'niveau_etude',
    labels: [
      "Niveau d'etude",
      "Niveau d'etude actuel",
      "Selectionnez votre niveau d'etude actuel",
      'Level of studies',
    ],
    required: true,
    fallbackIndex: 0,
    waitAfterSelectMs: 900,
  },
  {
    key: 'type_etude',
    labels: [
      "Type d'etude",
      "Renseignez votre type d'etude",
      'Type of studies',
    ],
    required: true,
    defaultValue: '__RANDOM__',
    fallbackIndex: 1,
    waitAfterSelectMs: 1200,
  },
  {
    key: 'specialite',
    labels: [
      'Specialite',
      'Renseignez votre specialite',
      'Speciality',
      'Specialization',
    ],
    required: true,
    defaultValue: '__RANDOM__',
    fallbackIndex: 2,
  },
];

const STANDARD_PAYMENT_SESSION_FIELDS = [
  {
    key: 'session_admission',
    labels: [
      "Choisissez votre session d'admission",
      "Session d'admission",
      'Admission session',
    ],
    required: true,
    defaultValue: '__RANDOM__',
    fallbackIndex: 0,
    allowAnyWhenMissing: true,
  },
];

const STANDARD_PAGE2_FIELDS_WITH_CURRENT_SCHOOL = [
  {
    key: 'niveau_etude',
    labels: [
      "Niveau d'etude",
      "Niveau d'etude actuel",
      "Selectionnez votre niveau d'etude actuel",
      'Level of studies',
    ],
    required: true,
    fallbackIndex: 0,
  },
  {
    key: 'etablissement_actuel',
    labels: [
      'Selectionnez votre etablissement actuel',
      'Votre etablissement actuel ou dernier frequente',
      'Etablissement actuel ou dernier frequente',
      'Current or last institution attended',
      'Current school',
      'School attended',
    ],
    required: true,
    defaultValue: '__RANDOM__',
    fallbackIndex: 1,
  },
];

const INTERNATIONAL_PAGE2_FIELDS = [
  {
    key: 'niveau_etude',
    labels: [
      "Niveau d'etude",
      "Niveau d'etude actuel",
      "Selectionnez votre niveau d'etude actuel",
      'Level of studies',
    ],
    required: true,
    fallbackIndex: 0,
    waitAfterSelectMs: 700,
  },
  {
    key: 'etablissement_actuel',
    labels: [
      'Selectionnez votre etablissement actuel',
      'Votre etablissement actuel ou dernier frequente',
      'Etablissement actuel ou dernier frequente',
      'Current or last institution attended',
      'Current school',
      'School attended',
    ],
    required: true,
    defaultValue: '__RANDOM__',
    fallbackIndex: 1,
    waitAfterSelectMs: 700,
  },
  {
    key: 'session_etablissement',
    labels: [
      'Session ou mois de votre etablissement',
      'Session ou mois de votre établissement',
      'Month or session of your institution',
      'Month or session of your school',
      'School session or month',
    ],
    required: true,
    defaultValue: '__RANDOM__',
    fallbackIndex: 2,
    waitAfterSelectMs: 700,
  },
];

const baseProfile = {
  id: 'fr-standard-payment',
  label: 'Tunnel standard 4 pages FR',
  journeyGroup: 'tunnel-standard-4-pages',
  structureGroup: STRUCTURE_GROUPS.STANDARD_PAYMENT_4_PAGES,
  paymentMode: 'paytweak-card',
  start: {
    readyTexts: [/session de rentr[eé]e/i, /campus/i, /nom du programme/i],
    startButtons: [/d[eé]marrer une nouvelle candidature/i, /commencer/i],
    resumeButtons: [/poursuivre ma candidature/i],
  },
  page1: {
    readyTexts: [/choix du programme/i, /informations personnelles/i],
    programDropdowns: [
      { key: 'session', labels: ['Session de rentree', 'Session de rentree'], fallbackIndex: 0, required: true, waitAfterSelectMs: 700 },
      { key: 'campus', labels: ['Campus'], fallbackIndex: 1, required: true, waitAfterSelectMs: 700 },
      { key: 'niveau_admission', labels: ["Niveau d'admission", 'Niveau d admission'], fallbackIndex: 2, required: true, waitAfterSelectMs: 700 },
      { key: 'programme', labels: ['Nom du programme', 'Programme'], fallbackIndex: 3, required: true, waitAfterSelectMs: 350 },
      { key: 'pays', labels: ['Pays de residence', 'Pays de residence'], fallbackIndex: 4, required: false },
      { key: 'nationalite', labels: ['Nationalite', 'Nationalite'], fallbackIndex: 5, required: false },
    ],
    personal: {
      nom: ['Nom de naissance'],
      prenom: ['Prenom', 'Prenom'],
      email: ['Email'],
      emailConfirm: ['Confirmez votre adresse email'],
      phone: ['Telephone', 'Telephone portable', 'Mobile', 'Numero de telephone'],
      country: ['Pays de residence', 'Pays de residence'],
      nationality: ['Nationalite', 'Nationalite'],
      parentEmail: [],
      parentEmailConfirm: [],
      parentPhone: [],
      extraFields: [],
    },
    page2ReadyTexts: STEP_2_READY,
  },
  page2: {
    readyTexts: STEP_2_READY,
    sectionLabels: {
      parcours: [/parcours/i, /etudes/i, /studies/i],
      session: [/session d'admission/i, /admission session/i, /session/i],
      documents: [/documents?/i, /pi[eè]ces jointes/i, /attachments?/i],
    },
    parcoursFields: STANDARD_PAGE2_FIELDS,
    sessionFields: [],
    page3ReadyTexts: STEP_3_READY,
  },
  page3: {
    readyTexts: STEP_3_READY,
    submitButtons: ['Valider mes informations', 'Valider', 'Validate my information', 'Validate', 'Confirm my information', 'Confirm information'],
    page4ReadyTexts: STEP_4_PAYMENT_READY,
  },
  page4: {
    readyTexts: STEP_4_PAYMENT_READY,
    completionReadyTexts: [
      /f[eé]licitations/i,
      /votre candidature a bien [eé]t[eé] envoy[eé]e/i,
      /your application has been sent/i,
      /thank you for your application/i,
    ],
  },
};

const PROFILES = {
  'fr-standard-payment': baseProfile,
  'fr-standard-payment-speciality': {
    ...baseProfile,
    id: 'fr-standard-payment-speciality',
    label: 'Tunnel standard 4 pages avec specialite',
    structureGroup: STRUCTURE_GROUPS.STANDARD_PAYMENT_4_PAGES,
    page2: {
      ...baseProfile.page2,
      parcoursFields: STANDARD_PAYMENT_SPECIALITY_PAGE2_FIELDS,
      sessionFields: STANDARD_PAYMENT_SPECIALITY_SESSION_FIELDS,
    },
  },
  'fr-standard-payment-speciality-only': {
    ...baseProfile,
    id: 'fr-standard-payment-speciality-only',
    label: 'Tunnel standard 4 pages avec specialite et session admission',
    structureGroup: STRUCTURE_GROUPS.STANDARD_PAYMENT_4_PAGES,
    page2: {
      ...baseProfile.page2,
      parcoursFields: STANDARD_PAYMENT_SPECIALITY_ONLY_PAGE2_FIELDS,
      sessionFields: STANDARD_PAYMENT_SPECIALITY_SESSION_FIELDS,
    },
  },
  'fr-standard-payment-session': {
    ...baseProfile,
    id: 'fr-standard-payment-session',
    label: 'Tunnel standard 4 pages avec session admission',
    structureGroup: STRUCTURE_GROUPS.STANDARD_PAYMENT_4_PAGES,
    page2: {
      ...baseProfile.page2,
      parcoursFields: STANDARD_PAGE2_FIELDS_WITH_CURRENT_SCHOOL,
      sessionFields: STANDARD_PAYMENT_SESSION_FIELDS,
    },
  },
  'fr-standard-parent-payment': {
    ...baseProfile,
    id: 'fr-standard-parent-payment',
    label: 'Tunnel FR standard avec contacts parent',
    structureGroup: STRUCTURE_GROUPS.BACHELOR_PARENT_PAYMENT_4_PAGES,
    page1: {
      ...baseProfile.page1,
      personal: {
        ...baseProfile.page1.personal,
        parentEmail: ['Email parent'],
        parentEmailConfirm: ['Confirmez votre adresse email parent', "Confirmez l'adresse email parent", 'Confirmez email parent'],
        parentPhone: ['Telephone parent', 'Telephone du parent', 'Mobile parent', 'Telephone'],
      },
    },
    page2: {
      ...baseProfile.page2,
      parcoursFields: BACHELOR_LIKE_PAGE2_FIELDS,
      sessionFields: BACHELOR_LIKE_SESSION_FIELDS,
    },
  },
  'fr-standard-no-payment': {
    ...baseProfile,
    id: 'fr-standard-no-payment',
    label: 'Tunnel FR standard sans paiement',
    structureGroup: STRUCTURE_GROUPS.STANDARD_NO_PAYMENT_4_PAGES,
    paymentMode: 'none',
    page3: {
      ...baseProfile.page3,
      page4ReadyTexts: STEP_4_VALIDATION_READY,
    },
    page4: {
      ...baseProfile.page4,
      readyTexts: STEP_4_VALIDATION_READY,
    },
  },
  'fr-masters-payment': {
    ...baseProfile,
    id: 'fr-masters-payment',
    label: 'Tunnel MSC avec options programme',
    structureGroup: STRUCTURE_GROUPS.MASTERS_PAYMENT_4_PAGES,
    page1: {
      ...baseProfile.page1,
      programDropdowns: [
        { key: 'session', labels: ['Session de rentree', 'Session de rentree', 'Start date'], fallbackIndex: 0, required: true, preferIndex: true, waitAfterSelectMs: 800 },
        { key: 'campus', labels: ['Campus'], fallbackIndex: 1, required: true, preferIndex: true, waitAfterSelectMs: 800 },
        { key: 'niveau_admission', labels: ["Niveau d'admission", 'Niveau d admission', 'Level of studies you are applying for'], fallbackIndex: 2, required: true, preferIndex: true, waitAfterSelectMs: 800 },
        { key: 'programme', labels: ['Nom du programme', 'Programme', 'Program'], fallbackIndex: 3, required: true, defaultValue: '__RANDOM__', preferIndex: true, waitAfterSelectMs: 500 },
        { key: '__random__option1', labels: ['Specialisation', 'Specialisation', 'Majeure', 'Parcours'], fallbackIndex: 4, required: false, defaultValue: '__RANDOM__', preferIndex: true, waitAfterSelectMs: 400 },
        { key: '__random__option2', labels: ['Option', 'Mineure', 'Choix secondaire'], fallbackIndex: 5, required: false, defaultValue: '__RANDOM__', preferIndex: true, waitAfterSelectMs: 400 },
        { key: '__random__option3', labels: ['Option 3', 'Choix complementaire', 'Double diplome'], fallbackIndex: 6, required: false, defaultValue: '__RANDOM__', preferIndex: true, waitAfterSelectMs: 400 },
        { key: 'pays', labels: ['Pays de residence', 'Country of residence'], fallbackIndex: 7, required: false },
        { key: 'nationalite', labels: ['Nationalite', 'Nationality'], fallbackIndex: 8, required: false },
      ],
      page2ReadyTexts: [...STEP_2_READY, /Studies/i, /Etudes/i],
      personal: {
        nom: ['Nom de naissance', 'Birth name', 'Usual name'],
        prenom: ['Prenom', 'Prénom', 'First name'],
        email: ['Email', 'Email address'],
        emailConfirm: ['Confirmez votre adresse email', 'Confirm your email address'],
        phone: ['Telephone', 'Telephone portable', 'Mobile', 'Numero de telephone', 'Phone number', 'Phone'],
        country: ['Pays de residence', 'Pays de résidence', 'Country of residence'],
        nationality: ['Nationalite', 'Nationalité', 'Nationality'],
        parentEmail: [],
        parentEmailConfirm: [],
        parentPhone: [],
        extraFields: [],
      },
    },
    page2: {
      ...baseProfile.page2,
      parcoursFields: STANDARD_PAGE2_FIELDS,
      sessionFields: [],
    },
  },
  'en-ium-payment': {
    ...baseProfile,
    id: 'en-ium-payment',
    label: 'Tunnel IUM anglais',
    structureGroup: STRUCTURE_GROUPS.IUM_PAYMENT_4_PAGES,
    start: {
      readyTexts: [/start date/i, /campus/i, /program/i],
      startButtons: [/start a new application/i, /^start$/i],
      resumeButtons: [/continue my application/i],
    },
    page1: {
      readyTexts: [/program choice/i, /personal information/i],
      programDropdowns: [
        { key: 'session', labels: ['Start date'], fallbackIndex: 0, required: true },
        { key: 'campus', labels: ['Campus'], fallbackIndex: 1, required: true },
        { key: 'niveau_admission', labels: ['Level of studies you are applying for'], fallbackIndex: 2, required: true },
        { key: 'programme', labels: ['Program'], fallbackIndex: 3, required: true },
        { key: 'pays', labels: ['Country of residence'], fallbackIndex: 4, required: false },
        { key: 'nationalite', labels: ['Nationality'], fallbackIndex: 5, required: false },
      ],
      personal: {
        nom: ['Birth name'],
        prenom: ['First name'],
        email: ['Email'],
        emailConfirm: ['Confirm your email address'],
        phone: ['Phone number', 'Phone', 'Mobile'],
        country: ['Country of residence'],
        nationality: ['Nationality'],
        parentEmail: [],
        parentEmailConfirm: [],
        parentPhone: [],
        extraFields: [
          { labels: ['Country of Citizenship', 'Country of birth'], key: 'birth_country', type: 'dropdown', defaultValue: 'France' },
          { labels: ['City of birth'], key: 'birth_city', type: 'text', defaultValue: 'Paris' },
        ],
      },
      page2ReadyTexts: [
        /my application\s*2\s*\/\s*4/i,
        /ma candidature\s*2\s*\/\s*4/i,
        /my application\s*2\/4\s*:\s*studies/i,
      ],
    },
    page2: {
      ...baseProfile.page2,
      readyTexts: [
        /my application\s*2\s*\/\s*4/i,
        /ma candidature\s*2\s*\/\s*4/i,
        /my application\s*2\/4\s*:\s*studies/i,
      ],
      sectionLabels: {
        parcours: [/studies/i, /etudes/i],
        session: [/admission session/i, /session d'admission/i, /session/i],
        documents: [/documents?/i, /attachments?/i, /pi[eè]ces jointes/i],
      },
      parcoursFields: STANDARD_PAGE2_FIELDS,
      sessionFields: [],
      page3ReadyTexts: [
        /my application\s*3\s*\/\s*4/i,
        /ma candidature\s*3\s*\/\s*4/i,
        /summary/i,
        /validate my information/i,
        /valider mes informations/i,
      ],
    },
    page3: {
      readyTexts: [
        /my application\s*3\s*\/\s*4/i,
        /ma candidature\s*3\s*\/\s*4/i,
        /summary/i,
        /validate my information/i,
      ],
      submitButtons: ['Validate my information', 'Validate', 'Valider mes informations', 'Valider'],
      page4ReadyTexts: [
        /my application\s*4\s*\/\s*4/i,
        /ma candidature\s*4\s*\/\s*4/i,
        /choose your payment method/i,
        /application fees/i,
      ],
    },
    page4: {
      readyTexts: [
        /my application\s*4\s*\/\s*4/i,
        /ma candidature\s*4\s*\/\s*4/i,
        /choose your payment method/i,
        /application fees/i,
      ],
      completionReadyTexts: [/your application has been sent/i, /thank you for your application/i, /f[eé]licitations/i],
    },
  },
  'fr-international-payment': {
    ...baseProfile,
    id: 'fr-international-payment',
    label: 'Tunnel international OMNES',
    structureGroup: STRUCTURE_GROUPS.INTERNATIONAL_PAYMENT_4_PAGES,
    page1: {
      ...baseProfile.page1,
      readyTexts: [/program choice/i, /personal information/i, /choix du programme/i],
      programDropdowns: [
        { key: 'session', labels: ['Start date', 'Session de rentree'], fallbackIndex: 0, required: true },
        { key: 'campus', labels: ['Campus'], fallbackIndex: 1, required: true },
        { key: 'niveau_admission', labels: ['Level of studies you are applying for', "Niveau d'admission"], fallbackIndex: 2, required: true },
        { key: 'program_language', labels: ['Language of program', 'Langue du programme'], fallbackIndex: 3, required: true, defaultValue: '__RANDOM__', preferIndex: true },
        { key: 'program_school', labels: ['School', 'Ecole'], fallbackIndex: 4, required: true, defaultValue: '__RANDOM__', preferIndex: true },
        { key: 'programme', labels: ['Program', 'Programme', 'Nom du programme'], fallbackIndex: 5, required: true, defaultValue: '__RANDOM__', preferIndex: true },
        { key: 'nationalite', labels: ['Nationality', 'Nationalite'], fallbackIndex: 6, required: false },
        { key: 'pays', labels: ['Country of residence', 'Pays de residence'], fallbackIndex: 7, required: false },
      ],
      personal: {
        nom: ['Birth name', 'Nom de naissance'],
        prenom: ['First name', 'Prenom', 'Prénom'],
        email: ['Email'],
        emailConfirm: ['Confirmez votre adresse email', 'Confirm your email address', 'Confirm your email'],
        phone: ['Phone', 'Phone number', 'Telephone', 'Téléphone', 'Numero de telephone'],
        country: ['Country of residence', 'Pays de residence'],
        nationality: ['Nationality', 'Nationalite', 'Nationalité'],
        parentEmail: [],
        parentEmailConfirm: [],
        parentPhone: [],
        extraFields: [
          { labels: ['Current address', 'Address'], key: 'current_address', type: 'text', defaultValue: 'Paris' },
          { labels: ['Country of Citizenship', 'Country of birth', 'Pays de naissance', 'Country of residence'], key: 'birth_country', type: 'dropdown', defaultValue: 'France' },
          { labels: ['City of birth', 'Ville de naissance', 'Ville de residence'], key: 'birth_city', type: 'text', defaultValue: 'Paris' },
        ],
      },
    },
    page2: {
      ...baseProfile.page2,
      parcoursFields: INTERNATIONAL_PAGE2_FIELDS,
      sessionFields: [],
    },
    page3: {
      ...baseProfile.page3,
      reinjectUploadsBeforeSubmit: true,
      waitForSummaryValuesFromPage1: true,
    },
  },
};

function buildSchoolProfileMap() {
  const map = {};
  for (const campaign of Object.values(CAMPAIGNS || {})) {
    for (const school of campaign?.schools || []) {
      const profileId = normalizeSlug(school.profileId || school.formProfile || school.journeyGroup);
      if (!profileId || !PROFILES[profileId]) continue;

      const keys = [school.slug, ...(Array.isArray(school.aliases) ? school.aliases : [])]
        .map((value) => normalizeSlug(value))
        .filter(Boolean);

      for (const key of keys) {
        map[key] = profileId;
      }
    }
  }
  return map;
}

const SCHOOL_PROFILE_MAP = buildSchoolProfileMap();

function getProfileIdForSchool(school = {}) {
  const explicit = normalizeSlug(school.profileId || school.formProfile || school.journeyGroup);
  if (explicit && PROFILES[explicit]) return explicit;
  const slug = normalizeSlug(school.slug);
  return SCHOOL_PROFILE_MAP[slug] || 'fr-standard-payment';
}

function resolveSchoolProfile(school = {}) {
  const profileId = getProfileIdForSchool(school);
  const profile = PROFILES[profileId] || PROFILES['fr-standard-payment'];
  return {
    ...profile,
    id: profileId,
    structureGroup: school.structureGroup || profile.structureGroup || '',
  };
}

module.exports = {
  PROFILES,
  SCHOOL_PROFILE_MAP,
  getProfileIdForSchool,
  resolveSchoolProfile,
};
