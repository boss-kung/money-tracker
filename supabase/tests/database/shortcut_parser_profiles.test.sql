begin;

select plan(13);
select has_table('public', 'mt_shortcut_parser_profiles', 'parser profile table exists');
select has_column('public', 'mt_shortcut_parser_profiles', 'short_code', 'profiles have a marker code');
select has_column('public', 'mt_shortcut_parser_profiles', 'rule_ciphertext', 'profiles store encrypted rules');
select has_column('public', 'mt_shortcut_parser_profiles', 'profile_version', 'profiles have optimistic versions');
select policies_are('public', 'mt_shortcut_parser_profiles', '{}', 'profiles have no direct client policies');
select function_privs_are('public', 'mt_shortcut_create_profile', array['uuid','uuid','text','text','text','boolean','integer','bytea','bytea','integer','timestamp with time zone'], 'public', '{}', 'profile create is not public');
select function_privs_are('public', 'mt_shortcut_create_profile', array['uuid','uuid','text','text','text','boolean','integer','bytea','bytea','integer','timestamp with time zone'], 'authenticated', '{}', 'profile create is not authenticated-callable');
select function_privs_are('public', 'mt_shortcut_create_profile', array['uuid','uuid','text','text','text','boolean','integer','bytea','bytea','integer','timestamp with time zone'], 'service_role', array['EXECUTE'], 'profile create is service-role-only');
select function_privs_are('public', 'mt_shortcut_update_profile', array['uuid','uuid','integer','text','text','boolean','integer','bytea','bytea','integer','timestamp with time zone'], 'public', '{}', 'profile update is not public');
select function_privs_are('public', 'mt_shortcut_update_profile', array['uuid','uuid','integer','text','text','boolean','integer','bytea','bytea','integer','timestamp with time zone'], 'authenticated', '{}', 'profile update is not authenticated-callable');
select function_privs_are('public', 'mt_shortcut_update_profile', array['uuid','uuid','integer','text','text','boolean','integer','bytea','bytea','integer','timestamp with time zone'], 'service_role', array['EXECUTE'], 'profile update is service-role-only');
select col_is_pk('public', 'mt_shortcut_parser_profiles', 'id', 'profile id is primary key');
select index_is_unique('public', 'mt_shortcut_parser_profiles', 'mt_shortcut_parser_profiles_code_uq', 'profile codes are unique per owner');

select * from finish();
rollback;
