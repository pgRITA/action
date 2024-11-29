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

exports.INTROSPECTION_QUERY = `\
with
  database as (
    select pg_database.oid as _id, *,
      pg_encoding_to_char(encoding) as "encoding_text"
    from pg_catalog.pg_database
    where datname = current_database()
  ),

  settings as (
    select *
    from pg_catalog.pg_settings
    where true
  ),

  namespaces as (
    select pg_namespace.oid as _id, *
    from pg_catalog.pg_namespace
    where nspname <> 'information_schema'
  ),

  classes as (
    select pg_class.oid as _id, *,
      pg_catalog.pg_relation_is_updatable(oid, true)::bit(8)::int4 as "updatable_mask",
      case when relkind = 'v' or relkind = 'm' then pg_get_viewdef(oid, false) else null end as "sql_viewdef"
    from pg_catalog.pg_class
    where relnamespace in (select namespaces._id from namespaces where nspname <> 'information_schema' and nspname not like 'pg\_%')
  ),

  attributes as (
    select *
    from pg_catalog.pg_attribute
    where attrelid in (select classes._id from classes) AND attnum > 0
  ),

  attribute_defaults as (
    select pg_attrdef.oid as _id, *,
      pg_get_expr(adbin, adrelid, true) as "sql_adbin"
    from pg_catalog.pg_attrdef
    where (adrelid, adnum) in (select attrelid, attnum from attributes)
  ),

  constraints as (
    select pg_constraint.oid as _id, *,
      pg_get_expr(conbin, coalesce(conrelid, contypid), true) as "sql_conbin",
      (case when contype <> 'n' then pg_get_constraintdef(oid, false) else null end) as "sql_def"
    from pg_catalog.pg_constraint
    where connamespace in (select namespaces._id from namespaces where nspname <> 'information_schema' and nspname not like 'pg\_%')
  ),

  sys_procs as (
    select pg_proc.oid as _id, proname, pronamespace
    from pg_catalog.pg_proc
    where pronamespace = 'pg_catalog'::regnamespace
  ),

  procs as (
    select pg_proc.oid as _id, *,
      pg_get_expr(proargdefaults, 0, true) as "sql_proargdefaults",
      pg_get_function_identity_arguments(oid) as "sql_identity_arguments"
    from pg_catalog.pg_proc
    where pronamespace in (select namespaces._id from namespaces where nspname <> 'information_schema' and nspname not like 'pg\_%')
  ),

  aggregates as (
    select *
    from pg_catalog.pg_aggregate
    where aggfnoid in (select procs._id from procs)
  ),

  roles as (
    select pg_roles.oid as _id, *
    from pg_catalog.pg_roles
  ),

  db_role_settings as (
    select *
    from pg_catalog.pg_db_role_setting
    where setdatabase in (select database._id from database)
  ),

  auth_members as (
    select *
    from pg_catalog.pg_auth_members
    where roleid in (select roles._id from roles)
  ),

  default_acls as (
    select pg_default_acl.oid as _id, *
    from pg_catalog.pg_default_acl
  ),

  types as (
    select pg_type.oid as _id, *,
      pg_get_expr(typdefaultbin, 0, true) as "sql_typdefaultbin"
    from pg_catalog.pg_type
    where (typnamespace in (select namespaces._id from namespaces where nspname <> 'information_schema' and nspname not like 'pg\_%'))
    or (typnamespace = 'pg_catalog'::regnamespace)
  ),

  enums as (
    select pg_enum.oid as _id, *
    from pg_catalog.pg_enum
    where enumtypid in (select types._id from types)
  ),

  event_triggers as (
    select *
    from pg_catalog.pg_event_trigger
  ),

  extensions as (
    select pg_extension.oid as _id, *
    from pg_catalog.pg_extension
  ),

  foreign_data_wrappers as (
    select pg_foreign_data_wrapper.oid as _id, *
    from pg_catalog.pg_foreign_data_wrapper
  ),

  foreign_servers as (
    select pg_foreign_server.oid as _id, *
    from pg_catalog.pg_foreign_server
    where srvfdw in (select foreign_data_wrappers._id from foreign_data_wrappers)
  ),

  foreign_tables as (
    select *
    from pg_catalog.pg_foreign_table
    where ftserver in (select foreign_servers._id from foreign_servers)
  ),

  indexes as (
    select *,
      pg_get_expr(indexprs, indrelid, true) as "sql_indexprs",
      pg_get_expr(indpred, indrelid, true) as "sql_indpred"
    from pg_catalog.pg_index
    where indrelid in (select classes._id from classes)
  ),

  inherits as (
    select *
    from pg_catalog.pg_inherits
    where inhrelid in (select classes._id from classes)
  ),

  languages as (
    select pg_language.oid as _id, *
    from pg_catalog.pg_language
  ),

  policies as (
    select *,
      pg_get_expr(polqual, polrelid, true) as "sql_polqual",
      pg_get_expr(polwithcheck, polrelid, true) as "sql_polwithcheck"
    from pg_catalog.pg_policy
    where polrelid in (select classes._id from classes)
  ),

  ranges as (
    select *
    from pg_catalog.pg_range
    where rngtypid in (select types._id from types)
  ),

  rewrites as (
    select pg_rewrite.oid as _id, *,
      null as "sql_ev_qual",
      null as "sql_ev_action"
    from pg_catalog.pg_rewrite
    where ev_class in (select classes._id from classes)
  ),

  triggers as (
    select pg_trigger.oid as _id, *,
      pg_get_triggerdef(oid, false) as "sql_def",
      null as "sql_tgqual"
    from pg_catalog.pg_trigger
    where tgrelid in (select classes._id from classes where relkind = 'r')
  ),

  depends as (
    select *
    from pg_catalog.pg_depend
    where deptype IN ('a', 'e') and (
      (classid = 'pg_catalog.pg_namespace'::regclass and objid in (select namespaces._id from namespaces))
      or (classid = 'pg_catalog.pg_class'::regclass and objid in (select classes._id from classes))
      or (classid = 'pg_catalog.pg_attribute'::regclass and objid in (select classes._id from classes) and objsubid > 0)
      or (classid = 'pg_catalog.pg_constraint'::regclass and objid in (select constraints._id from constraints))
      or (classid = 'pg_catalog.pg_proc'::regclass and objid in (select procs._id from procs))
      or (classid = 'pg_catalog.pg_type'::regclass and objid in (select types._id from types))
      or (classid = 'pg_catalog.pg_enum'::regclass and objid in (select enums._id from enums))
      or (classid = 'pg_catalog.pg_extension'::regclass and objid in (select extensions._id from extensions))
      or (classid = 'pg_catalog.pg_foreign_data_wrapper'::regclass and objid in (select foreign_data_wrappers._id from foreign_data_wrappers))
      or (classid = 'pg_catalog.pg_foreign_server'::regclass and objid in (select foreign_servers._id from foreign_servers))
      or (classid = 'pg_catalog.pg_rewrite'::regclass and objid in (select rewrites._id from rewrites))
      or (classid = 'pg_catalog.pg_trigger'::regclass and objid in (select triggers._id from triggers))
    )
  ),

  descriptions as (
    select *
    from pg_catalog.pg_description
    where (
      (classoid = 'pg_catalog.pg_namespace'::regclass and objoid in (select namespaces._id from namespaces))
      or (classoid = 'pg_catalog.pg_class'::regclass and objoid in (select classes._id from classes))
      or (classoid = 'pg_catalog.pg_attribute'::regclass and objoid in (select classes._id from classes) and objsubid > 0)
      or (classoid = 'pg_catalog.pg_constraint'::regclass and objoid in (select constraints._id from constraints))
      or (classoid = 'pg_catalog.pg_proc'::regclass and objoid in (select procs._id from procs))
      or (classoid = 'pg_catalog.pg_type'::regclass and objoid in (select types._id from types))
      or (classoid = 'pg_catalog.pg_enum'::regclass and objoid in (select enums._id from enums))
      or (classoid = 'pg_catalog.pg_extension'::regclass and objoid in (select extensions._id from extensions))
      or (classoid = 'pg_catalog.pg_foreign_data_wrapper'::regclass and objoid in (select foreign_data_wrappers._id from foreign_data_wrappers))
      or (classoid = 'pg_catalog.pg_foreign_server'::regclass and objoid in (select foreign_servers._id from foreign_servers))
      or (classoid = 'pg_catalog.pg_rewrite'::regclass and objoid in (select rewrites._id from rewrites))
      or (classoid = 'pg_catalog.pg_trigger'::regclass and objoid in (select triggers._id from triggers))
    )
  ),

  stat_user_tables as (
    select *
    from pg_catalog.pg_stat_user_tables
    where relid in (select _id from classes)
  ),

  am as (
    select pg_am.oid as _id, *
    from pg_catalog.pg_am
    where true
  )
select json_build_object(
  'database',
  (select row_to_json(database) from database),

  'settings',
  (select coalesce((select json_agg(row_to_json(settings) order by name) from settings), '[]'::json)),

  'namespaces',
  (select coalesce((select json_agg(row_to_json(namespaces) order by nspname) from namespaces), '[]'::json)),

  'classes',
  (select coalesce((select json_agg(row_to_json(classes) order by relnamespace, relname) from classes), '[]'::json)),

  'attributes',
  (select coalesce((select json_agg(row_to_json(attributes) order by attrelid, attnum) from attributes), '[]'::json)),

  'attribute_defaults',
  (select coalesce((select json_agg(row_to_json(attribute_defaults) order by adrelid, adnum) from attribute_defaults), '[]'::json)),

  'constraints',
  (select coalesce((select json_agg(row_to_json(constraints) order by connamespace, conrelid, conname) from constraints), '[]'::json)),

  'sys_procs',
  (select coalesce((select json_agg(row_to_json(sys_procs) order by pronamespace, proname, pg_get_function_identity_arguments(sys_procs._id)) from sys_procs), '[]'::json)),

  'procs',
  (select coalesce((select json_agg(row_to_json(procs) order by pronamespace, proname, pg_get_function_identity_arguments(procs._id)) from procs), '[]'::json)),

  'aggregates',
  (select coalesce((select json_agg(row_to_json(aggregates) order by aggfnoid) from aggregates), '[]'::json)),

  'roles',
  (select coalesce((select json_agg(row_to_json(roles) order by rolname) from roles), '[]'::json)),

  'db_role_settings',
  (select coalesce((select json_agg(row_to_json(db_role_settings) order by setdatabase, setrole) from db_role_settings), '[]'::json)),

  'auth_members',
  (select coalesce((select json_agg(row_to_json(auth_members) order by roleid, member, grantor) from auth_members), '[]'::json)),

  'default_acls',
  (select coalesce((select json_agg(row_to_json(default_acls) order by defaclrole,defaclnamespace,defaclobjtype) from default_acls), '[]'::json)),

  'types',
  (select coalesce((select json_agg(row_to_json(types) order by typnamespace, typname) from types), '[]'::json)),

  'enums',
  (select coalesce((select json_agg(row_to_json(enums) order by enumtypid, enumsortorder) from enums), '[]'::json)),

  'event_triggers',
  (select coalesce((select json_agg(row_to_json(event_triggers) order by evtname) from event_triggers), '[]'::json)),

  'extensions',
  (select coalesce((select json_agg(row_to_json(extensions) order by extname) from extensions), '[]'::json)),

  'foreign_data_wrappers',
  (select coalesce((select json_agg(row_to_json(foreign_data_wrappers) order by fdwname) from foreign_data_wrappers), '[]'::json)),

  'foreign_servers',
  (select coalesce((select json_agg(row_to_json(foreign_servers) order by srvname) from foreign_servers), '[]'::json)),

  'foreign_tables',
  (select coalesce((select json_agg(row_to_json(foreign_tables) order by ftrelid, ftserver) from foreign_tables), '[]'::json)),

  'indexes',
  (select coalesce((select json_agg(row_to_json(indexes) order by indrelid, indexrelid) from indexes), '[]'::json)),

  'inherits',
  (select coalesce((select json_agg(row_to_json(inherits) order by inhrelid, inhseqno) from inherits), '[]'::json)),

  'languages',
  (select coalesce((select json_agg(row_to_json(languages) order by lanname) from languages), '[]'::json)),

  'policies',
  (select coalesce((select json_agg(row_to_json(policies) order by polrelid, polname) from policies), '[]'::json)),

  'ranges',
  (select coalesce((select json_agg(row_to_json(ranges) order by rngtypid) from ranges), '[]'::json)),

  'rewrites',
  (select coalesce((select json_agg(row_to_json(rewrites) order by ev_class,ev_type,rulename) from rewrites), '[]'::json)),

  'triggers',
  (select coalesce((select json_agg(row_to_json(triggers) order by tgrelid, tgname) from triggers), '[]'::json)),

  'depends',
  (select coalesce((select json_agg(row_to_json(depends) order by classid, objid, objsubid, refclassid, refobjid, refobjsubid) from depends), '[]'::json)),

  'descriptions',
  (select coalesce((select json_agg(row_to_json(descriptions) order by objoid, classoid, objsubid) from descriptions), '[]'::json)),

  'stat_user_tables',
  (select coalesce((select json_agg(row_to_json(stat_user_tables) order by schemaname, relname) from stat_user_tables), '[]'::json)),

  'am',
  (select coalesce((select json_agg(row_to_json(am) order by amname) from am), '[]'::json)),

  'catalog_by_oid',
  (
    select json_object_agg(oid::text, relname order by relname asc)
    from pg_class
    where relnamespace = (
      select oid
      from pg_namespace
      where nspname = 'pg_catalog'
    )
    and relkind = 'r'
  ),

  'current_user',
  current_user,
  'pg_version',
  version(),
  'introspection_version',
  1
) as introspection
`;
