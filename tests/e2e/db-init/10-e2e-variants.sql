-- Runs once, on the first start of the e2e `db` volume (the postgres image executes every file in
-- /docker-entrypoint-initdb.d before it accepts TCP connections). Each variant app of the e2e project
-- (tests/e2e/compose.e2e.yaml) migrates and seeds a database of its own, so no two apps share one.
CREATE DATABASE e2e_flag_off;
CREATE DATABASE e2e_flag_on;
