var debug = require('debug')('webhook-migrate:map-arguments-to-options');
var extend = require('xtend');

var help = require('./cli-help.js')

// Given an array of arguments (process.argv)
// Return an options object

module.exports = mapArgumentsToOptions;

// [] => {}
function mapArgumentsToOptions (arguments) {
  var parsedArgs = require('minimist')(arguments.slice(2));
  var positionalArguments = parsedArgs._
    .map(function(arg, position) {
      if (position === 0) return { pathToRead: arg };
      if (position === 1) return { pathToWrite: arg };
      else throw new Error(help());
    })
    .reduce(function (last, current) { return extend(last, current); }, {});
 
  // removes positional arguments,
  // since they are not consumed as an array
  delete parsedArgs._;

  parsedArgs = renameProperty(parsedArgs, 'from', 'migrateFrom');
  parsedArgs = renameProperty(parsedArgs, 'url', 'uploadUrl');

  return extend(parsedArgs, positionalArguments);
}

function renameProperty (object, last, current) {
  if (last in object) {
    object[current] = object[last];
    delete object[last];
  }
  return extend({}, object);
}