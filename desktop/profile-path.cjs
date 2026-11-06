const path = require('node:path');
function profileDirectory(home, environment) {
  if (environment.CADENCE_QA === '1' && !environment.CADENCE_DATA_DIR) throw new Error('QA requires an isolated CADENCE_DATA_DIR.');
  return path.resolve(environment.CADENCE_DATA_DIR || path.join(home, 'CadenceReaderData'));
}
module.exports = { profileDirectory };
