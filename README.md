# pgrita/action

> [GitHub Action](https://help.github.com/en/actions) for running [pgRITA](https://pgrita.com) database checks.

## How it works

`pgrita/action` will run an introspection query against your database
(identified by the `DATABASE_URL` envvar), compress it with gzip, and then
upload it to the given `project` on [pgRITA](https://pgrita.com) using your
`PGRITA_TOKEN` secret. It will wait for the results (up to 30 seconds), and
will pass if no errors were detected.

## Inputs:

Environmental variables:

- `PGRITA_TOKEN` (required, secret): required to permit upload to pgRITA.com; get your token for
  free from the "instructions" page in your https://pgrita.com project.
- `DATABASE_URL` (required): a URL to the database we'll run the checks against

Input arguments:

- `project` (required): the project UUID or spec
  (`organizationname/projectname`) to run the checks within
- `pass-on-timeout`: set this to `true` if we should pass the check if we
  couldn't get the results from pgRITA.sh within the 30 second timeout window

## Outputs:

- `status`: `PASS`, `TIMEOUT`, `ERROR` or `FAIL`

If you'd like more outputs, get in touch!

## Example

Don't forget to add the `PGRITA_TOKEN` secret to your repository.

```yaml
name: Database checks

on: [push]

jobs:
  pgrita:
    runs-on: ubuntu-16.04

    env:
      DATABASE_URL: postgres://postgres:postgres@localhost:5432/postgres

    services:
      postgres:
        image: postgres:11
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: postgres
        ports:
          - "0.0.0.0:5432:5432"
        # needed because the postgres container does not provide a healthcheck
        options:
          --health-cmd pg_isready --health-interval 10s --health-timeout 5s
          --health-retries 5

    steps:
      - name: "Checkout"
        uses: actions/checkout@v1

      # Replace this with whatever your project needs to do to get your
      # database up and running in the attached postgres service. This might be
      # importing a database dump, running a string of migrations, running SQL
      # files, or something else.
      - name: "Load database schema"
        run: yarn && node ./load-database-schema.js

      - name: "Run pgRITA checks"
        uses: pgrita/action@main
        env:
          PGRITA_TOKEN: ${{ secrets.PGRITA_TOKEN }}
        with:
          project: myorganization/myproject
```

## Pull requests

If you're interested in raising a PR, please first open an issue to discuss it.
