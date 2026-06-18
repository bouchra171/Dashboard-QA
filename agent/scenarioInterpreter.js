const fs = require('fs');
const path = require('path');

const { projectRoot } = require('./config');

const SCHOOL_MAP = [
  { school: 'INSEEC Bachelor', slug: 'bachelorsinseec', aliases: ['inseec bachelor', 'bachelor inseec'] },
  { school: 'INSEEC MSC', slug: 'mastersinseec', aliases: ['inseec msc', 'msc inseec', 'masters inseec'] },
  { school: 'INSEEC BBA', slug: 'inseecbba', aliases: ['inseec bba', 'bba inseec'] },
  { school: 'INTERNATIONAL', slug: 'international', aliases: ['international'] },
  { school: 'IUM Monaco', slug: 'ium', aliases: ['ium', 'monaco'] },
  { school: 'ECE', slug: 'ece', aliases: ['ece'] },
  { school: 'HEIP', slug: 'heip', aliases: ['heip'] },
  { school: 'SUP DE PUB', slug: 'supdepub', aliases: ['sup de pub', 'supdepub'] },
  { school: 'INSEEC Grande Ecole', slug: 'isbe', aliases: ['inseec grande ecole', 'grande ecole'] },
  { school: 'INSEEC BTS', slug: 'inseecbts', aliases: ['inseec bts', 'bts'] },
];

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&rsquo;/g, "'")
    .replace(/&ldquo;/g, '"')
    .replace(/&rdquo;/g, '"')
    .replace(/&laquo;/g, '"')
    .replace(/&raquo;/g, '"')
    .replace(/&eacute;/g, 'e')
    .replace(/&Eacute;/g, 'E')
    .replace(/&egrave;/g, 'e')
    .replace(/&agrave;/g, 'a')
    .replace(/\s+/g, ' ')
    .trim();
}

function loadMapping() {
  const mappingPath = path.join(projectRoot, 'mapping', 'squash-playwright-map.json');
  try {
    if (!fs.existsSync(mappingPath)) return {};
    return JSON.parse(fs.readFileSync(mappingPath, 'utf8'));
  } catch {
    return {};
  }
}

function detectSchool(text, explicitSchool = '') {
  if (explicitSchool) {
    const mapped = SCHOOL_MAP.find((entry) => entry.school === explicitSchool);
    if (mapped) return mapped;
  }

  const normalized = normalizeText(text);
  return SCHOOL_MAP.find((entry) => entry.aliases.some((alias) => normalized.includes(alias))) || null;
}

function detectApplication(text) {
  const normalized = normalizeText(text);
  if (/eudonet/.test(normalized)) return 'eudonet';
  if (/iris|pedagogique/.test(normalized)) return 'iris';
  if (/ypareo|contrat|alternance/.test(normalized)) return 'ypareo';
  return 'newform';
}

function detectCandidateType(text) {
  const normalized = normalizeText(text);
  if (/etudiant omnes|etudiant.*omnes|student.*omnes/.test(normalized)) return 'etudiant-omnes';
  if (/boursier|scholarship/.test(normalized)) return 'boursier';
  if (/prospect/.test(normalized)) return 'prospect';
  return 'standard';
}

function detectPaymentIntent(text, candidateType) {
  const normalized = normalizeText(text);
  if (/ne pas.*payer|ne pas.*regler|sans.*payer|sans.*regler|pas avoir.*regler/.test(normalized)) return false;
  if (candidateType === 'etudiant-omnes' || candidateType === 'boursier') return false;
  if (/carte bancaire|\bcb\b|paypal|payer|regler|frais de candidature|payment|paiement/.test(normalized)) return true;
  return null;
}

