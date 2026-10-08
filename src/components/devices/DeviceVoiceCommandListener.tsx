import { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { getPatrolDeviceInfo } from '@/lib/deviceInfo';
import { isPatrolDeviceSession } from '@/lib/devicePresence';
import { signSecureDevicePayload } from '@/lib/secureDevice';

type DeviceVoiceCommand = {
  id: string;
  message_id?: string;
  audio_url: string;
  filename?: string;
  content_type?: string;
  duration_ms?: number | null;
  issued_at?: string;
};

const PLAYED_COMMANDS_KEY = 'mxpatrol_played_voice_commands';
const POLL_MS = 30_000;

function readPlayedCommands() {
  try {
    return new Set(JSON.parse(window.localStorage.getItem(PLAYED_COMMANDS_KEY) || '[]') as string[]);
  } catch {
    return new Set<string>();
  }
}

function rememberPlayedCommand(id: string) {
  const played = readPlayedCommands();
  played.add(id);
  const recent = Array.from(played).slice(-250);
  window.localStorage.setItem(PLAYED_COMMANDS_KEY, JSON.stringify(recent));
}

function playAudio(url: string) {
  return new Promise<void>((resolve, reject) => {
    const audio = new Audio(url);
    audio.preload = 'auto';
    audio.volume = 1;
    audio.onended = () => resolve();
    audio.onerror = () => reject(new Error('audio_playback_failed'));
    audio.play().then(undefined, reject);
  });
}

export default function DeviceVoiceCommandListener() {
  const processingRef = useRef(false);

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android' || !isPatrolDeviceSession()) return;

    let cancelled = false;
    const deviceInfo = getPatrolDeviceInfo();

    const ackCommand = async (commandId: string, playbackStatus: 'played' | 'failed' | 'skipped', error?: string) => {
      const payload = { action: 'ack', device_identifier: deviceInfo.deviceIdentifier, command_id: commandId, playback_status: playbackStatus, error: error ?? null };
      const deviceAuth = await signSecureDevicePayload('voice_command_ack', deviceInfo.deviceIdentifier, payload);
      const { data, error: invokeError } = await supabase.functions.invoke('device-voice-commands', { body: { ...payload, device_auth: deviceAuth } });
      if (invokeError) throw invokeError;
      if (data?.error || !data?.success) throw new Error(data?.error || 'Voice command acknowledgement failed');
    };

    const processCommand = async (command: DeviceVoiceCommand) => {
      const played = readPlayedCommands();
      if (played.has(command.id)) {
        await ackCommand(command.id, 'skipped');
        return;
      }

      window.dispatchEvent(new CustomEvent('mxpatrol:voice-feedback', {
        detail: {
          id: command.id,
          status: 'received',
          deviceIdentifier: deviceInfo.deviceIdentifier,
          capturedAt: command.issued_at || new Date().toISOString(),
          durationMs: command.duration_ms ?? null,
          message: 'CONTROL ROOM MESSAGE',
          audioUrl: command.audio_url,
        },
      }));

      try {
        await playAudio(command.audio_url);
        rememberPlayedCommand(command.id);
        await ackCommand(command.id, 'played');
      } catch (error) {
        await ackCommand(command.id, 'failed', error instanceof Error ? error.message : 'playback_failed');
        throw error;
      }
    };

    const fetchCommands = async () => {
      if (cancelled || processingRef.current || !navigator.onLine) return;
      processingRef.current = true;
      try {
        const payload = { action: 'fetch', device_identifier: deviceInfo.deviceIdentifier };
        const deviceAuth = await signSecureDevicePayload('voice_command_fetch', deviceInfo.deviceIdentifier, payload);
        const { data, error } = await supabase.functions.invoke('device-voice-commands', { body: { ...payload, device_auth: deviceAuth } });
        if (error) throw error;
        if (data?.error || !data?.success) throw new Error(data?.error || 'Voice command fetch failed');
        const commands = (data.commands ?? []) as DeviceVoiceCommand[];
        for (const command of commands) {
          if (cancelled) break;
          await processCommand(command);
        }
      } catch (error) {
        console.warn('[DeviceVoiceCommand] fetch/playback failed', error);
      } finally {
        processingRef.current = false;
      }
    };

    void fetchCommands();
    const interval = window.setInterval(() => void fetchCommands(), POLL_MS);
    const online = () => void fetchCommands();
    const visible = () => { if (document.visibilityState === 'visible') void fetchCommands(); };
    window.addEventListener('online', online);
    document.addEventListener('visibilitychange', visible);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener('online', online);
      document.removeEventListener('visibilitychange', visible);
    };
  }, []);

  return null;
}
