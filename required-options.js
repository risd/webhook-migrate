var debug = require('debug')('webhook-migrate:required-options');
// Ensures the options passed into the function
// or CLI have the required properties
module.exports = function (options, failure) {
  var requiredOptions = [
    'migrated',
    'migrateFrom',
    'uploadUrl',
    'siteName',
    'secretKey',
  ];
  var optionals = [
    'requests',
  ];

  var optionsToKeyValue = keyValueMapForObject(options);
  var aggregateKeyValues =
    function (a, b) { a[b.key] = b.value; return a; }

  return requiredOptions.map(optionsToKeyValue)
    .filter(function (option) {
      try {
        return option.value.length > 0;
      }
      catch (err) {
        failOn(option.key);
      }
    })
    .concat(optionals
      .map(optionsToKeyValue)
      .filter(function optional (option) {
        try {
          return option.value.length > 0;
        }
        catch (err) {
          return false;
        }
      }))
    .reduce(aggregateKeyValues, {});
  
  function keyValueMapForObject (object) {
    return function (key) {
      return { key: key, value: object[key] };
    }
  }

  function failOn (key) {
    failure(key);
    process.exit(0)
  }
}
