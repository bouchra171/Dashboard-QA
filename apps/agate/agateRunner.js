async function runAgate(executionPlan) {
  return {
    application: 'agate',
    status: 'Bloque',
    lastStep: 'Non implemente',
    error: `Runner Agate non branche pour le scenario ${executionPlan.scenarioId}.`,
    evidence: {},
  };
}

module.exports = {
  runAgate,
};
