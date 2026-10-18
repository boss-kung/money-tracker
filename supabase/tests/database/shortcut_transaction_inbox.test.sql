begin;

select plan(12);

select has_table('public', 'mt_shortcut_tokens', 'shortcut token table exists');
select has_table('public', 'mt_shortcut_captures', 'shortcut capture table exists');
select has_function('public', 'mt_shortcut_create_token', array['uuid', 'text', 'bytea', 'text'], 'token creation RPC exists');
select has_function('public', 'mt_shortcut_take_rate_slot', array['uuid', 'timestamp with time zone', 'integer'], 'rate-limit RPC exists');
select has_function('public', 'mt_shortcut_claim_capture', array['uuid', 'uuid', 'bytea', 'text', 'timestamp with time zone'], 'claim RPC exists');
select has_function('public', 'mt_shortcut_consume_capture', array['uuid', 'uuid', 'bytea', 'bytea', 'boolean', 'timestamp with time zone'], 'consume RPC exists');
select has_function('public', 'mt_shortcut_cleanup', array['timestamp with time zone'], 'cleanup RPC exists');
select policies_are('public', 'mt_shortcut_tokens', '{}', 'tokens have no direct client policies');
select policies_are('public', 'mt_shortcut_captures', '{}', 'captures have no direct client policies');
select function_privs_are('public', 'mt_shortcut_create_token', array['uuid', 'text', 'bytea', 'text'], 'public', '{}', 'token creation is not public');
select function_privs_are('public', 'mt_shortcut_consume_capture', array['uuid', 'uuid', 'bytea', 'bytea', 'boolean', 'timestamp with time zone'], 'authenticated', '{}', 'consume is not directly callable by authenticated clients');
select has_function('public', 'mt_shortcut_cleanup', array['timestamp with time zone'], 'ack after an expired claim consumes once');

select * from finish();
rollback;
