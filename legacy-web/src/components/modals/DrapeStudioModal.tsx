import React, { useState } from 'react';
import { ArrowRight, Check, Mic, Sparkles, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { triggerHaptic } from '../../services/haptics';

interface DrapeStudioModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Jev settings surface. The camera is intentionally owned by MirrorScreen;
 * this panel only controls intent and wardrobe selection and never creates a second PiP camera.
 */
export const DrapeStudioModal: React.FC<DrapeStudioModalProps> = ({ isOpen, onClose }) => {
  const { garments, activeGarmentIds, liveMirror, sendStylistPrompt, wearGarment, setTab } = useApp();
  const [prompt, setPrompt] = useState('Bu akşam pub’a gidiyorum');
  const [isSending, setIsSending] = useState(false);

  if (!isOpen) return null;

  const askJev = async () => {
    if (!prompt.trim()) return;
    setIsSending(true);
    await sendStylistPrompt(prompt.trim());
    setIsSending(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/70 p-3 backdrop-blur-md">
      <section className="mx-auto max-h-[88dvh] w-full max-w-xl overflow-y-auto rounded-[30px] border border-white/15 bg-[#171615] p-4 text-white shadow-2xl">
        <div className="flex items-center justify-between">
          <div>
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-amber-200"><Sparkles className="h-3.5 w-3.5" /> Mirror ayarları</p>
            <p className="mt-1 text-[11px] text-white/55">Jev karar verir, canlı kamera Mirror’da kalır.</p>
          </div>
          <button type="button" onClick={onClose} className="mirror-icon-button"><X className="h-4 w-4" /></button>
        </div>

        <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-3">
          <div className="flex items-center gap-2 text-xs font-medium"><Mic className="h-4 w-4 text-amber-300" /> Jev’e söyle</div>
          <div className="mt-2 flex gap-2">
            <input value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void askJev(); }} className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-white outline-none focus:border-amber-200/70" />
            <button type="button" onClick={() => void askJev()} disabled={isSending} className="rounded-xl bg-amber-300 px-3 text-xs font-bold text-black disabled:opacity-50"><ArrowRight className="h-4 w-4" /></button>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-2xl bg-white/5 p-2"><p className="text-[9px] uppercase text-white/40">durum</p><p className="mt-1 text-xs font-semibold">{liveMirror.status}</p></div>
          <div className="rounded-2xl bg-white/5 p-2"><p className="text-[9px] uppercase text-white/40">AI süre</p><p className="mt-1 text-xs font-semibold">{liveMirror.remainingSeconds}s</p></div>
          <div className="rounded-2xl bg-white/5 p-2"><p className="text-[9px] uppercase text-white/40">parça</p><p className="mt-1 text-xs font-semibold">{activeGarmentIds.length}</p></div>
        </div>

        <p className="mt-4 text-[10px] uppercase tracking-[0.18em] text-white/45">Mirror rail’i</p>
        <div className="mt-2 grid grid-cols-4 gap-2">
          {garments.slice(0, 12).map((garment) => {
            const isActive = activeGarmentIds.includes(garment.id);
            return (
              <button key={garment.id} type="button" onClick={() => { triggerHaptic('selection'); wearGarment(garment.id); }} className={`relative rounded-2xl p-1.5 ${isActive ? 'bg-white ring-2 ring-amber-300' : 'bg-white/10'}`}>
                <div className="aspect-square rounded-xl bg-white/90 p-1"><img src={garment.cutoutUrl || garment.imageUrl} alt={garment.name} className="h-full w-full object-contain mix-blend-multiply" /></div>
                <p className={`mt-1 truncate text-[9px] ${isActive ? 'text-black' : 'text-white/75'}`}>{garment.name}</p>
                {isActive && <Check className="absolute right-2 top-2 h-3 w-3 text-black" />}
              </button>
            );
          })}
        </div>

        <button type="button" onClick={() => { onClose(); setTab('mirror'); }} className="mt-4 w-full rounded-2xl bg-white py-3 text-xs font-bold text-black">Canlı Mirror’a dön</button>
      </section>
    </div>
  );
};
