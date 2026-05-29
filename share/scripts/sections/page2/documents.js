module.exports = async function runDocumentsSection(ctx) {
  const { sectionDocuments, p2, dataRoot, helpers } = ctx;
  const { fillDocumentsSection } = helpers;

  console.log('[INFO] Attente du chargement des champs pièces jointes...');
  try {
    await sectionDocuments.locator('button:has-text("Importer")').first().waitFor({ timeout: 8000 });
  } catch {
    // ignore
  }
  await fillDocumentsSection(ctx.page, p2.attachments, dataRoot);
};
