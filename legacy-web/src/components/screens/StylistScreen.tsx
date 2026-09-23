import React, { useState } from 'react';
import { Mic, MicOff, Send, Sparkles, ArrowRight, Bookmark, Check } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { triggerHaptic } from '../../services/haptics';

export const StylistScreen: React.FC = () => {
  const { stylistMessages, sendStylistPrompt, wearLook, setTab, garments, t, dailyJevDecisions, dailyJevLimit } = useApp();
  const [inputVal, setInputVal] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [savedLookToast, setSavedLookToast] = useState(false);

  const samplePrompts = [
    t.stylist.pubPrompt,
    t.stylist.coffeePrompt,
    t.stylist.dinnerPrompt,
    t.stylist.workPrompt,
  ];

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputVal.trim()) return;

    const query = inputVal;
    setInputVal('');
    await sendStylistPrompt(query);
  };

  const handlePromptClick = async (promptText: string) => {
    triggerHaptic('light');
    setInputVal(promptText);
    await sendStylistPrompt(promptText);
  };

  const handleMicToggle = () => {
    triggerHaptic('medium');
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setIsListening(!isListening);
      if (!isListening) {
        window.setTimeout(() => {
          setIsListening(false);
          setInputVal(t.stylist.pubPrompt);
          triggerHaptic('success');
        }, 1600);
      }
      return;
    }

    if (isListening) return;
    const recognition = new SpeechRecognition();
    recognition.lang = 'tr-TR';
    recognition.interimResults = false;
    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    recognition.onerror = () => setIsListening(false);
    recognition.onresult = (event: any) => {
      setInputVal(event.results?.[0]?.[0]?.transcript || '');
      triggerHaptic('success');
    };
    recognition.start();
  };

  const handleTryOnStylistLook = (garmentIds?: string[]) => {
    if (garmentIds && garmentIds.length > 0) {
      wearLook(garmentIds);
      setTab('mirror');
    }
  };

  const handleSaveLook = () => {
    triggerHaptic('success');
    setSavedLookToast(true);
    setTimeout(() => setSavedLookToast(false), 2000);
  };

  return (
    <div
      id="screen-ai-stylist"
      className="flex-1 w-full bg-[#FBF9F5] px-5 py-3 flex flex-col justify-between overflow-y-auto no-scrollbar"
    >
      {/* Top Header */}
      <div>
        <div className="flex items-center justify-between pt-1 pb-3">
          <div>
            <h1 className="font-serif text-3xl text-[#1A1918] font-normal tracking-tight">
              {t.stylist.title}
            </h1>
            <p className="text-xs text-[#78746D] mt-0.5">
              {t.stylist.subtitle}
            </p>
            <p className="mt-1 text-[10px] font-medium uppercase tracking-wider text-[#A06A22]">
              Jev {dailyJevDecisions}/{dailyJevLimit} kombin
            </p>
          </div>
          <div className="w-8 h-8 rounded-full bg-[#EFECE6] border border-[#E8E4DC] flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-[#1A1918]" />
          </div>
        </div>

        {/* Quick prompt suggestions chips */}
        <div className="flex space-x-2 overflow-x-auto no-scrollbar pb-3 -mx-5 px-5">
          {samplePrompts.map((prompt, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => handlePromptClick(prompt)}
              className="text-[11px] whitespace-nowrap px-3 py-1.5 rounded-full bg-[#EFECE6] border border-[#E8E4DC] text-[#68655E] hover:text-[#1A1918] hover:border-[#1A1918]/40 transition-colors cursor-pointer"
            >
              {prompt}
            </button>
          ))}
        </div>
      </div>

      {/* Messages Conversation Stream */}
      <div className="flex-1 space-y-4 py-2 overflow-y-auto no-scrollbar">
        {stylistMessages.map((msg) => {
          const isUser = msg.sender === 'user';

          if (isUser) {
            return (
              <div key={msg.id} className="flex justify-end">
                <div className="max-w-[82%] bg-[#1A1918] text-[#FBF9F5] rounded-2xl rounded-tr-xs px-4 py-2.5 text-xs font-light leading-relaxed shadow-xs">
                  {msg.text}
                </div>
              </div>
            );
          }

          return (
            <div key={msg.id} className="flex flex-col space-y-2.5 max-w-[94%]">
              {/* Stylist text bubble */}
              <div className="bg-[#EFECE6] border border-[#E8E4DC] rounded-2xl rounded-tl-xs p-3.5 text-xs text-[#1A1918] leading-relaxed">
                <p>{msg.text}</p>
              </div>

              {/* Visual Look Card & Garment Chips if included in recommendation */}
              {msg.outfitPreviewUrl && (
                <div className="bg-[#EFECE6] border border-[#E8E4DC] rounded-2xl p-3 space-y-2.5 shadow-xs">
                  <div className="w-full aspect-[4/5] rounded-xl overflow-hidden bg-black/5 relative group">
                    <img
                      src={msg.outfitPreviewUrl}
                      alt={msg.lookTitle || 'Stylist Look'}
                      className="w-full h-full object-cover group-hover:scale-102 transition-transform duration-300"
                    />
                    {msg.lookTitle && (
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent p-3 text-white">
                        <span className="font-serif text-sm italic">{msg.lookTitle}</span>
                      </div>
                    )}
                  </div>

                  {/* Garment Chips (Garments from user's real wardrobe) */}
                  {msg.garmentIds && (
                    <div className="space-y-1">
                      <p className="text-[10px] text-[#78746D] uppercase tracking-wider font-medium">
                        {t.stylist.piecesFromCloset}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {msg.garmentIds.map((gId) => {
                          const piece = garments.find((g) => g.id === gId);
                          return (
                            <span
                              key={gId}
                              className="text-[10px] bg-white text-[#1A1918] px-2.5 py-1 rounded-md border border-[#E8E4DC] font-medium"
                            >
                              {piece ? piece.name : gId.replace('g_', '').replace('_', ' ')}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Quick Actions: Try On & Save */}
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => handleTryOnStylistLook(msg.garmentIds)}
                      className="py-2 px-3 rounded-xl bg-[#1A1918] text-[#FBF9F5] text-xs font-medium flex items-center justify-center space-x-1.5 hover:bg-[#2C2B29] transition-colors cursor-pointer"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>{t.stylist.tryOn}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveLook}
                      className="py-2 px-3 rounded-xl bg-white text-[#1A1918] border border-[#E8E4DC] text-xs font-medium flex items-center justify-center space-x-1.5 hover:bg-[#F5F2EB] transition-colors cursor-pointer"
                    >
                      <Bookmark className="w-3.5 h-3.5" />
                      <span>{t.stylist.saveLook}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {savedLookToast && (
          <div className="px-3 py-1.5 rounded-full bg-[#1A1918] text-[#FBF9F5] text-xs font-medium mx-auto text-center w-max flex items-center space-x-1.5">
            <Check className="w-3 h-3" />
            <span>{t.stylist.savedToast}</span>
          </div>
        )}
      </div>

      {/* Input Field & Speech Microphone Bar */}
      <form
        onSubmit={handleSubmit}
        className="pt-2 sticky bottom-0 bg-[#FBF9F5]/90 backdrop-blur-md pb-1 flex items-center space-x-2"
      >
        <button
          type="button"
          id="btn-stylist-mic"
          onClick={handleMicToggle}
          className={`w-10 h-10 rounded-full flex items-center justify-center transition-all cursor-pointer ${
            isListening
              ? 'bg-rose-600 text-white animate-pulse'
              : 'bg-[#EFECE6] border border-[#E8E4DC] text-[#68655E] hover:text-[#1A1918]'
          }`}
          title={isListening ? 'Listening…' : 'Tap to speak'}
        >
          {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
        </button>

        <div className="relative flex-1">
          <input
            type="text"
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            placeholder={isListening ? '...' : t.stylist.placeholder}
            className="w-full pl-3.5 pr-10 py-2.5 text-xs bg-[#EFECE6] border border-transparent focus:border-[#D5D0C6] focus:bg-white rounded-xl text-[#1A1918] placeholder-[#8C877E] outline-none transition-all"
          />
          <button
            type="submit"
            disabled={!inputVal.trim()}
            className={`absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full flex items-center justify-center transition-colors ${
              inputVal.trim()
                ? 'bg-[#1A1918] text-[#FBF9F5] cursor-pointer'
                : 'text-[#A39E93] cursor-not-allowed'
            }`}
          >
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </form>
    </div>
  );
};
