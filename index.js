'use strict';

var debug = require('debug')('webhook-migrate');
var fs = require('fs');
var extend = require('xtend');
var request = require('request');
var cheerio = require('cheerio');
var miss = require('mississippi');

var requiredOptions = require('./required-options.js');

module.exports = Migrate;
module.exports.requiredOptions = requiredOptions;
module.exports.mapArgumentsToOptions = require('./map-arguments-to-options.js');


/**
 * Migrate
 * Requires a `backup` object in the shape of a webhook backup.
 * The `backup` is examined for all of its uploaded files.
 * Each file is migrated over to the new bucket. Images are
 * passed through the webhook server, in order to generate
 * a webhook image object (`{ resize_url, url, width, height }`).
 * The migrated files are then put back into the original backup
 * file. The callback is called 
 * Copies all /webhook-uploads/ from a webhook site bucket
 * and moves them to another.
 * 
 * Optionally writes to a file on complete
 *
 * @param {object}     backup    `{ controlType: {}, data: {} }`
 * @param {object}     opts      An object that conforms to the shape
 *                               defined in `required-options.js`
 * @param {function?}  callback  Optional function to call at the end of
 *                               the migration, with the updated backup
 *                               object
 */

function Migrate (backup, opts, callback) {
  if (!(this instanceof Migrate)) return new Migrate(backup, opts, callback);
  if (typeof callback !== 'function') callback = function noop () {}

  /* Options */
  /* ----------------------------------------- */

  var options = requiredOptions(opts, function failure (missingKey) {
      callback(new Error('Missing option: ' + missingKey))
    });
  
  debug('options');
  debug(options);


  /* Make requests */
  /* ----------------------------------------- */

  if (Array.isArray(options.requests)) {
    var requests = options.requests;
  }
  else {
    var imageDataToMigrate = imagePlucker(controlPlucker('image'))
      .concat(imagePlucker(controlPlucker('file')))
      .concat(imagePlucker(controlPlucker('audio')))
      .concat(imagePlucker(controlPlucker('gallery')));

    var imageRequests = extendImageWithRequests(imageDataToMigrate);

    var htmlRequests = extendHtmlWithRequests(htmlPlucker(controlPlucker('wysiwyg')));
    
    var requests = imageRequests.concat(htmlRequests);
  }

  debug(requests.length + ' file requests to process');

  /* Process data */
  /* ----------------------------------------- */
  
  processRequests(
    requests,
    function mapResponse (responseItems) {

      var errorResponseItems = responseItems
        .filter(itemWithKey('errorBody'));
      var imageResponseItems = responseItems
        .filter(itemWithKey('responseBody'))
        .filter(itemWithKey('image'));
      var htmlResponseItems = responseItems
        .filter(itemWithKey('responseBody'))
        .filter(itemWithKey('html'));

      // Updates `backup` object in place using the response
      mapImageResponses(imageResponseItems);
      mapHtmlResponses(htmlResponseItems);

      // Writes `backup` object
      writeJsonToPath(options.migrated, backup);
      writeJsonToPath(options.migrated + '.errors', errorResponseItems);

      debug(responseItems.length + ' requests processed');
      debug(errorResponseItems.length + ' requests errored');
      debug('data written to: ' + options.migrated);
      debug('errors written to: ' + options.migrated + '.errors');

      var errorResponse = errorResponseItems.length === 0
        ? null
        : errorResponseItems;

      callback(errorResponse, backup);
    });


  /* Helpers */
  /* ----------------------------------------- */

  // [{ image, key, requestBody, responseBody }] => [{ key }]
  // Use the response data to update the value at key
  // in backup. Return a list of keys that have
  // been updated.
  function mapImageResponses (imageResponseItems) {
    // modify backup
    imageResponseItems.forEach(function (imageResponseItem) {
      valueForKeypath(
        backup,
        imageResponseItem.key,
        extend(
          valueForKeypath(backup, imageResponseItem.key),
          {
            url: imageResponseItem.responseBody.url,
            resize_url: imageResponseItem.responseBody.resize_url
          })
        )
    });
  }

  // [{ html, key, requestBody, responseBody }] => [{ key }]
  // Use the response data to update the value at key
  // in backup. Return a list of keys that have
  // been updated.
  function mapHtmlResponses (htmlResponseItems) {
    // modify backup
    htmlResponseItems.forEach(function (htmlResponseItem) {
      var imageIndex = htmlResponseItem.key.slice(-1)[0];
      var html = valueForKeypath(backup,
        htmlResponseItem.key.slice(0, -1)
      );

      // replace image 
      var $ = cheerio.load(html);
      $('figure[data-type="image"]').each(function (i, el) {
        if (i === imageIndex) {
          $(el).find('a').attr('href', htmlResponseItem.responseBody.url);
          $(el).find('img').attr('data-resize-src', htmlResponseItem.responseBody.resize_url);
          // preserve the resize attribute
          var imgSrc = $(el).find('img').attr('src');
          if (!imgSrc) {
            console.error('Empty image source: ', htmlResponseItem.key);
            return;
          }
          var imgSrcSplit = imgSrc.split('=s')
          var newSrc = htmlResponseItem.responseBody.resize_url;
          if (imgSrcSplit.length === 2) {
            newSrc = [htmlResponseItem.responseBody.resize_url, imgSrcSplit[1]].join('=s');
          }
          $(el).find('img').attr('src', newSrc);
        }
      })

      valueForKeypath(backup,
        htmlResponseItem.key.slice(0, -1),
        $.html()
      );
    });
  }  

  function htmlPlucker (pluckedControls) {
    return dataItems()
      .filter(filterPluckedControls(pluckedControls))
      .map(function (itemKey) {
        return {
          html: valueForKeypath(backup, itemKey),
          key: itemKey
        }
      })
  }

  // [{ controlType, contentType, oneOff, key<[<String>,]> }] =>
  //   [{ image: { resize_url, url }, key: [<String>] }]
  function imagePlucker (pluckedControls) {
    return dataItems()
      .filter(filterPluckedControls(pluckedControls))
      .map(function (itemKey) {
        return {
          image: {
            resize_url: valueForKeypath(backup, itemKey.concat(['resize_url'])),
            url: valueForKeypath(backup, itemKey.concat(['url'])),
          },
          key: itemKey
        }
      });
  }

  // key paths to uploaded data items to migrate
  // these items will have a url, and maybe a resize url
  // () => [
  //   ['data', contentType, itemKey, controlKey, gridIndex, gridControl, galleryIndex],
  //   ['data', contentType, itemKey, controlKey, gridIndex, gridControl],
  //   ['data', contentType, itemKey, controlKey, galleryIndex],
  //   ['data', contentType, itemKey, controlKey],
  //   ['data', contentType, controlKey, gridIndex, gridControl, galleryIndex],
  //   ['data', contentType, controlKey, gridIndex, gridControl],
  //   ['data', contentType, controlKey, galleryIndex],
  //   ['data', contentType, controlKey],
  // ]
  function dataItems () {
    return Object.keys(valueForKeypath(backup, [ 'data' ]))
      .map(function (contentType) {
        if (valueForKeypath(backup, [ 'contentType', contentType, 'oneOff' ])) {
          return Object.keys(valueForKeypath(backup, [ 'data', contentType ]))
            .map(function (controlKey) {
              if (isGrid(contentType, controlKey)) {
                return (valueForKeypath(backup, [ 'data', contentType, controlKey ])
                  ? valueForKeypath(backup, [ 'data', contentType, controlKey ])
                      .map(function (gridRow, gridIndex) {
                        return Object.keys(gridRow).map(function (gridItem, gridItemIndex) {
                          return [ 'data', contentType, controlKey, gridIndex, gridItem ];
                        });
                      })
                      .reduce(function (a, b) { return a.concat(b) }, [])
                  : false);
              }
              else if(isGallery(contentType, controlKey)) {
                return (
                  valueForKeypath(backup, [ 'data', contentType, controlKey ])
                  ? valueForKeypath(backup, [ 'data', contentType, controlKey ])
                      .map(function (galleryItem, galleryItemIndex) {
                        return [ 'data', contentType, controlKey, galleryItemIndex ];
                      })
                  : false);
              }
              else {
                return [ 'data', contentType, controlKey ];
              }
            })
            .filter(function (itemKey) {
              return itemKey !== false;
            });
        }
        else {
          return Object.keys(valueForKeypath(backup, [ 'data', contentType ]))
            .map(function (itemKey) {
              return Object.keys(valueForKeypath(backup, [ 'data', contentType, itemKey ]))
                .map(function (controlKey) {
                  if (isGrid(contentType, controlKey)) {
                    return (
                      valueForKeypath(backup, [ 'data', contentType, itemKey, controlKey ])
                      ? valueForKeypath(backup, [ 'data', contentType, itemKey, controlKey ])
                          .map(function (gridRow, gridIndex) {
                            return Object.keys(gridRow).map(function (gridItem, gridItemIndex) {
                              if (isGallery(contentType, controlKey, gridItem)) {
                                return (
                                  valueForKeypath(backup,
                                    [ 'data', contentType, itemKey, controlKey, gridItemIndex, gridItem ])
                                  ? valueForKeypath(backup,
                                      [ 'data', contentType, itemKey, controlKey, gridItemIndex, gridItem ])
                                    .map(function (galleryItem, galleryItemIndex) {
                                      return [ 'data', contentType, itemKey, controlKey, gridItemIndex, gridItem, galleryItemIndex ]
                                    })
                                  : false )
                              }
                              else {
                                return [ 'data', contentType, itemKey, controlKey, gridIndex, gridItem ];
                              }
                            })
                            .filter(function (gridRow) {
                              return gridRow !== false;
                            })
                            .reduce(function (a, b) {
                              if (Array.isArray(b[0])) return a.concat(b);
                              else return a.concat([b]);
                            }, []);
                          })
                          .reduce(function (a, b) { return a.concat(b) }, [])
                      : false);
                  }
                  else if(isGallery(contentType, controlKey)) {
                    return (
                      valueForKeypath(backup, [ 'data', contentType, itemKey, controlKey ])
                      ? valueForKeypath(backup, [ 'data', contentType, itemKey, controlKey ])
                          .map(function (galleryItem, galleryItemIndex) {
                            return [ 'data', contentType, itemKey, controlKey, galleryItemIndex ];
                          })
                      : false);
                  }
                  else {
                    return [ 'data', contentType, itemKey, controlKey ];
                  }
                })
                .filter(function (itemKey) {
                  return itemKey !== false;
                })
                .reduce(function (a, b) {
                  if (Array.isArray(b[0])) return a.concat(b);
                  else return a.concat([b]);
                }, []);
            })
            .reduce(function (a, b) { return a.concat(b) }, []);
        }
      })
      .reduce(function (a, b) { return a.concat(b) }, []);
  }

  // (contentType<String>, controlKey<String>) => boolean
  function isGrid (contentType, controlKey) {
    return valueForKeypath(backup, [ 'contentType', contentType, 'controls' ])
      .filter(function (contentTypeControl) {
        return contentTypeControl.controlType === 'grid' &&
          contentTypeControl.name === controlKey;
      }).length > 0;
  }

  // (contentType<String>, controlKey<String>, gridKey<String?>) => boolean
  function isGallery (contentType, controlKey, gridKey) {
    if (arguments.length === 2)
     return valueForKeypath(backup, [ 'contentType', contentType, 'controls' ])
        .filter(function (contentTypeControl) {
          return contentTypeControl.controlType === 'gallery' &&
            contentTypeControl.name === controlKey;
        }).length > 0;
    else if (arguments.length === 3)
      return valueForKeypath(backup, [ 'contentType', contentType, 'controls' ])
        .filter(function (contentTypeControl) {
          return ((contentTypeControl.controlType === 'grid') &&
            (contentTypeControl.name === controlKey) &&
            (contentTypeControl.controls.filter(function (gridControl) {
              return gridControl.name === gridKey &&
                gridControl.controlType === 'gallery';
            }).length === 1)
          )
        }).length > 0;
  }

  // (contentType<String>, controlKey<String>, gridKey<String?>) => boolean
  function isWysiwyg (contentType, controlKey, gridKey) {
    if (arguments.length === 2)
     return valueForKeypath(backup, [ 'contentType', contentType, 'controls' ])
        .filter(function (contentTypeControl) {
          return contentTypeControl.controlType === 'wysiwyg' &&
            contentTypeControl.name === controlKey;
        }).length > 0;
    else if (arguments.length === 3)
      return valueForKeypath(backup, [ 'contentType', contentType, 'controls' ])
        .filter(function (contentTypeControl) {
          return ((contentTypeControl.controlType === 'grid') &&
            (contentTypeControl.name === controlKey) &&
            (contentTypeControl.controls.filter(function (gridControl) {
              return gridControl.name === gridKey &&
                gridControl.controlType === 'wysiwyg';
            }).length === 1)
          )
        }).length > 0;
  }

  // controlType'' => (contentType'', controlKey'', gridKey'') => boolean
  function isControlType (controlType) {
    return function (contentType, controlKey, gridKey) {
      // no grid key, check non grid control keys
      function filterControl (contentTypeControl) {
        return contentTypeControl.controlType === controlType &&
          contentTypeControl.name === controlKey;
      }

      // grid key is included, check for 
      function filterControlInGrid (contentTypeControl) {
        return ((contentTypeControl.controlType === 'grid') &&
          (contentTypeControl.name === controlKey) &&
          (contentTypeControl.controls.filter(function (gridControl) {
            return gridControl.name === gridKey &&
              gridControl.controlType === controlType;
          }).length === 1)
        )
      }

      if (arguments.length === 2) var filterFn = filterControl;
      if (arguments.length === 3) var filterFn = filterControlInGrid;

      return valueForKeypath(backup, [ 'contentType', contentType, 'controls' ])
          .filter(findFn).length > 0;
    }
  }

  // function of selectors to be run against
  // all data
  // controlType<String> =>
  //   [{ controlType, contentType, oneOff, key<[<String>,]> }]
  function controlPlucker (controlType) {
    return Object.keys(valueForKeypath(backup, ['contentType']))
      .map(function (contentType) {
        // top level keys
        return valueForKeypath(backup, ['contentType', contentType, 'controls'])
          .filter(function (control) {
            return control.controlType === controlType;
          })
          .map(function (control) {
            return {
              controlType: controlType,
              contentType: contentType,
              oneOff: valueForKeypath(backup, ['contentType', contentType, 'oneOff']),
              dataKey: [
                'data',
                contentType,
                valueForKeypath(backup, ['contentType', contentType, 'oneOff'])
                  ? false : '*',
                control.name,
                (controlType === 'gallery') ? '&' : false,
              ].filter(function (a) { return a !== false; })
            }
          })
          .concat(
            // grid level keys
            valueForKeypath(backup, ['contentType', contentType, 'controls'])
              .filter(function (control) {
                return control.controlType === 'grid';
              })
              // return controls with a reference to the
              // control name it is a child of
              .map(function (control) {
                return control.controls
                  .filter(function (control) {
                    return control.controlType === controlType;
                  })
                  .map(function (subControl) {
                    subControl.parentControl = control.name;
                    return subControl;
                  });
              })
              // [[control, control],] => [control, control, ]
              .reduce(function (a, b) { return a.concat(b) }, [])
              .map(function (control) {
                return {
                  controlType: controlType,
                  contentType: contentType,
                  oneOff: valueForKeypath(backup, ['contentType', contentType, 'oneOff']),
                  dataKey: [
                    'data',
                    contentType,
                    valueForKeypath(backup, ['contentType', contentType, 'oneOff'])
                      ? false : '*',
                    control.parentControl,
                    '&',
                    control.name,
                    (controlType === 'gallery') ? '&' : false,
                  ].filter(function (a) { return a !== false  }),
                };
              })
          );
      })
      .reduce(function (a, b) { return a.concat(b) }, []);
  }


  // { url, resize_url } => { url, resize_url, site, token }
  function formData (urlData) {
    return extend(prependMigrateFromToUrl(urlData), {
      site: options.siteName,
      token: options.secretKey,
    });

    // { url, resize_url } => 
    function prependMigrateFromToUrl (urlData) {
      return extend(urlData, {
        url: (urlData.url.startsWith('http')
          ? ''
          : (options.migrateFrom.indexOf('http') === 0
              ? options.migrateFrom
              : 'http://' + options.migrateFrom) ) + urlData.url
      })
    }
  }

  // controlKeyPaths[] => (dataKeyPath) => boolean
  function filterPluckedControls (pluckedControls) {
    return function (itemKey) {
      return pluckedControls.filter(function (pluckedControl) {
        return equalStringArray(itemKey, pluckedControl.dataKey)
      }).length > 0;
    }
  }


  // [{ image: { url, resize_url }, key }] =>
  //   [{ image: { url, resize_url }, key, requestBody }]
  function extendImageWithRequests (imageItems) {
    return imageItems.map(function (imageItem) {
      return extend(imageItem, { requestBody: {
          form: formData({
            url: imageItem.image.url,
            resize_url: imageItem.image.resize_url,
          })
        }
      })
    })
  }

  // [{ html, key }] => [{ html, key, requestBody }]
  // Extend the key with an additional entry for the
  // index value of the image in the 
  function extendHtmlWithRequests (htmlItems) {
    return htmlItems.map(function toRequestData (htmlItem) {
      var requests = [];
      var $ = cheerio.load(htmlItem.html);
      $('figure[data-type="image"]').each(function (i, el) {
        var url = $(el).find('a').attr('href')
        if (typeof url !== 'string') return;
        requests = requests.concat([{
          form: formData({
            url: url,
            resize_url: true,
          })
        }])
      });
      return requests.map(function (request, requestIndex) {
        return extend(htmlItem,
          { key: htmlItem.key.concat(requestIndex) },
          { requestBody: request }
        )   
      });
    }).reduce(function (a, b) { return a.concat(b); }, []);
  }

  // ([{ ..., requestBody }], continuationFunction) => undefined
  //   |> continuationFunction([{ ..., requestBody, responseBody }])
  function processRequests (requestItems, next, attempt) {
    if (!attempt) attempt = 0;
    var maxAttempts = 20;

    if (attempt > maxAttempts) {
      return next(requestItems);
    }

    debug('processRequests:attempt:' + attempt);

    // push `requestItems` into this stream
    var input = miss.through.obj();
    // make requests based on `requestBody`
    // if successsul, extend with `responseBody`
    // if errored, extend with `errorBody`
    var upload = miss.through.obj(uploader);
    // after trying to upload all items
    // check for `errorBody` requests. if there are any
    // lets start the process again with the array
    var output = miss.concat(function checkIfComplete (responseItems) {
      var erroredRequests = responseItems.filter(itemWithKey('errorBody'));
      if (erroredRequests.length === 0) {
        // we have no errors, lets pass our response
        // into our callback
        next(responseItems);
      }
      else {
        debug('processRequests:erroredRequests:' + erroredRequests.length);
        // we have errors, lets try to reprocess thehm
        var nextAttempt = attempt + 1;
        processRequests(responseItems, next, nextAttempt);
      }
    });

    setTimeout(function () {
      requestItems.concat([null])
        .forEach(function (requestItem) {
          // the item has already been successfully processed
          // so we don't need to push it back into the stream
          if ((requestItem !== null) &&
              (requestItem.hasOwnProperty('responseBody'))) return;
          process.nextTick(function () {
            input.push(requestItem);
          });
        });
    }, backoffTime(attempt));

    // put together the pipeline without a callback
    // that capture errors. although none of the
    // pieces of the stream emits errors, so we
    // won't end up in the callback.
    miss.pipe(input, upload, output, function (err) {
      if (err) return next(err, null);
    });
  }

  function backoffTime (attempt) {
    var backoff = Math.pow(2, attempt);
    var maxBackoffTime = 32000;
    var randomOffset = Math.random() * 10;
    return Math.min(backoff, maxBackoffTime) + randomOffset;
  }

  // ({ ..., requestBody })
  function uploader (requestItem, enc, next) {
    uploadUrl(requestItem.requestBody, function (err, response) {
      // if this errored before, but not this time,
      // lets remove the error
      if (!err && requestItem.hasOwnProperty('errorBody')) {
        delete requestItem.errorBody
      }
      next(null, err
        ? extend(requestItem, { errorBody: err })
        : extend(requestItem, { responseBody: response }));
    });
  }

  // ({ form: { url, resize_url, token, site }, function next (err, body) }) =>
  //   undefined
  function uploadUrl (body, next) {
    request.post(
      options.uploadUrl,
      body,
      function (err, httpResponse, body) {
        if (err) {
          return next(err, {});
        }
        else {
          try {
            body = JSON.parse(body);  
          } catch ( error ) {
            return next(body, {})
          }
          
          next(null, body);
          // body = { resize_url, mimeType, size, url }
        }
      });
  }
}

