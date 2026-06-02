function normalizeAnomaly(scenario) {
  const text = `${scenario.erreurTechnique || ''} ${scenario.nomScenarioSquash || ''}`.toLowerCase();

  if (/paiement|payment|paytweak|mercanet|card|cb|payment-link/.test(text)) {
    return {
      titre: "Impossible d'accéder au paiement",
      page: 'Page 4 - Paiement',
      fonctionnalite: 'Paiement',
      description: "Le candidat ne peut pas accéder au paiement après validation du parcours.",
      keywords: ['paiement', 'carte bancaire', 'Mercanet', 'Paytweak'],
    };
  }

  if (/document|pi[eè]ce|pj|upload|attachment/.test(text)) {
    return {
      titre: 'Pièces jointes non validées',
      page: 'Page 2 - Documents',
      fonctionnalite: 'Documents',
      description: 'Le candidat ne peut pas valider les pièces justificatives du parcours.',
      keywords: ['documents', 'pièces jointes', 'upload', 'PJ'],
    };
  }

  if (/recap|r[eé]capitulatif/.test(text)) {
    return {
      titre: 'Blocage au récapitulatif',
      page: 'Page 3 - Récapitulatif',
      fonctionnalite: 'Récapitulatif',
      description: 'Le candidat ne peut pas valider le récapitulatif avant la suite du parcours.',
      keywords: ['récapitulatif', 'validation'],
    };
  }

  return {
    titre: 'Anomalie fonctionnelle à analyser',
    page: scenario.page || 'Parcours complet',
    fonctionnalite: 'Candidature',
    description: scenario.erreurTechnique || 'Le scénario est en échec et nécessite une analyse fonctionnelle.',
    keywords: scenario.tags || [],
  };
}

module.exports = {
  normalizeAnomaly,
};
