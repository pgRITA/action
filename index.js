/* 
  This file is part of @pgrita/action.

  This program is free software: you can redistribute it and/or modify it
  under the terms of the GNU Affero General Public License as published by
  the Free Software Foundation, either version 3 of the License, or (at your
  option) any later version. This program is distributed in the hope that it
  will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty
  of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero
  General Public License for more details. You should have received a copy of
  the GNU Affero General Public License along with this program. If not, see
  <https://www.gnu.org/licenses/>.
*/

const core = require("@actions/core");
const { parse } = require("pg-connection-string");
const pg = require("pg");
const { INTROSPECTION_QUERY } = require("./introspectionQuery");
const { inspect } = require("util");
const { gzipSync } = require("zlib");
const fetch = require("node-fetch");
const FormData = require("form-data");

function censoredStringify(parsed) {
  let output = "postgres://";
  if (parsed.user || parsed.password) {
    output += parsed.user || "";
    if (parsed.password) {
      output += `:xxxxxxxx`;
    }
    output += "@";
  }
  if (parsed.host) {
    output += "xxxxxxx";
  }
  output += "/";
  output += parsed.database || "";
  return output;
}

async function main() {
  const token = process.env.PGRITA_TOKEN;
  if (!token) {
    const pont = core.getInput("pass-on-no-token");
    if (pont) {
      console.error(
        `Environmental variable PGRITA_TOKEN was not set and pass-on-no-token is truthy ('${inspect(
          pont
        )}'); skipping checks.`
      );
      return;
    }
    throw new Error(
      "Environmental variable PGRITA_TOKEN was not set, so pgRITA checks cannot be performed."
    );
  }
  const project = core.getInput("project") || process.env.PGRITA_PROJECT;
  if (!project) {
    throw new Error(
      "No project was specified, please specify `with: project: ...`"
    );
  }
  const connectionString =
    core.getInput("database-url") || process.env.DATABASE_URL || "postgres:///";
  const parsed = parse(connectionString);
  const censoredConnectionString = censoredStringify(parsed);

  console.log(`Running database checks against ${censoredConnectionString}`);

  // git rev-parse --abbrev-ref HEAD
  const gitBranch = process.env.GITHUB_REF
    ? process.env.GITHUB_REF.replace(/^refs\/heads\//, "")
    : null;
  // git rev-parse --verify HEAD
  const gitHash = process.env.GITHUB_SHA;

  const pool = new pg.Pool(parsed);
  try {
    const {
      rows: [{ introspection }],
    } = await pool.query(INTROSPECTION_QUERY);
    const json = JSON.stringify(introspection);
    const compressed = gzipSync(json, { level: 9 });

    const form = new FormData();
    form.append("data", compressed, {
      contentType: "application/gzip",
      filename: "pgrita_introspection.json",
    });

    const response = await fetch(
      `https://pgrita.com/api/upload?project=${encodeURIComponent(project)}` +
        (gitBranch ? `&git_branch=${encodeURIComponent(gitBranch)}` : "") +
        (gitHash ? `&git_hash=${encodeURIComponent(gitHash)}` : ""),
      {
        method: "POST",
        body: form,
        headers: {
          ...form.getHeaders(),
          authorization: `Bearer ${token}`,
        },
        redirect: "follow",
        follow: 10,
        timeout: 30000,
      }
    );
    const text = await response.text();
    if (!response.ok) {
      console.error(text);
      throw new Error(`Request failed with status '${response.status}'`);
    }
    if (text[0] === "{") {
      const json = JSON.parse(text);
      if (json.error) {
        throw new Error(json.error);
      }
    }
    const colonIndex = text.indexOf(":");
    if (colonIndex >= 0) {
      const status = text.substr(0, colonIndex);
      console.log(text);
      return { status, text };
    } else {
      console.error(text);
      throw new Error("Could not process result from server.");
    }
  } finally {
    pool.end();
  }
}

main().then(
  (data) => {
    if (data) {
      core.setOutput("status", data.status);
      switch (data.status) {
        case "PASS": {
          return;
        }
        case "TIMEOUT": {
          const poto = core.getInput("pass-on-timeout");
          if (poto) {
            console.log("Timed out, but pass-on-timeout is set; passing.");
            return;
          }
          core.setFailed("A timeout occurred waiting for results from pgRITA.");
          return;
        }
        case "ERROR": {
          core.setFailed(
            "An error occurred when trying to run pgRITA checks against your database."
          );
          return;
        }
        case "FAIL": {
          const pof = core.getInput("pass-on-fail");
          if (pof) {
            console.log(
              "Database schema has pgRITA errors, but pass-on-fail is set; passing."
            );
            return;
          }
          core.setFailed("Your database schema has some pgRITA errors.");
          return;
        }
        default: {
          core.setFailed(`Result status not understood: '${data.status}'`);
          return;
        }
      }
    }
  },
  (error) => {
    const poto = core.getInput("pass-on-timeout");
    if (
      poto &&
      (error.code === "ECONNREFUSED" ||
        error.code === "ETIMEOUT" ||
        error.type === "request-timeout")
    ) {
      console.log(
        "Failed to get results from pgrita.com, but pass-on-timeout is set; passing."
      );
      return;
    }
    core.setFailed(error.message);
  }
);