function filterObjectWithKey(key) {
  return function (obj) { return key in obj; };
}

function itemWithKey (key) {
  return function itemWithClosureKey (item) {
    return item.hasOwnProperty(key);
  }
}

// ([], []) => Boolean
// 
// Examples:
// (['data', '*'], ['data', 'contentType']) => true
// (['data', '*', 'controlName'], ['data', 'contentType']) => false
// (['data', '*', 'controlName'], ['data', 'contentType', 'controlName']) => true
// 
// Compare values at each index of A (aValue) to the value in B (bValue).
// If either aValue or bValue value is '*', aValue and bValue 
// are evaluated as equal.
// If aValue is an integer, and bValue is '&', aValue and bValue
// are evaluated as equal.
// Otherwise if aValue === bValue, they are also evaluated as equal.
// If all aValue & bValue comparisons are evaluated to equal, return true.
function equalStringArray (a, b) {
  if (a.length === b.length) {
    var c = a.filter(function (aValue, aIndex) {
      return (aValue === '*' || b[aIndex] === '*') ?
        true :
        ((Number.isInteger(aValue) && b[aIndex] === '&') ?
         true : (aValue === b[aIndex]));
    });
    if (a.length === c.length) return true;
    else return false;
  }
  return false;
}

function valueForKeypath (obj, keyPath, setValue) {
  // lets keep track of the `keyIndex` value that we will want to
  // match before applying using the `setValue` on the current value.
  // -1 if there is no `setValue` defined.
  var isSetterKey = (arguments.length === 3) ? (keyPath.length - 1) : -1;
 
  // value will continually be reset based on the current key
  // that is being applied to it
  var value = obj;

  // apply the key path
  keyPath.forEach(function (key, keyIndex) {
    if (value === undefined) return;
    if (keyIndex === isSetterKey) value[key] = setValue;
    value = value[key];
  });

  return value;
}

function isLastItemUsing (array) {
  return function isLastItem (arrayIndex) {
    return array.length - 1 === arrayIndex;
  }
}

function writeJsonToPath (path, data) {
  fs.writeFileSync(path, JSON.stringify(data, null, 2));
}
