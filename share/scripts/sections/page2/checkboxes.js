module.exports = async function runPage2Checkboxes(ctx) {
  const { helpers, page } = ctx;
  const { pauseForReview, scrollToBottom, checkCheckboxByLabelText, checkAllVisibleCheckboxes } = helpers;

  await pauseForReview('Page 2/4');
  await scrollToBottom(page);
  await checkCheckboxByLabelText(page, /je certifie|exactitude|i certify|accuracy/i);
  await checkCheckboxByLabelText(page, /j'accepte|accepte|i agree|consent/i);
  await checkAllVisibleCheckboxes(page, false);
};
