revoke all on database postgres from public;
revoke all on schema public from public;
create extension if not exists citext;
create table my_table (
  id int not null primary key generated always as identity,
  username citext not null unique
);