function uniq(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const text = String(value || '').trim();
    const key = normalizeText(text);
    if (!text || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

function extractOmnesChoiceTexts(text) {
  const raw = String(text || '');
  const choices = [];
  const quotePattern = /["\u201c\u201d\u00ab\u00bb]([^"\u201c\u201d\u00ab\u00bb]*omnes[^"\u201c\u201d\u00ab\u00bb]*)["\u201c\u201d\u00ab\u00bb]/gi;
  let match = quotePattern.exec(raw);
  while (match) {
    const choice = String(match[1] || '').trim();
    if (choice.length <= 80 && /je suis/i.test(choice)) choices.push(choice);
    match = quotePattern.exec(raw);
  }
  if (/je suis deja etudiant.*omnes/.test(normalizeText(raw))) {
    choices.push('Je suis d\u00e9j\u00e0 \u00e9tudiant OMNES');
  }
  return choices;
}

function buildNewformStartConfig(candidateType, text) {
  if (candidateType === 'etudiant-omnes') {
    const choiceTexts = uniq([
      ...extractOmnesChoiceTexts(text),
      'Je suis d\u00e9j\u00e0 \u00e9tudiant OMNES',
      'Je suis d\u00e9j\u00e0 \u00e9tudiant Omnes',
      'Je suis deja etudiant OMNES',
      'Je suis etudiant Omnes',
      'Je suis \u00e9tudiant Omnes',
      'Etudiant Omnes',
      '\u00c9tudiant Omnes',
      'Je suis deja etudiant Omnes',
    ]);
    return {
      preStartChoiceTexts: choiceTexts,
      page1ChoiceTexts: choiceTexts,
    };
  }

  if (candidateType === 'boursier') {
    return {
      preStartChoiceTexts: [
        'Je suis boursier',
        'Etudiant boursier',
        '\u00c9tudiant boursier',
        'Je suis etudiant boursier',
        'Je suis \u00e9tudiant boursier',
      ],
    };
  }

  return null;
}

function getScenarioText(scenario) {
  const requestedSteps = scenario.squashInstructions?.requestedSteps || [];
  const detailedSteps = scenario.squashInstructions?.detailedSteps || [];
  return [
    scenario.nomScenarioSquash,
    scenario.campagne,
    scenario.description ? stripHtml(scenario.description) : '',
    ...requestedSteps.map((step) => `${step.reference || ''} ${step.name || ''}`),
    ...requestedSteps.flatMap((step) => (step.testSteps || []).map((testStep) => `${testStep.action || ''} ${testStep.expectedResult || ''}`)),
    ...detailedSteps.map((step) => `${step.action || ''} ${step.expectedResult || ''}`),
  ].join(' ');
}

function interpretScenario(scenario) {
  const text = getScenarioText(scenario);
  const school = detectSchool(text, scenario.ecole);
  const mapping = loadMapping();
  const mappingEntry = school ? mapping[school.school] : null;
  const application = detectApplication(text);
  const candidateType = detectCandidateType(text);
  const expectedPayment = typeof scenario.expectedPayment === 'boolean'
    ? scenario.expectedPayment
    : detectPaymentIntent(text, candidateType);

  const apps = application === 'newform' ? ['newform'] : ['newform', application];

  return {
    scenarioId: scenario.idScenarioSquash,
    scenarioName: scenario.nomScenarioSquash,
    campaignName: scenario.campagne,
    lot: scenario.lot,
    environment: scenario.environment,
    sourceStatus: scenario.statutSquash,
    target: {
      application,
      apps,
      schoolLabel: school?.school || scenario.ecole || '',
      schoolSlug: mappingEntry?.schoolSlug || school?.slug || '',
      candidateType,
      expectedPayment,
      startConfig: buildNewformStartConfig(candidateType, text),
    },
    squashInstructions: scenario.squashInstructions || null,
    rawScenario: scenario,
  };
}

function detectManualActions(text) {
  const normalized = normalizeText(text);
  const hasDocuments = /pj|piece|pieces|document|justificatif|upload|telechargement|lien/.test(normalized);
  const hasReplace = /remplac|modifier|changer|nouvelle/.test(normalized);
  const hasEudonet = /eudonet|crm|fiche candidat/.test(normalized);
  const hasStep2 = /etape\s*0?2|page\s*2|2\s*\/\s*4|deuxieme etape/.test(normalized);
  const checkpoints = [];

  if (hasEudonet && hasDocuments) {
    if (/avant.*valid|upload|depos/.test(normalized)) {
      checkpoints.push({ id: 'documents-uploaded-before-validation', label: 'apres depot initial des documents' });
    }
    if (hasReplace) {
      checkpoints.push({ id: 'documents-replaced-before-validation', label: 'apres remplacement des documents' });
    }
    if (/apres.*valid|passage.*etape\s*0?3|etape\s*0?3|page\s*3/.test(normalized)) {
      checkpoints.push({ id: 'documents-after-step-validation', label: 'apres validation de l etape 02' });
    }
  }

  return {
    uploadDocuments: hasDocuments,
    replaceDocument: hasDocuments && hasReplace,
    validateStep2: hasStep2 || hasDocuments,
    checkEudonet: hasEudonet,
    verifyDownloadLinks: /lien|telecharg|download|fonctionnel|ko/.test(normalized),
    checkpoints,
  };
}

function interpretFreeformScenario(config = {}) {
  const manual = config.manualScenario || {};
  const text = [
    config.scenario,
    manual.title,
    manual.description,
    manual.dataToUse,
    manual.comment,
    config.customScenario,
  ].filter(Boolean).join(' ');
  const school = detectSchool(text, config.school);
  const application = detectApplication(text);
  const candidateType = detectCandidateType(text);
  const expectedPayment = detectPaymentIntent(text, candidateType);
  const actions = detectManualActions(text);
  const apps = actions.checkEudonet || application === 'eudonet'
    ? ['newform', 'eudonet']
    : ['newform'];

  return {
    source: 'manual',
    scenarioId: `manual-${Date.now()}`,
    scenarioName: manual.title || config.scenario || 'Scenario personnalise',
    campaignName: 'Scenario personnalise',
    environment: config.environment || '',
    target: {
      application: actions.checkEudonet ? 'eudonet' : application,
      apps,
      schoolLabel: school?.school || config.school || '',
      schoolSlug: school?.slug || config.schoolSlug || '',
      candidateType,
      expectedPayment,
      startConfig: buildNewformStartConfig(candidateType, text),
    },
    manualInstructions: {
      title: manual.title || config.scenario || '',
      description: manual.description || '',
      dataToUse: manual.dataToUse || '',
      comment: manual.comment || '',
      rawText: text,
      actions,
    },
    rawScenario: config,
  };
}

module.exports = {
  interpretScenario,
  interpretFreeformScenario,
  normalizeText,
};
