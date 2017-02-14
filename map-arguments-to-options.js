var debug = require('debug')('webhook-migrate:map-arguments-to-options');
var extend = require('xtend');
var fs = require('fs');

var help = require('./cli-help.js')

// Given an array of arguments (process.argv)
// Return an options object

module.exports = mapArgumentsToOptions;

// [] => {}
function mapArgumentsToOptions (arguments) {
  var parsedArgs = require('minimist')(arguments.slice(2));

  var positionalArguments = parsedArgs._
    .map(function(arg, position) {
      if (position === 0) return { backup: readJson(arg) };
      if (position === 1) return { migrated: arg };
      else throw new Error(help());
    })
    .reduce(function (last, current) { return extend(last, current); }, {});
 
  // removes positional arguments,
  // since they are not consumed as an array
  delete parsedArgs._;

  parsedArgs = renameProperty(parsedArgs, 'from', 'migrateFrom');
  parsedArgs = renameProperty(parsedArgs, 'url', 'uploadUrl');

  debug('parsedArgs')
  debug(parsedArgs)

  return extend(parsedArgs, positionalArguments,
    (typeof parsedArgs.requests === 'string'
      ? { requests: readJson(parsedArgs.requests) }
      : { requests: undefined }));
}

function renameProperty (object, last, current) {
  if (last in object) {
    object[current] = object[last];
    delete object[last];
  }
  return extend({}, object);
}

function readJson (path) {
  return JSON.parse(stripBom(fs.readFileSync(path)));
}

function writeJsonToPath (path, data) {
  fs.writeFileSync(path, JSON.stringify(data, null, 2));
}

function stripBom (content) {
  // we do this because JSON.parse would convert it to a utf8 string if encoding wasn't specified
  if (Buffer.isBuffer(content)) content = content.toString('utf8')
  content = content.replace(/^\uFEFF/, '')
  return content
}
