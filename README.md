# webhook-migrate

Reads a local backup of a [webhook][webhook] site, the same one that is produced by `wh preset-data-all`. Writes a copy of the local backup, with all of the files re-uploaded to the new webhook instance. Used to migrate files from one instance of webhook, to another. Such as moving from a webhook.org site, to a self hosted webhook site.

The whole dance looks like:

```bash
cd project-to-migrate-from/
wh preset-data-all
cd ..
wh create project-to-migrate-to
cd project-to-migrate-to/
wh-migrate project-to-migrate-from.webhook.org \
  ../project-to-migrate-from/.preset-data.json \
  .new-preset-data.json
```

This will write `.new-preset-data.json`, which will be a copy of `project-to-migrate-from/.preset-data.json`. To restore from this copy use the local webhook CMS to restore from a backup.

### Exposed interfaces

```javascript
{ Migrate, requiredOptions, mapArgumentsToOptions }
```

In addition to exposing the function that will do the migration, the `requiredOptions` and `mapArgumentsToOptions` are also exposed. Should you be interested in wrapping this module with one that extends the CLI arguments array to function options object some other way.

[webhook]: http://github.com/webhook/webhook
