async function runEudonet(executionPlan) {
  return {
    application: 'eudonet',
    status: 'Bloque',
    lastStep: 'Non implemente',
    error: `Runner Eudonet non branche pour le scenario ${executionPlan.scenarioId}.`,
    evidence: {},
  };
}

module.exports = {
  runEudonet,
};
