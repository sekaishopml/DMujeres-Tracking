-- 00_compat.sql: generador de UUIDv7.
--
-- Cada tabla tiene un id público UUIDv7. PostgreSQL 18 ya trae uuidv7(); para
-- PostgreSQL 17 se define una versión en plpgsql (48 bits de milisegundos y
-- 74 aleatorios). system.uuidv7() usa la que corresponda.

BEGIN;

CREATE SCHEMA IF NOT EXISTS system;

DO $compat$
BEGIN
    IF current_setting('server_version_num')::int >= 180000 THEN
        -- PostgreSQL 18+: se usa la funcion nativa.
        CREATE OR REPLACE FUNCTION system.uuidv7() RETURNS uuid
            LANGUAGE sql VOLATILE
            AS 'SELECT pg_catalog.uuidv7()';
    ELSE
        -- PostgreSQL 17: respaldo propio.
        CREATE OR REPLACE FUNCTION system.uuidv7() RETURNS uuid
            LANGUAGE plpgsql VOLATILE
            AS $body$
DECLARE
    ts_bytes bytea;
    v_bytes  bytea;
BEGIN
    -- 48 bits altos de los milisegundos Unix, en big-endian.
    ts_bytes := substring(
        int8send((extract(epoch FROM clock_timestamp()) * 1000)::bigint)
        FROM 3
    );
    v_bytes := uuid_send(gen_random_uuid());
    v_bytes := overlay(v_bytes PLACING ts_bytes FROM 1 FOR 6);
    -- Version 7: nibble alto del byte 6 = 0111.
    v_bytes := set_byte(v_bytes, 6, (get_byte(v_bytes, 6) & 15) | 112);
    -- Variante RFC 4122: dos bits altos del byte 8 = 10.
    v_bytes := set_byte(v_bytes, 8, (get_byte(v_bytes, 8) & 63) | 128);
    RETURN encode(v_bytes, 'hex')::uuid;
END;
$body$;
    END IF;
END
$compat$;

COMMENT ON FUNCTION system.uuidv7() IS
    'UUIDv7 (RFC 9562) para id_publico. En PG18+ delega en pg_catalog.uuidv7(); en PG17 usa un respaldo plpgsql ordenable por milisegundo.';

COMMIT;
