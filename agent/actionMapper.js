const { normalizeText } = require('./scenarioInterpreter');

const ACTIONS = [
  {
    id: 'open_newform',
    label: 'Ouvrir le formulaire NewForm',
    patterns: [/ouvrir.*(newform|formulaire|candidature)/, /\bformulaire\b/, /\bmsc\b/, /\bbachelor\b/],
    flags: {},
  },
  {
    id: 'create_candidate_unique',
    label: 'Creer un candidat avec un email unique',
    patterns: [/creer|generer|preparer/, /candidat/, /email unique|mail unique|adresse email unique/],
    matchAll: true,
    flags: { createCandidate: true, uniqueEmail: true },
  },
  {
    id: 'complete_until_step2',
    label: "Remplir le parcours NewForm jusqu'a l'etape 2",
    patterns: [/remplir|completer|executer/, /parcours|newform|formulaire/, /jusqu.*etape\s*0?2|jusqu.*.tape\s*0?2|jusqu.*page\s*2/],
    matchAll: true,
    flags: { createCandidate: true, uniqueEmail: true },
  },
  {
    id: 'complete_step1',
    label: "Completer l'etape 1",
    patterns: [/etape\s*0?1/, /.tape\s*0?1/, /page\s*1/, /informations personnelles/, /valider.*1/, /validation.*1/],
    flags: {},
  },
  {
    id: 'navigate_step2',
    label: "Aller a l'etape 2",
    patterns: [/aller.*etape\s*0?2|aller.*.tape\s*0?2|aller.*page\s*2/],
    flags: {},
  },
  {
    id: 'check_eudonet_documents_replaced',
    label: 'Controler dans Eudonet la PJ remplacee',
    patterns: [/eudonet/, /nouvelle|remplac|modifier|changer/],
    matchAll: true,
    flags: {
      checkEudonet: true,
      verifyDownloadLinks: true,
      checkpoint: { id: 'documents-replaced-before-validation', label: 'apres remplacement des documents' },
    },
  },
  {
    id: 'replace_document_step2',
    label: "Remplacer une PJ deja deposee",
    patterns: [/remplac|changer|modifier|nouvelle/, /pj|piece|document|fichier/],
    matchAll: true,
    flags: {
      uploadDocuments: true,
      replaceDocument: true,
      checkpoint: { id: 'documents-replaced-before-validation', label: 'apres remplacement des documents' },
    },
  },
  {
    id: 'check_eudonet_documents_initial',
    label: 'Controler les PJ dans Eudonet',
    patterns: [/eudonet/, /pj|piece|document|lien|telecharg|controle|checker|verifier|remont/],
    matchAll: true,
    flags: {
      checkEudonet: true,
      verifyDownloadLinks: true,
      checkpoint: { id: 'documents-uploaded-before-validation', label: 'apres depot initial des documents' },
    },
  },
  {
    id: 'upload_documents_step2',
    label: "Uploader les PJ obligatoires a l'etape 2",
    patterns: [/upload|depos|televers|charger/, /pj|piece|document|justificatif/],
    matchAll: true,
    flags: { uploadDocuments: true, validateStep2: false },
  },
  {
    id: 'validate_step2',
    label: "Valider l'etape 2 et passer a l'etape 3",
    patterns: [/valid.*etape\s*0?2|valid.*.tape\s*0?2|valid.*page\s*2|validation.*etape\s*0?2|validation.*.tape\s*0?2|validation.*page\s*2|passer.*etape\s*0?3|passer.*.tape\s*0?3|passage.*etape\s*0?3|passage.*.tape\s*0?3/],
    flags: { validateStep2: true },
  },
  {
    id: 'navigate_step3',
    label: "Aller a l'etape 3",
    patterns: [/aller.*etape\s*0?3|aller.*.tape\s*0?3|aller.*page\s*3/],
    flags: {},
  },
  {
    id: 'modify_personal_info_step3',
    label: "Modifier une information personnelle avant validation finale",
    patterns: [/modifi|changer|mettre a jour|corriger/, /information personnelle|telephone|adresse|address|phone|candidat/],
    matchAll: true,
    flags: { modifyPersonalInfo: true },
  },
  {
    id: 'validate_step3',
    label: "Valider l'etape 3 et aller au paiement ou a la validation finale",
    patterns: [/valid.*etape\s*0?3|valid.*.tape\s*0?3|valid.*page\s*3|validation.*etape\s*0?3|validation.*.tape\s*0?3|validation.*page\s*3|valider.*information|validation.*information|confirmer.*information|aller.*paiement|validation finale/],
    flags: { validateStep3: true },
  },
  {
    id: 'check_eudonet_documents_after_step2',
    label: "Controler Eudonet apres validation de l'etape 2",
    patterns: [/eudonet|nouveau controle|a nouveau/, /apres.*valid|passage.*etape\s*0?3|passage.*.tape\s*0?3|etape\s*0?3|.tape\s*0?3|page\s*3|a nouveau|nouveau controle|lien.*ko/],
    matchAll: true,
    flags: {
      checkEudonet: true,
      verifyDownloadLinks: true,
      checkpoint: { id: 'documents-after-step2-validation', label: 'apres validation de l etape 02' },
    },
  },
  {
    id: 'generate_report',
    label: 'Generer le rapport',
    patterns: [/rapport|preuve|capture/],
    flags: {},
  },
];

function matchesAction(action, text) {
  const normalized = normalizeText(text);
  if (!action.patterns.length) return false;
  return action.matchAll
    ? action.patterns.every((pattern) => pattern.test(normalized))
    : action.patterns.some((pattern) => pattern.test(normalized));
}

function mapStepToAction(step) {
  const action = ACTIONS.find((candidate) => matchesAction(candidate, step.text));
  if (!action) {
    return {
      ...step,
      supported: false,
      actionId: 'unsupported',
      actionLabel: 'Etape non supportee',
      reason: "Aucune action connue ne correspond a cette etape.",
      flags: {},
    };
  }
  return {
    ...step,
    supported: true,
    actionId: action.id,
    actionLabel: action.label,
    reason: '',
    flags: action.flags || {},
  };
}

function mapStepsToActions(steps) {
  return steps.map(mapStepToAction);
}

module.exports = {
  ACTIONS,
  mapStepToAction,
  mapStepsToActions,
};
