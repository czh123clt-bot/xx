/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { Plus, Trash2, X, Copy, Link as LinkIcon, Save, DownloadCloud } from 'lucide-react';
import mqtt from 'mqtt';

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
  
  const [audienceScreenMode, setAudienceScreenMode] = useState<'black' | 'iframe' | 'article'>('black');
  const [camouflageUrl, setCamouflageUrl] = useState('https://example.com');
  const [articleTitle, setArticleTitle] = useState('震惊！这个魔术太神奇了');
  const [articleAuthor, setArticleAuthor] = useState('魔术情报局');
  const [articleContent, setArticleContent] = useState('这是一篇伪装的文章内容...\n\n你可以随便写点什么，观众在阅读这篇文章的时候，你就可以在后台偷偷控制他们的闪光灯了！\n\n(你可以上下滑动阅读)');
  
  const [roomId, setRoomId] = useState<string>('');
  const [roomIdInput, setRoomIdInput] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isAudience, setIsAudience] = useState(false);
  const [audienceReady, setAudienceReady] = useState(false);
  
  const [mqttClient, setMqttClient] = useState<mqtt.MqttClient | null>(null);
  const [mqttConnected, setMqttConnected] = useState(false);

  const trackRef = useRef<MediaStreamTrack | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const blinkIntervalRef = useRef<number | null>(null);
  const isApplyingRef = useRef(false);
  const pressTimer = useRef<number | null>(null);
  const touchStartPos = useRef<{ x: number; y: number } | null>(null);
  const syncTimeoutRef = useRef<number | null>(null);
  const lastEventIdRef = useRef<string | null>(null);
  const tapCountRef = useRef<number>(0);
  const tapTimeoutRef = useRef<number | null>(null);
  const currentIndexRef = useRef(currentIndex);
  const redirectUrlRef = useRef(redirectUrl);
  const audienceDelayMsRef = useRef(audienceDelayMs);

  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  useEffect(() => {
    redirectUrlRef.current = redirectUrl;
  }, [redirectUrl]);

  useEffect(() => {
    audienceDelayMsRef.current = audienceDelayMs;
  }, [audienceDelayMs]);

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

      const saved = localStorage.getItem('blacklight-config');
      if (saved) {
        try {
          const config = JSON.parse(saved);
          if (config.sequence) setSequence(config.sequence);
          if (config.redirectUrl) setRedirectUrl(config.redirectUrl);
          if (config.audienceDelayMs !== undefined) setAudienceDelayMs(config.audienceDelayMs);
          if (config.audienceScreenMode) setAudienceScreenMode(config.audienceScreenMode);
          if (config.camouflageUrl) setCamouflageUrl(config.camouflageUrl);
          if (config.articleTitle) setArticleTitle(config.articleTitle);
          if (config.articleAuthor) setArticleAuthor(config.articleAuthor);
          if (config.articleContent) setArticleContent(config.articleContent);
        } catch (e) {}
      }
    }

    // Connect to EMQX Public Broker (Accessible in China without VPN)
    const client = mqtt.connect('wss://broker.emqx.io:8084/mqtt', {
      clientId: 'blacklight_' + Math.random().toString(16).substring(2, 10),
      keepalive: 60,
      clean: true,
    });

    client.on('connect', () => {
      console.log('MQTT Connected');
      setMqttConnected(true);
      setMqttClient(client);
      setError(null);
    });

    client.on('error', (err) => {
      console.error('MQTT Error:', err);
      setError('连接同步服务器失败，请检查网络');
    });

    return () => {
      client.end();
    };
  }, []);

  useEffect(() => {
    const config = { sequence, redirectUrl, audienceDelayMs, audienceScreenMode, camouflageUrl, articleTitle, articleAuthor, articleContent };
    localStorage.setItem('blacklight-config', JSON.stringify(config));
    
    // Auto-sync config to cloud so audience devices update immediately
    if (!isAudience && roomId && mqttClient && mqttConnected) {
      const configTopic = `blacklight/room/${roomId}/config`;
      const payload = JSON.stringify({
        ...config,
        updatedAt: Date.now()
      });
      // retain: true ensures late-joining audience members get the latest config immediately
      mqttClient.publish(configTopic, payload, { qos: 1, retain: true });
    }
  }, [sequence, redirectUrl, audienceDelayMs, audienceScreenMode, camouflageUrl, articleTitle, articleAuthor, articleContent, isAudience, roomId, mqttClient, mqttConnected]);

  useEffect(() => {
    const preventDefault = (e: Event) => e.preventDefault();
    document.addEventListener('contextmenu', preventDefault);
    return () => document.removeEventListener('contextmenu', preventDefault);
  }, []);

  // Audience Config Listener (Fetch settings like camouflage mode)
  useEffect(() => {
    if (!isAudience || !roomId || !mqttClient) return;

    const configTopic = `blacklight/room/${roomId}/config`;
    mqttClient.subscribe(configTopic);

    const handleConfigMessage = (topic: string, message: Buffer) => {
      if (topic === configTopic) {
        try {
          const data = JSON.parse(message.toString());
          if (data.audienceScreenMode) setAudienceScreenMode(data.audienceScreenMode);
          if (data.camouflageUrl) setCamouflageUrl(data.camouflageUrl);
          if (data.articleTitle) setArticleTitle(data.articleTitle);
          if (data.articleAuthor) setArticleAuthor(data.articleAuthor);
          if (data.articleContent) setArticleContent(data.articleContent);
        } catch (e) {
          console.error("Failed to parse config", e);
        }
      }
    };

    mqttClient.on('message', handleConfigMessage);

    return () => {
      mqttClient.unsubscribe(configTopic);
      mqttClient.off('message', handleConfigMessage);
    };
  }, [isAudience, roomId, mqttClient]);

  // Audience Sync Listener (Triggers)
  useEffect(() => {
    if (!isAudience || !roomId || !mqttClient || !audienceReady) return;

    const triggerTopic = `blacklight/room/${roomId}/trigger`;
    mqttClient.subscribe(triggerTopic);

    const handleMessage = (topic: string, message: Buffer) => {
      if (topic === triggerTopic) {
        try {
          const data = JSON.parse(message.toString());
          if (data.audienceState && data.audienceState !== 'ignore' && data.eventId) {
            // Prevent re-triggering the same event
            if (data.eventId === lastEventIdRef.current) return;
            lastEventIdRef.current = data.eventId;

            if (syncTimeoutRef.current) {
              clearTimeout(syncTimeoutRef.current);
            }

            const delay = data.delayMs || 0;
            if (delay > 0) {
              syncTimeoutRef.current = window.setTimeout(() => {
                applyMode(data.audienceState as LightMode, true, data.redirectUrl);
              }, delay);
            } else {
              applyMode(data.audienceState as LightMode, true, data.redirectUrl);
            }
          }
        } catch (e) {
          console.error("Failed to parse trigger message", e);
        }
      }
    };

    mqttClient.on('message', handleMessage);

    return () => {
      mqttClient.unsubscribe(triggerTopic);
      mqttClient.off('message', handleMessage);
    };
  }, [isAudience, roomId, mqttClient, audienceReady]);

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
        setError('无法访问摄像头: ' + (fallbackErr.message || 'Camera access denied'));
        setTimeout(() => setError(null), 5000);
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
    } catch (err: any) {
      console.error('Torch error:', err);
      setError('闪光灯控制失败 (Torch Error): ' + err.message);
      setTimeout(() => setError(null), 5000);
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

  const applyMode = async (mode: LightMode, isFromSync = false, syncRedirectUrl?: string) => {
    if (mode === 'ignore') return;
    
    stopBlinking();

    if (mode === 'redirect') {
      await setTorch(false);
      let finalUrl = (syncRedirectUrl || redirectUrlRef.current).trim();
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
    if (isAudience || !roomId) return;
    if (!mqttConnected || !mqttClient) {
      setError("未连接到同步服务器，请稍后再试！");
      setTimeout(() => setError(null), 5000);
      return;
    }
    
    try {
      const triggerTopic = `blacklight/room/${roomId}/trigger`;
      const payload = JSON.stringify({
        audienceState: step.audienceMode,
        delayMs: audienceDelayMsRef.current,
        redirectUrl: redirectUrlRef.current,
        eventId: Date.now().toString() + '-' + Math.random(),
        timestamp: Date.now()
      });

      mqttClient.publish(triggerTopic, payload, { qos: 1, retain: false });
      setError(null);
    } catch (err: any) {
      console.error("Failed to sync to audience:", err);
      setError("同步失败: " + err.message);
      setTimeout(() => setError(null), 5000);
    }
  };

  const triggerNextStep = async () => {
    if (isAudience) {
      if (!audienceReady) {
        const hasCamera = await initCamera();
        if (hasCamera) {
          setAudienceReady(true);
        }
      }
    } else {
      const nextIndex = (currentIndexRef.current + 1) % sequence.length;
      setCurrentIndex(nextIndex);
      const step = sequence[nextIndex];
      applyMode(step.mode);
      syncToAudience(step);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isSettingsOpen) return;
      
      const triggerKeys = [
        'AudioVolumeUp', 'AudioVolumeDown', 
        'VolumeUp', 'VolumeDown',
        'PageUp', 'PageDown', 
        'ArrowUp', 'ArrowDown',
        ' ', 'Enter'
      ];

      if (triggerKeys.includes(e.key)) {
        e.preventDefault();
        triggerNextStep();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSettingsOpen, isAudience, audienceReady, sequence]);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (isSettingsOpen) return;
    
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch (err) {}
    
    touchStartPos.current = { x: e.clientX, y: e.clientY };

    pressTimer.current = window.setTimeout(() => {
      if (!isAudience) {
        setIsSettingsOpen(true);
      } else {
        // Show a temporary hint if they long press in audience mode
        setError("当前为观众端，设置菜单已隐藏。");
        setTimeout(() => setError(null), 3000);
      }
      pressTimer.current = null;
      touchStartPos.current = null;
    }, 800);
  };

  const handlePointerUp = async (e: React.PointerEvent) => {
    if (isSettingsOpen) return;
    
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch (err) {}

    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;

      if (touchStartPos.current) {
        const dx = e.clientX - touchStartPos.current.x;
        const dy = e.clientY - touchStartPos.current.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < 20) {
          // Secret 5-tap to open settings in audience mode
          tapCountRef.current += 1;
          if (tapTimeoutRef.current) clearTimeout(tapTimeoutRef.current);
          tapTimeoutRef.current = window.setTimeout(() => {
            tapCountRef.current = 0;
          }, 1000);

          if (tapCountRef.current >= 5) {
            setIsSettingsOpen(true);
            tapCountRef.current = 0;
            return;
          }

          triggerNextStep();
        }
      }
    }
    touchStartPos.current = null;
  };

  const handlePointerCancel = (e: React.PointerEvent) => {
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch (err) {}
    
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
    if (!mqttConnected || !mqttClient) {
      alert('未连接到同步服务器，请检查网络。');
      return;
    }
    try {
      setIsSaving(true);
      const newRoomId = roomIdInput.trim().toUpperCase();
      const configTopic = `blacklight/room/${newRoomId}/config`;
      
      const payload = JSON.stringify({
        sequence,
        redirectUrl,
        audienceDelayMs,
        audienceScreenMode,
        camouflageUrl,
        articleTitle,
        articleAuthor,
        articleContent,
        updatedAt: Date.now()
      });
      
      mqttClient.publish(configTopic, payload, { qos: 1, retain: true }, (err) => {
        setIsSaving(false);
        if (err) {
          alert('保存失败: ' + err.message);
        } else {
          setRoomId(newRoomId);
          setRoomIdInput(newRoomId);
          localStorage.setItem('blacklight-room', newRoomId);
          alert('设置已成功保存到云端！\\n下次使用相同的房间号即可恢复设置。');
        }
      });
    } catch (err: any) {
      setIsSaving(false);
      console.error('Save failed', err);
      alert('保存失败: ' + err.message);
    }
  };

  const loadFromCloud = async () => {
    if (!roomIdInput.trim()) {
      alert('请输入房间号');
      return;
    }
    if (!mqttConnected || !mqttClient) {
      alert('未连接到同步服务器，请检查网络。');
      return;
    }
    try {
      setIsLoading(true);
      const targetRoomId = roomIdInput.trim().toUpperCase();
      const configTopic = `blacklight/room/${targetRoomId}/config`;
      
      const handleConfigMessage = (topic: string, message: Buffer) => {
        if (topic === configTopic) {
          try {
            const data = JSON.parse(message.toString());
            if (data.sequence) setSequence(data.sequence);
            if (data.redirectUrl) setRedirectUrl(data.redirectUrl);
            if (data.audienceDelayMs !== undefined) setAudienceDelayMs(data.audienceDelayMs);
            if (data.audienceScreenMode) setAudienceScreenMode(data.audienceScreenMode);
            if (data.camouflageUrl) setCamouflageUrl(data.camouflageUrl);
            if (data.articleTitle) setArticleTitle(data.articleTitle);
            if (data.articleAuthor) setArticleAuthor(data.articleAuthor);
            if (data.articleContent) setArticleContent(data.articleContent);
            
            setRoomId(targetRoomId);
            setRoomIdInput(targetRoomId);
            localStorage.setItem('blacklight-room', targetRoomId);
            alert('已成功加载云端设置！');
          } catch (e) {
            alert('加载失败：云端数据格式错误');
          } finally {
            setIsLoading(false);
            mqttClient.unsubscribe(configTopic);
            mqttClient.off('message', handleConfigMessage);
            clearTimeout(timeoutId);
          }
        }
      };

      mqttClient.subscribe(configTopic);
      mqttClient.on('message', handleConfigMessage);

      const timeoutId = setTimeout(() => {
        setIsLoading(false);
        mqttClient.unsubscribe(configTopic);
        mqttClient.off('message', handleConfigMessage);
        alert('未找到该房间号的云端设置，或加载超时。');
      }, 3000);

    } catch (err: any) {
      setIsLoading(false);
      console.error('Load failed', err);
      alert('加载失败: ' + err.message);
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
    <>
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        className="fixed top-0 left-0 opacity-0 pointer-events-none w-[1px] h-[1px] z-[-1]"
      />
      
      {error && (
        <div className="fixed top-4 left-4 right-4 bg-red-900/90 text-white p-4 rounded-lg z-[100] text-sm pointer-events-none shadow-lg">
          {error}
        </div>
      )}

      {isAudience ? (
        <div className="fixed inset-0 bg-black">
          {audienceScreenMode === 'iframe' && (
            <iframe 
              src={camouflageUrl} 
              className="w-full h-full border-none bg-white" 
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            />
          )}

          {audienceScreenMode === 'article' && (
            <div className="w-full h-full bg-white text-black overflow-y-auto p-5 pb-20">
              <h1 className="text-2xl font-bold mb-3 leading-snug">{articleTitle}</h1>
              <div className="text-blue-500 text-sm mb-6">{articleAuthor}</div>
              <div className="text-gray-800 text-base leading-relaxed whitespace-pre-wrap">
                {articleContent}
              </div>
            </div>
          )}
          
          {/* First tap overlay to init camera */}
          {!audienceReady && (
            <div 
              className={`absolute inset-0 z-50 flex items-center justify-center ${audienceScreenMode !== 'black' ? 'bg-white text-zinc-800' : 'bg-black text-zinc-600'}`}
              onPointerDown={async () => {
                const hasCamera = await initCamera();
                if (hasCamera) setAudienceReady(true);
              }}
            >
              {audienceScreenMode !== 'black' ? '点击屏幕继续访问...' : 'Tap anywhere to start'}
            </div>
          )}

          {/* Backdoor for settings (Top Right Corner) */}
          <div 
            className="absolute top-0 right-0 w-24 h-24 z-[60]" 
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            onPointerLeave={handlePointerCancel}
          />
        </div>
      ) : (
        <div
          className="fixed inset-0 bg-black touch-none select-none flex items-center justify-center"
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onPointerLeave={handlePointerCancel}
        >
          {/* Master view is just black */}
        </div>
      )}

      {isSettingsOpen && (
        <div 
          className="fixed inset-0 bg-zinc-900 text-white p-6 z-[100] overflow-y-auto touch-auto"
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
                复制此链接发送给观众。当您点击屏幕时，观众的手机会根据上面的设置同步变化。
              </p>
              
              <div className="mb-4 space-y-3">
                <label className="flex items-center gap-2 text-sm text-zinc-300">
                  <input 
                    type="radio" 
                    checked={audienceScreenMode === 'black'} 
                    onChange={() => setAudienceScreenMode('black')}
                    className="w-4 h-4"
                  />
                  纯黑屏幕 (默认)
                </label>
                <label className="flex items-center gap-2 text-sm text-zinc-300">
                  <input 
                    type="radio" 
                    checked={audienceScreenMode === 'iframe'} 
                    onChange={() => setAudienceScreenMode('iframe')}
                    className="w-4 h-4"
                  />
                  嵌入外部网页 (容易白屏)
                </label>
                <label className="flex items-center gap-2 text-sm text-zinc-300">
                  <input 
                    type="radio" 
                    checked={audienceScreenMode === 'article'} 
                    onChange={() => setAudienceScreenMode('article')}
                    className="w-4 h-4"
                  />
                  自定义文章 (推荐，100%成功)
                </label>
                
                {audienceScreenMode === 'iframe' && (
                  <div className="pl-6">
                    <input
                      type="url"
                      value={camouflageUrl}
                      onChange={(e) => setCamouflageUrl(e.target.value)}
                      placeholder="输入伪装网页的网址"
                      className="w-full bg-zinc-900 text-white border border-zinc-700 rounded p-2 outline-none focus:border-zinc-500 text-sm"
                    />
                    <p className="text-xs text-zinc-500 mt-1">注意：百度、微信等大厂网站会拦截嵌入导致白屏。建议使用下方“自定义文章”模式。</p>
                  </div>
                )}

                {audienceScreenMode === 'article' && (
                  <div className="pl-6 space-y-3">
                    <input
                      type="text"
                      value={articleTitle}
                      onChange={(e) => setArticleTitle(e.target.value)}
                      placeholder="文章标题"
                      className="w-full bg-zinc-900 text-white border border-zinc-700 rounded p-2 outline-none focus:border-zinc-500 text-sm font-bold"
                    />
                    <input
                      type="text"
                      value={articleAuthor}
                      onChange={(e) => setArticleAuthor(e.target.value)}
                      placeholder="公众号名称 / 作者"
                      className="w-full bg-zinc-900 text-white border border-zinc-700 rounded p-2 outline-none focus:border-zinc-500 text-sm text-blue-400"
                    />
                    <textarea
                      value={articleContent}
                      onChange={(e) => setArticleContent(e.target.value)}
                      placeholder="文章正文内容..."
                      rows={6}
                      className="w-full bg-zinc-900 text-white border border-zinc-700 rounded p-2 outline-none focus:border-zinc-500 text-sm resize-none"
                    />
                  </div>
                )}
              </div>

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
    </>
  );
}
