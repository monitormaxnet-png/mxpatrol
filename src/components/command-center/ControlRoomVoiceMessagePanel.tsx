import { useEffect, useMemo, useRef, useState } from 'react';
import { Mic, Send, Square, Check, Radio } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

type VoiceDeviceRow = {
  id?: string;
  device_identifier?: string | null;
  device_name?: string | null;
  status?: string | null;
  secure_mode_status?: string | null;
};

type RecipientMode = 'selected' | 'site';

function deviceKey(device: VoiceDeviceRow) {
  return String(device.device_identifier ?? device.id ?? '');
}

function deviceLabel(device: VoiceDeviceRow) {
  return String(device.device_name ?? device.device_identifier ?? device.id ?? 'Device');
}

function formatDuration(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

async function blobToBase64(blob: Blob) {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read recording'));
    reader.readAsDataURL(blob);
  });
  return dataUrl.includes(',') ? dataUrl.split(',').pop() || '' : dataUrl;
}

export default function ControlRoomVoiceMessagePanel({ siteId, selectedSite, devices, activeIdentifier }: { siteId: string | null; selectedSite: string; devices: VoiceDeviceRow[]; activeIdentifier?: string | null }) {
  const [recipientMode, setRecipientMode] = useState<RecipientMode>('selected');
  const [selected, setSelected] = useState<Set<string>>(() => new Set(activeIdentifier ? [activeIdentifier] : []));
  const [recording, setRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedAt, setRecordedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [sending, setSending] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef<number>(0);

  const eligibleDevices = useMemo(() => devices.filter((device) => deviceKey(device) && !['revoked', 'disabled'].includes(String(device.secure_mode_status ?? '').toLowerCase())), [devices]);
  const selectedIdentifiers = Array.from(selected).filter((identifier) => eligibleDevices.some((device) => deviceKey(device) === identifier));
  const recipientCount = recipientMode === 'site' ? eligibleDevices.length : selectedIdentifiers.length;
  useEffect(() => {
    if (!activeIdentifier) return;
    setSelected((current) => current.has(activeIdentifier) ? current : new Set([...current, activeIdentifier]));
  }, [activeIdentifier]);

  const toggleDevice = (identifier: string) => {
    setRecipientMode('selected');
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(identifier)) next.delete(identifier);
      else next.add(identifier);
      return next;
    });
  };

  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      toast.error('Browser microphone recording is not available here');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      setElapsedMs(0);
      setRecordedBlob(null);
      setRecordedAt(null);
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        setRecordedBlob(blob);
        setRecordedAt(Date.now());
        setRecording(false);
        if (timerRef.current) window.clearInterval(timerRef.current);
        timerRef.current = null;
      };
      recorder.start();
      setRecording(true);
      timerRef.current = window.setInterval(() => {
        const elapsed = Date.now() - startedAtRef.current;
        setElapsedMs(Math.min(60_000, elapsed));
        if (elapsed >= 60_000) stopRecording();
      }, 250);
    } catch (error) {
      toast.error('Microphone permission failed', { description: error instanceof Error ? error.message : 'Please allow microphone access.' });
    }
  };

  const stopRecording = () => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  };

  const sendRecording = async () => {
    if (!siteId) {
      toast.error('Choose an active site first');
      return;
    }
    if (!recordedBlob || !recordedAt) {
      toast.error('Record a voice message first');
      return;
    }
    if (recipientCount < 1) {
      toast.error('Choose at least one RG360 recipient');
      return;
    }

    setSending(true);
    try {
      const audioBase64 = await blobToBase64(recordedBlob);
      const { data, error } = await supabase.functions.invoke('control-room-voice-message', {
        body: {
          site_id: siteId,
          recipient_mode: recipientMode,
          device_identifiers: recipientMode === 'site' ? [] : selectedIdentifiers,
          audio_base64: audioBase64,
          content_type: recordedBlob.type || 'audio/webm',
          filename: `control-room-voice-${recordedAt}.webm`,
          duration_ms: elapsedMs,
        },
      });
      if (error) throw error;
      if (data?.error || !data?.success) throw new Error(data?.error || 'Voice message could not be queued');
      toast.success('Voice message queued', { description: `${data.recipient_count ?? recipientCount} RG360 recipient(s)` });
      setRecordedBlob(null);
      setRecordedAt(null);
      setElapsedMs(0);
    } catch (error) {
      toast.error('Voice message failed', { description: error instanceof Error ? error.message : 'Please try again.' });
    } finally {
      setSending(false);
    }
  };

  return (
    <section className='rounded-xl border border-cyan-400/20 bg-[#07101d]/85 p-3'>
      <div className='mb-3 flex items-center justify-between gap-3'>
        <p className='flex items-center gap-2 text-xs font-black uppercase tracking-[0.12em] text-cyan-300'><Radio className='h-4 w-4' /> Voice Message</p>
        <span className='text-[11px] text-slate-500'>{selectedSite}</span>
      </div>

      <div className='mb-3 grid grid-cols-2 gap-2 text-xs'>
        <button type='button' onClick={() => setRecipientMode('selected')} className={(recipientMode === 'selected' ? 'border-cyan-300/50 bg-cyan-400/10 text-cyan-100' : 'border-white/10 text-slate-300') + ' rounded-lg border px-3 py-2 font-semibold'}>Selected</button>
        <button type='button' onClick={() => setRecipientMode('site')} className={(recipientMode === 'site' ? 'border-cyan-300/50 bg-cyan-400/10 text-cyan-100' : 'border-white/10 text-slate-300') + ' rounded-lg border px-3 py-2 font-semibold'}>All Site</button>
      </div>

      {recipientMode === 'selected' ? <div className='mb-3 max-h-32 space-y-1 overflow-y-auto rounded-lg border border-white/10 bg-slate-950/50 p-2'>
        {eligibleDevices.length ? eligibleDevices.map((device) => {
          const identifier = deviceKey(device);
          const checked = selected.has(identifier);
          return <button type='button' key={identifier} onClick={() => toggleDevice(identifier)} className={(checked ? 'border-cyan-300/45 bg-cyan-400/10' : 'border-white/5 hover:border-cyan-300/25') + ' flex w-full items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-left text-xs text-slate-200'}><span className='truncate'>{deviceLabel(device)}</span>{checked ? <Check className='h-3.5 w-3.5 text-cyan-300' /> : null}</button>;
        }) : <p className='px-2 py-3 text-xs text-slate-500'>No eligible RG360 devices for this site.</p>}
      </div> : <p className='mb-3 rounded-lg border border-cyan-400/10 bg-cyan-400/5 px-3 py-2 text-xs text-cyan-100'>Broadcast to {eligibleDevices.length} eligible RG360 device(s) at this site.</p>}

      <div className='flex items-center gap-2'>
        {!recording ? <button type='button' onClick={startRecording} disabled={sending} className='inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-lg border border-red-400/30 bg-red-500/10 px-3 text-xs font-bold text-red-100 disabled:opacity-50'><Mic className='h-4 w-4' /> Record</button> : <button type='button' onClick={stopRecording} className='inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 text-xs font-bold text-amber-100'><Square className='h-4 w-4' /> Stop {formatDuration(elapsedMs)}</button>}
        <button type='button' onClick={sendRecording} disabled={sending || recording || !recordedBlob || recipientCount < 1} className='inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-cyan-300/35 bg-cyan-400/10 px-3 text-xs font-bold text-cyan-100 disabled:cursor-not-allowed disabled:opacity-50'><Send className='h-4 w-4' /> Send</button>
      </div>

      <p className='mt-2 text-center text-[11px] text-slate-500'>{recordedBlob ? `Ready ${formatDuration(elapsedMs)} for ${recipientCount} recipient(s)` : 'Record up to 60 seconds from the Control Room microphone.'}</p>
    </section>
  );
}
