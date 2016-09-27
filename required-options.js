var debug = require('debug')('webhook-migrate:required-options');
// Ensures the options passed into the function
// or CLI have the required properties
module.exports = function (options, failure) {
  var requiredOptions = [
    'migrateFrom',
    'pathToRead',
    'pathToWrite',
    'uploadUrl',
    'siteName',
    'secretKey',
  ];
  return requiredOptions.map(function (requiredOption) {
      return { key: requiredOption, value: options[requiredOption] }; })
    .filter(function (option) {
      try {
        return option.value.length > 0;
      }
      catch (e) {
        failure(option.key);
        process.exit(0);
      }
    })
    .reduce(function (a, b) { a[b.key] = b.value; return a; }, {});
}
