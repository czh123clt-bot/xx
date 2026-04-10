/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { Plus, Trash2, X, Copy, Link as LinkIcon, Save, DownloadCloud } from 'lucide-react';
import { db, auth, signIn } from './firebase';
import { doc, setDoc, getDoc, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';

type LightMode = 'on' | 'off' | 'sos' | 'strobe' | 'redirect' | 'ignore';

interface SequenceStep {
  id: string;
  mode: LightMode;
  audienceMode: LightMode;
}

const DEFAULT_SEQUENCE: SequenceStep[] = [
  { id: '1', mode: 'on', audienceMode: 'off' },
  { id: '2', mode: 'off', audienceMode: 'on' },
  { id: '3', mode: 'sos', audienceMode: 'ignore' },
  { id: '4', mode: 'redirect', audienceMode: 'ignore' },
];

export default function App() {
  const [sequence, setSequence] = useState<SequenceStep[]>(DEFAULT_SEQUENCE);
  const [redirectUrl, setRedirectUrl] = useState('https://www.baidu.com');
  const [audienceDelayMs, setAudienceDelayMs] = useState(2000);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [audienceCopied, setAudienceCopied] = useState(false);
  
  const [roomId, setRoomId] = useState<string>('');
  const [roomIdInput, setRoomIdInput] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isAudience, setIsAudience] = useState(false);
  const [audienceReady, setAudienceReady] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  const trackRef = useRef<MediaStreamTrack | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const blinkIntervalRef = useRef<number | null>(null);
  const isApplyingRef = useRef(false);
  const pressTimer = useRef<number | null>(null);
  const touchStartPos = useRef<{ x: number; y: number } | null>(null);
  const syncTimeoutRef = useRef<number | null>(null);
  const lastTriggerTimeRef = useRef<number>(0);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const room = params.get('room');
    if (room) {
      setIsAudience(true);
      setRoomId(room);
    } else {
      let savedRoom = localStorage.getItem('blacklight-room');
      if (!savedRoom) {
        savedRoom = Math.random().toString(36).substring(2, 8).toUpperCase();
        localStorage.setItem('blacklight-room', savedRoom);
      }
      setRoomId(savedRoom);
      setRoomIdInput(savedRoom);

      // Try to load cloud config for this room
      getDoc(doc(db, 'configs', savedRoom)).then(snapshot => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          if (data.sequence) setSequence(data.sequence);
          if (data.redirectUrl) setRedirectUrl(data.redirectUrl);
          if (data.audienceDelayMs !== undefined) setAudienceDelayMs(data.audienceDelayMs);
        } else {
          // Fallback to local storage config if cloud doesn't exist
          const saved = localStorage.getItem('blacklight-config');
          if (saved) {
            try {
              const config = JSON.parse(saved);
              if (config.sequence) setSequence(config.sequence);
              if (config.redirectUrl) setRedirectUrl(config.redirectUrl);
              if (config.audienceDelayMs !== undefined) setAudienceDelayMs(config.audienceDelayMs);
            } catch (e) {}
          }
        }
      }).catch(err => console.error("Failed to load initial config:", err));
    }

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (user) {
        setUserId(user.uid);
      } else {
        signIn();
      }
    });

    return () => unsubscribeAuth();
  }, []);

  useEffect(() => {
    const config = { sequence, redirectUrl, audienceDelayMs };
    localStorage.setItem('blacklight-config', JSON.stringify(config));
  }, [sequence, redirectUrl, audienceDelayMs]);

  useEffect(() => {
    const preventDefault = (e: Event) => e.preventDefault();
    document.addEventListener('contextmenu', preventDefault);
    return () => document.removeEventListener('contextmenu', preventDefault);
  }, []);

  // Audience Sync Listener
  useEffect(() => {
    if (!isAudience || !roomId || !userId || !audienceReady) return;

    const unsubscribe = onSnapshot(doc(db, 'rooms', roomId), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        if (data.audienceState && data.audienceState !== 'ignore' && data.triggerTime) {
          // Prevent re-triggering the same event
          if (data.triggerTime === lastTriggerTimeRef.current) return;
          lastTriggerTimeRef.current = data.triggerTime;

          const now = Date.now();
          const timeUntilTrigger = data.triggerTime - now;

          if (syncTimeoutRef.current) {
            clearTimeout(syncTimeoutRef.current);
          }

          if (timeUntilTrigger > 0) {
            syncTimeoutRef.current = window.setTimeout(() => {
              applyMode(data.audienceState as LightMode, true);
            }, timeUntilTrigger);
          } else if (timeUntilTrigger > -5000) {
            // If we missed it but it's within 5 seconds, apply immediately
            applyMode(data.audienceState as LightMode, true);
          }
        }
      }
    }, (err) => {
      console.error("Firestore listen error:", err);
    });

    return () => unsubscribe();
  }, [isAudience, roomId, userId, audienceReady]);

  const initCamera = async () => {
    if (trackRef.current) return true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { exact: 'environment' } },
      });
      trackRef.current = stream.getVideoTracks()[0];
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(e => console.error('Video play error:', e));
      }
      return true;
    } catch (err: any) {
      console.error('Camera access error:', err);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
        });
        trackRef.current = stream.getVideoTracks()[0];
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(e => console.error('Video play error:', e));
        }
        return true;
      } catch (fallbackErr: any) {
        setError(fallbackErr.message || '无法访问摄像头 (Camera access denied)');
        return false;
      }
    }
  };

  const setTorch = async (on: boolean) => {
    if (!trackRef.current) return;
    if (isApplyingRef.current) return;
    isApplyingRef.current = true;
    try {
      await trackRef.current.applyConstraints({
        advanced: [{ torch: on }],
      });
    } catch (err) {
      console.error('Torch error:', err);
    } finally {
      isApplyingRef.current = false;
    }
  };

  const stopBlinking = () => {
    if (blinkIntervalRef.current) {
      window.clearTimeout(blinkIntervalRef.current);
      blinkIntervalRef.current = null;
    }
  };

  const applyMode = async (mode: LightMode, isFromSync = false) => {
    if (mode === 'ignore') return;
    
    stopBlinking();

    if (mode === 'redirect') {
      await setTorch(false);
      let finalUrl = redirectUrl.trim();
      if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
        finalUrl = 'https://' + finalUrl;
      }
      window.location.replace(finalUrl);
      return;
    }

    const hasCamera = await initCamera();
    if (!hasCamera) return;

    if (mode === 'on') {
      await setTorch(true);
    } else if (mode === 'off') {
      await setTorch(false);
    } else if (mode === 'strobe') {
      let isOn = false;
      const tick = async () => {
        isOn = !isOn;
        await setTorch(isOn);
        blinkIntervalRef.current = window.setTimeout(tick, 100);
      };
      tick();
    } else if (mode === 'sos') {
      let step = 0;
      const pattern = [
        1, 0, 1, 0, 1, 0, // S
        0, 0,             // gap
        3, 0, 3, 0, 3, 0, // O
        0, 0,             // gap
        1, 0, 1, 0, 1, 0, // S
        0, 0, 0, 0, 0, 0  // gap
      ];

      const tick = async () => {
        const val = pattern[step];
        if (val > 0) {
          await setTorch(true);
          blinkIntervalRef.current = window.setTimeout(async () => {
            await setTorch(false);
            step = (step + 1) % pattern.length;
            blinkIntervalRef.current = window.setTimeout(tick, 200);
          }, val * 200);
        } else {
          await setTorch(false);
          step = (step + 1) % pattern.length;
          blinkIntervalRef.current = window.setTimeout(tick, 200);
        }
      };
      tick();
    }
  };

  const syncToAudience = async (step: SequenceStep) => {
    if (isAudience || !roomId || !userId) return;
    
    try {
      const triggerTime = Date.now() + audienceDelayMs;
      await setDoc(doc(db, 'rooms', roomId), {
        masterState: step.mode,
        audienceState: step.audienceMode,
        triggerTime,
        delayMs: audienceDelayMs,
        createdAt: Date.now()
      });
    } catch (err) {
      console.error("Failed to sync to audience:", err);
    }
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (isSettingsOpen) return;
    touchStartPos.current = { x: e.clientX, y: e.clientY };

    pressTimer.current = window.setTimeout(() => {
      if (!isAudience) {
        setIsSettingsOpen(true);
      }
      pressTimer.current = null;
      touchStartPos.current = null;
    }, 800);
  };

  const handlePointerUp = async (e: React.PointerEvent) => {
    if (isSettingsOpen) return;

    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;

      if (touchStartPos.current) {
        const dx = e.clientX - touchStartPos.current.x;
        const dy = e.clientY - touchStartPos.current.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < 20) {
          if (isAudience) {
            if (!audienceReady) {
              const hasCamera = await initCamera();
              if (hasCamera) {
                setAudienceReady(true);
              }
            }
          } else {
            const nextIndex = (currentIndex + 1) % sequence.length;
            setCurrentIndex(nextIndex);
            const step = sequence[nextIndex];
            applyMode(step.mode);
            syncToAudience(step);
          }
        }
      }
    }
    touchStartPos.current = null;
  };

  const handlePointerCancel = () => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
    touchStartPos.current = null;
  };

  const copySyncLink = () => {}; // Removed, kept empty to avoid unused variable errors if any left

  const saveToCloud = async () => {
    if (!roomIdInput.trim()) {
      alert('请输入房间号');
      return;
    }
    try {
      setIsSaving(true);
      const newRoomId = roomIdInput.trim().toUpperCase();
      
      await setDoc(doc(db, 'configs', newRoomId), {
        sequence,
        redirectUrl,
        audienceDelayMs,
        updatedAt: serverTimestamp()
      });
      
      setRoomId(newRoomId);
      setRoomIdInput(newRoomId);
      localStorage.setItem('blacklight-room', newRoomId);
      
      alert('设置已成功保存到云端！\\n下次使用相同的房间号即可恢复设置。');
    } catch (err) {
      console.error('Save failed', err);
      alert('保存失败，请重试');
    } finally {
      setIsSaving(false);
    }
  };

  const loadFromCloud = async () => {
    if (!roomIdInput.trim()) {
      alert('请输入房间号');
      return;
    }
    try {
      setIsLoading(true);
      const targetRoomId = roomIdInput.trim().toUpperCase();
      const snapshot = await getDoc(doc(db, 'configs', targetRoomId));
      
      if (snapshot.exists()) {
        const data = snapshot.data();
        if (data.sequence) setSequence(data.sequence);
        if (data.redirectUrl) setRedirectUrl(data.redirectUrl);
        if (data.audienceDelayMs !== undefined) setAudienceDelayMs(data.audienceDelayMs);
        
        setRoomId(targetRoomId);
        setRoomIdInput(targetRoomId);
        localStorage.setItem('blacklight-room', targetRoomId);
        alert('已成功加载云端设置！');
      } else {
        alert('未找到该房间号的云端设置。');
      }
    } catch (err) {
      console.error('Load failed', err);
      alert('加载失败，请重试');
    } finally {
      setIsLoading(false);
    }
  };

  const copyAudienceLink = () => {
    const link = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
    navigator.clipboard.writeText(link).then(() => {
      setAudienceCopied(true);
      setTimeout(() => setAudienceCopied(false), 2000);
    }).catch(err => {
      console.error('Copy failed', err);
      alert('复制失败，请手动复制: ' + link);
    });
  };

  return (
    <div
      className="fixed inset-0 bg-black touch-none select-none flex items-center justify-center"
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onPointerLeave={handlePointerCancel}
    >
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        className="absolute opacity-0 pointer-events-none w-[1px] h-[1px]"
      />
      
      {isAudience && !audienceReady && (
        <div className="text-zinc-800 text-sm pointer-events-none">
          Tap anywhere to start
        </div>
      )}

      {isSettingsOpen && !isAudience && (
        <div 
          className="fixed inset-0 bg-zinc-900 text-white p-6 z-50 overflow-y-auto touch-auto"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="flex justify-between items-center mb-8 max-w-md mx-auto">
            <h2 className="text-2xl font-bold">设置 (Settings)</h2>
            <button
              onClick={() => setIsSettingsOpen(false)}
              className="p-2 bg-zinc-800 rounded-full hover:bg-zinc-700 transition-colors"
            >
              <X size={24} />
            </button>
          </div>

          <div className="space-y-8 max-w-md mx-auto pb-12">
            <div>
              <h3 className="text-lg font-medium mb-4 text-zinc-400">点击序列 (Tap Sequence)</h3>
              <div className="space-y-4">
                {sequence.map((step, index) => (
                  <div key={step.id} className="bg-zinc-800 p-4 rounded-lg space-y-3">
                    <div className="flex items-center gap-3">
                      <span className="text-zinc-500 font-mono w-6">{index + 1}.</span>
                      <div className="flex-1">
                        <label className="text-xs text-zinc-500 block mb-1">我的手机 (Master)</label>
                        <select
                          value={step.mode}
                          onChange={(e) => {
                            const newSeq = [...sequence];
                            newSeq[index].mode = e.target.value as LightMode;
                            setSequence(newSeq);
                          }}
                          className="w-full bg-zinc-700 text-white rounded p-2 outline-none"
                        >
                          <option value="on">打开 (On)</option>
                          <option value="off">关闭 (Off)</option>
                          <option value="sos">SOS 闪烁 (SOS)</option>
                          <option value="strobe">爆闪 (Strobe)</option>
                          <option value="redirect">跳转网站 (Redirect)</option>
                        </select>
                      </div>
                      <button
                        onClick={() => {
                          if (sequence.length <= 1) return;
                          setSequence(sequence.filter((s) => s.id !== step.id));
                        }}
                        className="p-2 text-red-400 hover:bg-red-400/10 rounded transition-colors mt-5"
                      >
                        <Trash2 size={20} />
                      </button>
                    </div>
                    <div className="flex items-center gap-3 pl-9">
                      <div className="flex-1">
                        <label className="text-xs text-zinc-500 block mb-1">观众手机 (Audience)</label>
                        <select
                          value={step.audienceMode}
                          onChange={(e) => {
                            const newSeq = [...sequence];
                            newSeq[index].audienceMode = e.target.value as LightMode;
                            setSequence(newSeq);
                          }}
                          className="w-full bg-zinc-700 text-white rounded p-2 outline-none border border-zinc-600"
                        >
                          <option value="ignore">无动作 (Ignore)</option>
                          <option value="on">打开 (On)</option>
                          <option value="off">关闭 (Off)</option>
                          <option value="sos">SOS 闪烁 (SOS)</option>
                          <option value="strobe">爆闪 (Strobe)</option>
                          <option value="redirect">跳转网站 (Redirect)</option>
                        </select>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <button
                onClick={() => {
                  setSequence([...sequence, { id: Date.now().toString(), mode: 'on', audienceMode: 'ignore' }]);
                }}
                className="mt-4 flex items-center justify-center gap-2 w-full py-3 border-2 border-dashed border-zinc-700 rounded-lg text-zinc-400 hover:text-white hover:border-zinc-500 transition-colors"
              >
                <Plus size={20} /> 添加步骤 (Add Step)
              </button>
            </div>

            <div className="bg-zinc-800 p-4 rounded-lg">
              <h3 className="text-lg font-medium mb-2 text-zinc-300">观众同步延迟 (Audience Delay)</h3>
              <p className="text-sm text-zinc-500 mb-3">设置观众手机在您点击后，延迟多少毫秒触发动作。</p>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min="0"
                  max="5000"
                  step="100"
                  value={audienceDelayMs}
                  onChange={(e) => setAudienceDelayMs(Number(e.target.value))}
                  className="flex-1"
                />
                <span className="text-white font-mono w-16 text-right">{audienceDelayMs}ms</span>
              </div>
            </div>

            <div className="bg-zinc-800 p-4 rounded-lg border border-blue-500/30">
              <h3 className="text-lg font-medium mb-2 text-blue-400">观众链接 (Audience Link)</h3>
              <p className="text-sm text-zinc-400 mb-4">
                复制此链接发送给观众。观众打开后屏幕全黑，当您点击屏幕时，观众的手机会根据上面的设置同步变化。
              </p>
              <button
                onClick={copyAudienceLink}
                className="flex items-center justify-center gap-2 w-full py-3 bg-blue-600 hover:bg-blue-500 rounded-lg text-white transition-colors"
              >
                {audienceCopied ? <span className="text-white">已复制！</span> : <><LinkIcon size={20} /> 复制观众链接</>}
              </button>
            </div>

            <div className="bg-zinc-800 p-4 rounded-lg">
              <h3 className="text-lg font-medium mb-2 text-zinc-300">跳转网址设置</h3>
              <p className="text-sm text-zinc-500 mb-3">当序列中执行到“跳转网站”时，将打开此链接。</p>
              <input
                type="url"
                value={redirectUrl}
                onChange={(e) => setRedirectUrl(e.target.value)}
                placeholder="https://www.baidu.com"
                className="w-full bg-zinc-900 text-white border border-zinc-700 rounded-lg p-3 outline-none focus:border-zinc-500"
              />
            </div>

            <div className="bg-zinc-800 p-4 rounded-lg">
              <h3 className="text-lg font-medium mb-2 text-zinc-300">云端同步与房间号</h3>
              <p className="text-sm text-zinc-500 mb-4">
                设置一个专属房间号。保存后，在其他手机输入相同房间号并点击“加载”，即可恢复所有设置。观众链接也会固定不变。
              </p>
              
              <div className="flex items-center gap-3 mb-4">
                <input
                  type="text"
                  value={roomIdInput}
                  onChange={(e) => setRoomIdInput(e.target.value.toUpperCase())}
                  placeholder="输入专属房间号"
                  className="flex-1 bg-zinc-900 text-white border border-zinc-700 rounded-lg p-3 outline-none focus:border-zinc-500 font-mono text-center tracking-widest uppercase"
                />
              </div>

              <div className="flex gap-3">
                <button
                  onClick={loadFromCloud}
                  disabled={isLoading || isSaving}
                  className="flex-1 flex items-center justify-center gap-2 py-3 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 rounded-lg text-white transition-colors"
                >
                  <DownloadCloud size={20} /> {isLoading ? '加载中...' : '从云端加载'}
                </button>
                <button
                  onClick={saveToCloud}
                  disabled={isLoading || isSaving}
                  className="flex-1 flex items-center justify-center gap-2 py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-white transition-colors"
                >
                  <Save size={20} /> {isSaving ? '保存中...' : '保存到云端'}
                </button>
              </div>
            </div>

            {error && (
              <div className="bg-red-500/20 text-red-200 p-4 rounded-lg text-sm">
                {error}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
