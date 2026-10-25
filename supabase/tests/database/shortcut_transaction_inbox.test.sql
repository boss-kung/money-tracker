begin;

select plan(37);

select has_table('public', 'mt_shortcut_tokens', 'shortcut token table exists');
select has_table('public', 'mt_shortcut_captures', 'shortcut capture table exists');
select has_function('public', 'mt_shortcut_create_token', array['uuid', 'uuid', 'text', 'bytea', 'text'], 'token creation RPC exists');
select has_function('public', 'mt_shortcut_take_rate_slot', array['uuid', 'timestamp with time zone', 'integer'], 'rate-limit RPC exists');
select has_function('public', 'mt_shortcut_claim_capture', array['uuid', 'uuid', 'bytea', 'text', 'timestamp with time zone'], 'claim RPC exists');
select has_function('public', 'mt_shortcut_consume_capture', array['uuid', 'uuid', 'bytea', 'bytea', 'boolean', 'timestamp with time zone'], 'consume RPC exists');
select has_function('public', 'mt_shortcut_cleanup', array['timestamp with time zone'], 'cleanup RPC exists');
select policies_are('public', 'mt_shortcut_tokens', '{}', 'tokens have no direct client policies');
select policies_are('public', 'mt_shortcut_captures', '{}', 'captures have no direct client policies');
select function_privs_are('public', 'mt_shortcut_create_token', array['uuid', 'uuid', 'text', 'bytea', 'text'], 'public', '{}', 'token creation is not public');
select function_privs_are('public', 'mt_shortcut_consume_capture', array['uuid', 'uuid', 'bytea', 'bytea', 'boolean', 'timestamp with time zone'], 'authenticated', '{}', 'consume is not directly callable by authenticated clients');
select has_function('public', 'mt_shortcut_cleanup', array['timestamp with time zone'], 'ack after an expired claim consumes once');

select has_column('public', 'mt_shortcut_captures', 'dedupe_base_key', 'captures store v2 base identity');
select has_column('public', 'mt_shortcut_captures', 'dedupe_captured_at', 'captures store v2 capture time');
select has_function('public', 'mt_shortcut_store_capture', array['uuid', 'uuid', 'uuid', 'text', 'integer', 'text', 'text', 'text', 'boolean', 'timestamp with time zone', 'bytea', 'bytea', 'integer', 'timestamp with time zone'], 'atomic capture RPC exists');
select function_privs_are('public', 'mt_shortcut_store_capture', array['uuid', 'uuid', 'uuid', 'text', 'integer', 'text', 'text', 'text', 'boolean', 'timestamp with time zone', 'bytea', 'bytea', 'integer', 'timestamp with time zone'], 'public', '{}', 'atomic capture RPC is not public');
select function_privs_are('public', 'mt_shortcut_store_capture', array['uuid', 'uuid', 'uuid', 'text', 'integer', 'text', 'text', 'text', 'boolean', 'timestamp with time zone', 'bytea', 'bytea', 'integer', 'timestamp with time zone'], 'authenticated', '{}', 'atomic capture RPC is not authenticated-callable');
select function_privs_are('public', 'mt_shortcut_store_capture', array['uuid', 'uuid', 'uuid', 'text', 'integer', 'text', 'text', 'text', 'boolean', 'timestamp with time zone', 'bytea', 'bytea', 'integer', 'timestamp with time zone'], 'service_role', array['EXECUTE'], 'atomic capture RPC is service-role-only');

