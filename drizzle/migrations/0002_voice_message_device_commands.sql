alter type public.command_type add value if not exists 'voice_message';

notify pgrst, 'reload schema';