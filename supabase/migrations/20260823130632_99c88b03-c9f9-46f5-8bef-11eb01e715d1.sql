alter type public.command_type add value if not exists 'disable_device';
alter type public.command_type add value if not exists 'enable_device';
alter type public.command_type add value if not exists 'enter_maintenance';
alter type public.command_type add value if not exists 'exit_maintenance';
alter type public.command_type add value if not exists 'force_security_check';
alter type public.command_type add value if not exists 'require_app_update';
alter type public.command_type add value if not exists 'revoke_device';