var debug = require('debug')('webhook-migrate:cli-help');

// Given a string that represents a key, return
// a description of how to use the command
// line interface.

module.exports = help;

function help (key) {
  console.log([
    (key) ? "Missing argument " + key : false,
    (key) ? "" : false,
    "migrate <pathToRead> <pathToWrite> --from=<migrateFrom> --url=<uploadUrl> \\",
    "        --siteName=<siteName> --secretKey=<secretKey>",
    "",
    "pathToRead   path to local json file resulting from running",
    "             `wh preset-build-all` in the project to migrate from.",
    "",
    "pathToWrite  path to local json file where the migrated data will",
    "             be written, and can be `wh restore` from.",
    "",
    "from         the domain where webhook site we are migrating uploads to resides.",
    "",
    "url          Optional. The url to use to upload files. Defaults to hosted",
    "             webhook upload url (http://server.webhook.com/upload-url/)",
    "",
    "siteName     Optional. This will attempt to be pulled from the `siteName`",
    "             value of the `.firebase.conf` JSON file in the directory",
    "             where this is run.",
    "",
    "secretKey    Optional. This will attempt to be pulled from the `secretKey`",
    "             value of the `.firebase.conf` JSON file in the directory",
    "             where this is run.",
    "",
  ].filter(function (string) { return string !== false }).join('\n'));
}