insert into auth.users(id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('11111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', 'shortcut-test-one@example.test', '', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('22222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated', 'shortcut-test-two@example.test', '', '{}'::jsonb, '{}'::jsonb, now(), now())
on conflict (id) do nothing;

select is((select capture_id::text from public.mt_shortcut_store_capture(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', null,
  'money-tracker.capture.v1', 2, repeat('b', 64), repeat('a', 64), repeat('c', 64), true,
  '2026-10-25T12:00:00+07:00', decode('aa', 'hex'), decode('000102030405060708090a0b', 'hex'), 1,
  '2026-10-25T12:00:01+07:00')), 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'strong capture inserts its id');
select is((select duplicate from public.mt_shortcut_store_capture(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '11111111-1111-4111-8111-111111111111', null,
  'money-tracker.capture.v1', 2, repeat('b', 64), repeat('a', 64), repeat('c', 64), true,
  '2026-10-25T12:00:02+07:00', decode('bb', 'hex'), decode('000102030405060708090a0b', 'hex'), 1,
  '2026-10-25T12:00:03+07:00')), true, 'strong retry is duplicate');
select is((select capture_id::text from public.mt_shortcut_store_capture(
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc', '11111111-1111-4111-8111-111111111111', null,
  'money-tracker.capture.v1', 1, repeat('d', 64), null, repeat('d', 64), true,
  '2026-10-25T12:10:00+07:00', decode('cc', 'hex'), decode('000102030405060708090a0b', 'hex'), 1,
  '2026-10-25T12:10:01+07:00')), 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'legacy fixture inserts');
select is((select capture_id::text from public.mt_shortcut_store_capture(
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd', '11111111-1111-4111-8111-111111111111', null,
  'money-tracker.capture.v1', 2, repeat('f', 64), repeat('f', 64), repeat('d', 64), true,
  '2026-10-25T12:10:02+07:00', decode('dd', 'hex'), decode('000102030405060708090a0b', 'hex'), 1,
  '2026-10-25T12:10:03+07:00')), 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'strong v2 matches an exact legacy v1 key');
select is((select duplicate from public.mt_shortcut_store_capture(
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '11111111-1111-4111-8111-111111111111', null,
  'money-tracker.capture.v1', 2, repeat('f', 64), repeat('f', 64), repeat('d', 64), true,
  '2026-10-25T12:10:02+07:00', decode('ee', 'hex'), decode('000102030405060708090a0b', 'hex'), 1,
  '2026-10-25T12:10:03+07:00')), true, 'strong legacy match is duplicate');

select is((select capture_id::text from public.mt_shortcut_store_capture(
  '11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', null,
  'money-tracker.capture.v1', 2, repeat('1', 64), repeat('2', 64), null, false,
  '2026-10-25T12:04:59+07:00', decode('11', 'hex'), decode('000102030405060708090a0b', 'hex'), 1,
  '2026-10-25T12:04:59+07:00')), '11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'timeless capture inserts its id');
select is((select capture_id::text from public.mt_shortcut_store_capture(
  '22222222-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', null,
  'money-tracker.capture.v1', 2, repeat('3', 64), repeat('2', 64), null, false,
  '2026-10-25T12:05:01+07:00', decode('22', 'hex'), decode('000102030405060708090a0b', 'hex'), 1,
  '2026-10-25T12:05:02+07:00')), '11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'adjacent timeless bucket matches');
select is((select duplicate from public.mt_shortcut_store_capture(
  '33333333-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', null,
  'money-tracker.capture.v1', 2, repeat('3', 64), repeat('2', 64), null, false,
  '2026-10-25T12:05:01+07:00', decode('33', 'hex'), decode('000102030405060708090a0b', 'hex'), 1,
  '2026-10-25T12:05:02+07:00')), true, 'adjacent timeless receipt is duplicate');
select is((select capture_id::text from public.mt_shortcut_store_capture(
  '44444444-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', null,
  'money-tracker.capture.v1', 2, repeat('4', 64), repeat('5', 64), null, false,
  '2026-10-25T12:00:00+07:00', decode('44', 'hex'), decode('000102030405060708090a0b', 'hex'), 1,
  '2026-10-25T12:00:01+07:00')), '44444444-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'five-minute fixture inserts');
select is((select duplicate from public.mt_shortcut_store_capture(
  '55555555-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', null,
  'money-tracker.capture.v1', 2, repeat('6', 64), repeat('5', 64), null, false,
  '2026-10-25T12:05:00+07:00', decode('55', 'hex'), decode('000102030405060708090a0b', 'hex'), 1,
  '2026-10-25T12:05:01+07:00')), true, 'exactly five minutes is duplicate');
select is((select capture_id::text from public.mt_shortcut_store_capture(
  '66666666-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', null,
  'money-tracker.capture.v1', 2, repeat('7', 64), repeat('5', 64), null, false,
  '2026-10-25T12:05:00.001+07:00', decode('66', 'hex'), decode('000102030405060708090a0b', 'hex'), 1,
  '2026-10-25T12:05:01+07:00')), '66666666-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'one millisecond beyond five minutes inserts');
select is((select duplicate from public.mt_shortcut_store_capture(
  '77777777-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', null,
  'money-tracker.capture.v1', 2, repeat('7', 64), repeat('5', 64), null, false,
  '2026-10-25T12:05:00.001+07:00', decode('77', 'hex'), decode('000102030405060708090a0b', 'hex'), 1,
  '2026-10-25T12:05:01+07:00')), false, 'one millisecond beyond five minutes is not duplicate');

select is((select capture_id::text from public.mt_shortcut_store_capture(
  '88888888-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', null,
  'money-tracker.capture.v1', 1, repeat('8', 64), null, repeat('9', 64), false,
  '2026-10-25T13:00:00+07:00', decode('88', 'hex'), decode('000102030405060708090a0b', 'hex'), 1,
  '2026-10-25T13:00:00+07:00')), '88888888-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'legacy timeless fixture inserts');
select is((select capture_id::text from public.mt_shortcut_store_capture(
  '99999999-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', null,
  'money-tracker.capture.v1', 2, repeat('a', 64), repeat('b', 64), repeat('8', 64), false,
  '2026-10-25T13:04:00+07:00', decode('99', 'hex'), decode('000102030405060708090a0b', 'hex'), 1,
  '2026-10-25T13:04:01+07:00')), '88888888-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'nearby legacy timeless receipt matches');
select is((select duplicate from public.mt_shortcut_store_capture(
  'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', null,
  'money-tracker.capture.v1', 2, repeat('a', 64), repeat('b', 64), repeat('8', 64), false,
  '2026-10-25T13:04:00+07:00', decode('aa', 'hex'), decode('000102030405060708090a0b', 'hex'), 1,
  '2026-10-25T13:04:01+07:00')), true, 'nearby legacy timeless receipt is duplicate');
select is((select capture_id::text from public.mt_shortcut_store_capture(
  'aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', null,
  'money-tracker.capture.v1', 2, repeat('b', 64), repeat('c', 64), repeat('8', 64), false,
  '2026-10-25T13:06:00+07:00', decode('ab', 'hex'), decode('000102030405060708090a0b', 'hex'), 1,
  '2026-10-25T13:06:01+07:00')), 'aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'older same-day legacy receipt inserts');
select is((select duplicate from public.mt_shortcut_store_capture(
  'aaaaaaa3-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '22222222-2222-4222-8222-222222222222', null,
  'money-tracker.capture.v1', 2, repeat('a', 64), repeat('b', 64), null, false,
  '2026-10-25T12:05:01+07:00', decode('ac', 'hex'), decode('000102030405060708090a0b', 'hex'), 1,
  '2026-10-25T12:05:02+07:00')), false, 'different users never match');
select is((select duplicate from public.mt_shortcut_store_capture(
  'aaaaaaa4-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', null,
  'money-tracker.capture.v1', 2, repeat('c', 64), repeat('c', 64), null, false,
  '2026-10-25T12:05:01+07:00', decode('ad', 'hex'), decode('000102030405060708090a0b', 'hex'), 1,
  '2026-10-25T12:05:02+07:00')), false, 'different base identities never match');
select is((select encode(ciphertext, 'hex') from public.mt_shortcut_captures where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 'aa', 'duplicate never replaces ciphertext');

select * from finish();
rollback;
