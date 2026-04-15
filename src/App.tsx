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
  
  const [audienceScreenMode, setAudienceScreenMode] = useState<'black' | 'iframe' | 'article' | 'apple'>('black');
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
  const triggerNextStepRef = useRef<() => void>();
  const applyModeRef = useRef<any>(null);

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
      const liveConfigTopic = `blacklight/room/${roomId}/live_config`;
      const payload = JSON.stringify({
        ...config,
        updatedAt: Date.now()
      });
      // retain: true ensures late-joining audience members get the latest config immediately
      mqttClient.publish(liveConfigTopic, payload, { qos: 1, retain: true });
    }
  }, [sequence, redirectUrl, audienceDelayMs, audienceScreenMode, camouflageUrl, articleTitle, articleAuthor, articleContent, isAudience, roomId, mqttClient, mqttConnected]);

  useEffect(() => {
    const preventDefault = (e: Event) => e.preventDefault();
    document.addEventListener('contextmenu', preventDefault);
    return () => document.removeEventListener('contextmenu', preventDefault);
  }, []);

  // Update document title based on mode
  useEffect(() => {
    if (isAudience) {
      if (audienceScreenMode === 'apple') {
        document.title = '在iPhone 或 iPad Pro 上打开或关闭手电筒 - 官方 Apple 支持';
      } else if (audienceScreenMode === 'article') {
        document.title = articleTitle || '文章阅读';
      } else if (audienceScreenMode === 'iframe') {
        document.title = '加载中...';
      } else {
        document.title = '\u200B'; // 零宽字符，让标题栏看起来是空的
      }
    } else {
      document.title = 'Blacklight 控制端';
    }
  }, [isAudience, audienceScreenMode, articleTitle]);

  // Audience Config Listener (Fetch settings like camouflage mode)
  useEffect(() => {
    if (!isAudience || !roomId || !mqttClient) return;

    const liveConfigTopic = `blacklight/room/${roomId}/live_config`;
    mqttClient.subscribe(liveConfigTopic);

    const handleConfigMessage = (topic: string, message: Buffer) => {
      if (topic === liveConfigTopic) {
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
      mqttClient.unsubscribe(liveConfigTopic);
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

  applyModeRef.current = applyMode;

  useEffect(() => {
    triggerNextStepRef.current = triggerNextStep;
  }, [triggerNextStep]);

  // Direct Webhook Listener for Audience (ntfy.sh) - Direct Command Override
  useEffect(() => {
    if (!isAudience || !roomId) return;

    const topic = `blacklight_direct_${roomId.toLowerCase()}`;
    const eventSource = new EventSource(`https://ntfy.sh/${topic}/sse`);

    eventSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.event === 'message') {
          const command = data.message.trim().toLowerCase();
          if (['on', 'off', 'blink', 'redirect'].includes(command)) {
            if (applyModeRef.current) {
              applyModeRef.current(command as LightMode, true);
            }
          }
        }
      } catch (err) {
        console.error("Direct webhook parse error", err);
      }
    };

    return () => {
      eventSource.close();
    };
  }, [isAudience, roomId]);

  // Webhook Listener for iOS Shortcuts (ntfy.sh)
  useEffect(() => {
    if (isAudience || !roomId) return;

    const topic = `blacklight_trigger_${roomId.toLowerCase()}`;
    const eventSource = new EventSource(`https://ntfy.sh/${topic}/sse`);

    eventSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.event === 'message') {
          if (triggerNextStepRef.current) {
            triggerNextStepRef.current();
          }
        }
      } catch (err) {
        console.error("Webhook parse error", err);
      }
    };

    return () => {
      eventSource.close();
    };
  }, [isAudience, roomId]);

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
      const savedConfigTopic = `blacklight/room/${newRoomId}/saved_config`;
      
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
      
      mqttClient.publish(savedConfigTopic, payload, { qos: 1, retain: true }, (err) => {
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
      const savedConfigTopic = `blacklight/room/${targetRoomId}/saved_config`;
      
      const handleConfigMessage = (topic: string, message: Buffer) => {
        if (topic === savedConfigTopic) {
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
            mqttClient.unsubscribe(savedConfigTopic);
            mqttClient.off('message', handleConfigMessage);
            clearTimeout(timeoutId);
          }
        }
      };

      mqttClient.on('message', handleConfigMessage);
      mqttClient.subscribe(savedConfigTopic);

      const timeoutId = setTimeout(() => {
        setIsLoading(false);
        mqttClient.unsubscribe(savedConfigTopic);
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

          {audienceScreenMode === 'apple' && (
            <div className="w-full h-full bg-white text-[#1d1d1f] overflow-y-auto font-[-apple-system,BlinkMacSystemFont,'Segoe_UI',Roboto,Helvetica,Arial,sans-serif]">
              {/* Apple Nav Bar */}
              <div className="h-12 bg-white border-b border-gray-200 flex items-center justify-between px-4 sticky top-0 z-10">
                <svg viewBox="0 0 14 44" width="14" height="44" className="fill-current text-black/80"><path d="M13.0729 17.6822C13.0485 14.7619 15.4727 13.3344 15.5866 13.2612C14.1634 11.1813 11.9692 10.864 11.2206 10.8396C9.3496 10.6444 7.5193 11.9378 6.5513 11.9378C5.5589 11.9378 4.0703 10.864 2.5166 10.8884C0.5155 10.9128 -1.2578 12.0598 -2.2827 13.8412C-4.3814 17.4773 -2.722 22.846 -0.6721 25.8232C0.3284 27.2874 1.5079 28.9468 3.0616 28.898C4.5421 28.8492 5.1115 27.9463 6.8604 27.9463C8.5848 27.9463 9.1054 28.898 10.6591 28.8736C12.2616 28.8492 13.2621 27.3606 14.2383 25.8964C15.3852 24.2126 15.857 22.5776 15.8814 22.48C15.8326 22.48 13.0973 21.4307 13.0729 17.6822ZM9.431 8.2528C10.2526 7.2523 10.8057 5.8613 10.6593 4.4697C9.4635 4.5185 7.9993 5.275 7.1452 6.2755C6.3887 7.154 5.7379 8.5694 5.9087 9.936C7.2346 10.0336 8.6094 9.2527 9.431 8.2528Z" transform="translate(3 -4)"/></svg>
                <div className="flex gap-6 text-black/80">
                  <svg viewBox="0 0 15 44" width="15" height="44" className="fill-current"><path d="M14.298 27.144c-.236-.235-.618-.235-.853 0l-3.415 3.414a6.66 6.66 0 0 0-4.048-1.353c-3.69 0-6.692 3.003-6.692 6.693 0 3.69 3.002 6.692 6.692 6.692 3.69 0 6.692-3.002 6.692-6.692a6.66 6.66 0 0 0-1.353-4.048l3.414-3.415c.235-.235.235-.617 0-.853l-.437-.438zM5.982 41.383c-3.025 0-5.486-2.46-5.486-5.485 0-3.025 2.46-5.486 5.486-5.486 3.025 0 5.485 2.461 5.485 5.486 0 3.025-2.46 5.485-5.485 5.485z" transform="translate(0 -13)"/></svg>
                  <svg viewBox="0 0 14 44" width="14" height="44" className="fill-current"><path d="M11.5 28.5c0-.276-.224-.5-.5-.5h-8c-.276 0-.5.224-.5.5v1c0 .276.224.5.5.5h8c.276 0 .5-.224.5-.5v-1zm0-5c0-.276-.224-.5-.5-.5h-8c-.276 0-.5.224-.5.5v1c0 .276.224.5.5.5h8c.276 0 .5-.224.5-.5v-1z" transform="translate(1 -6)"/></svg>
                </div>
              </div>

              {/* Breadcrumb */}
              <div className="px-5 py-4 text-xs text-gray-500 flex items-center gap-2">
                <span className="text-[#06c]">Apple</span>
                <span>&gt;</span>
                <span className="text-[#06c]">支持</span>
                <span>&gt;</span>
                <span>在 iPhone 或 iPad Pro 上打开或关闭手电筒</span>
              </div>

              {/* Content */}
              <div className="px-5 pb-12">
                <h1 className="text-[40px] font-semibold leading-[1.1] tracking-tight mb-6">
                  在 iPhone 或 iPad Pro 上打开或关闭手电筒
                </h1>
                
                <p className="text-[17px] leading-[1.47] mb-6">
                  你的 iPhone 或 iPad Pro 上的 LED 闪光灯还可用作手电筒，方便你在需要时作为辅助照明。
                </p>

                <p className="text-[17px] leading-[1.47] mb-4">
                  有多种方式可以打开或关闭手电筒：
                </p>

                <ul className="list-disc pl-5 space-y-3 text-[17px] leading-[1.47] mb-10">
                  <li>你可以<span className="text-[#06c]">指示 Siri 完成操作</span> <span className="inline-block w-4 h-4 border border-[#06c] rounded-full text-[#06c] text-center leading-3 text-xs">v</span>。</li>
                  <li>你可以<span className="text-[#06c]">使用“控制中心”</span> <span className="inline-block w-4 h-4 border border-[#06c] rounded-full text-[#06c] text-center leading-3 text-xs">v</span>。</li>
                  <li>在 iPhone 15 Pro 或 iPhone 15 Pro Max 上，你可以<span className="text-[#06c]">使用操作按钮</span> <span className="inline-block w-4 h-4 border border-[#06c] rounded-full text-[#06c] text-center leading-3 text-xs">v</span>。</li>
                </ul>

                <h2 className="text-[28px] font-semibold leading-[1.14] tracking-tight mb-4">
                  指示 Siri 完成操作
                </h2>

                <p className="text-[17px] leading-[1.47] mb-4">
                  下面提供了一些关于如何使用 Siri 来打开手电筒的示例：
                </p>

                <ul className="list-disc pl-5 space-y-3 text-[17px] leading-[1.47] mb-10">
                  <li>“嘿 Siri，打开手电筒。”</li>
                  <li>“嘿 Siri，可以打开手电筒吗？”</li>
                  <li>“嘿 Siri，关闭手电筒。”</li>
                </ul>

                <h2 className="text-[28px] font-semibold leading-[1.14] tracking-tight mb-4">
                  使用“控制中心”打开或关闭手电筒
                </h2>

                <ol className="list-decimal pl-5 space-y-3 text-[17px] leading-[1.47] mb-6">
                  <li>从右上角向下轻扫以在 <span className="text-[#06c]">iPhone</span> 或 <span className="text-[#06c]">iPad</span> 上打开“控制中心”。在配备主屏幕按钮的 iPhone 上，从底部向上轻扫以打开“控制中心”。</li>
                  <li>轻点“手电筒”按钮 <span className="inline-block w-3 h-4 bg-gray-400 rounded-sm"></span>。</li>
                </ol>

                {/* Fake Image Placeholder */}
                <div className="bg-[#f5f5f7] rounded-3xl p-4 mb-6 flex justify-center">
                  <div className="w-[280px] h-[580px] bg-black rounded-[40px] border-[8px] border-gray-800 relative overflow-hidden shadow-xl">
                    {/* Dynamic Island */}
                    <div className="absolute top-2 left-1/2 -translate-x-1/2 w-[100px] h-[30px] bg-black rounded-full z-20"></div>
                    {/* Screen Content */}
                    <div className="absolute inset-0 bg-gradient-to-b from-blue-900 to-purple-900 opacity-80"></div>
                    {/* Control Center UI Mock */}
                    <div className="absolute inset-0 p-4 pt-12 flex flex-col gap-4">
                      <div className="flex justify-between px-2 text-white text-xs">
                        <span>无SIM卡</span>
                        <div className="flex gap-1 items-center">
                          <span>100%</span>
                          <div className="w-5 h-2.5 border border-white/50 rounded-sm"></div>
                        </div>
                      </div>
                      <div className="flex gap-4">
                        <div className="flex-1 bg-black/40 rounded-2xl p-3 grid grid-cols-2 gap-3 aspect-square backdrop-blur-md">
                          <div className="w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center text-white">✈</div>
                          <div className="w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center text-white">W</div>
                          <div className="w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center text-white">B</div>
                          <div className="w-10 h-10 bg-black/50 rounded-full flex items-center justify-center text-white">A</div>
                        </div>
                        <div className="flex-1 bg-black/40 rounded-2xl p-3 aspect-square backdrop-blur-md flex flex-col justify-center items-center">
                          <span className="text-white/50 text-sm">未在播放</span>
                        </div>
                      </div>
                      <div className="flex gap-4">
                        <div className="flex-1 bg-black/40 rounded-2xl p-3 flex items-center gap-3 backdrop-blur-md">
                          <div className="w-8 h-8 bg-white/20 rounded-full"></div>
                          <span className="text-white text-sm">专注模式</span>
                        </div>
                      </div>
                      <div className="flex gap-4 h-32">
                        <div className="flex-1 bg-black/40 rounded-2xl p-3 flex flex-col justify-end items-center pb-4 backdrop-blur-md relative overflow-hidden">
                          <div className="absolute bottom-0 left-0 right-0 h-[30%] bg-white"></div>
                          <div className="w-6 h-6 text-black z-10">☀</div>
                        </div>
                        <div className="flex-1 bg-black/40 rounded-2xl p-3 flex flex-col justify-end items-center pb-4 backdrop-blur-md relative overflow-hidden">
                          <div className="absolute bottom-0 left-0 right-0 h-[60%] bg-white"></div>
                          <div className="w-6 h-6 text-black z-10">🔊</div>
                        </div>
                      </div>
                      <div className="flex justify-between mt-2">
                        <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center text-blue-500">🔦</div>
                        <div className="w-12 h-12 bg-black/40 rounded-full backdrop-blur-md"></div>
                        <div className="w-12 h-12 bg-black/40 rounded-full backdrop-blur-md"></div>
                        <div className="w-12 h-12 bg-black/40 rounded-full backdrop-blur-md"></div>
                      </div>
                    </div>
                  </div>
                </div>

                <ol className="list-decimal pl-5 space-y-3 text-[17px] leading-[1.47] mb-6" start={3}>
                  <li>要关闭手电筒，请再次轻点“手电筒”按钮 <span className="inline-block w-3 h-4 bg-gray-400 rounded-sm"></span>。</li>
                </ol>

                <p className="text-[17px] leading-[1.47] mb-4">
                  你还可以从锁定屏幕打开手电筒：按住左下角的“手电筒”按钮 <span className="inline-block w-3 h-4 bg-gray-400 rounded-sm"></span>。
                </p>

                <p className="text-[17px] leading-[1.47] mb-10">
                  如果你在打开“控制中心”时没有看到“手电筒”按钮 <span className="inline-block w-3 h-4 bg-gray-400 rounded-sm"></span>，则可以更改设置来添加这个按钮。前往“设置”&gt;“控制中心”，然后在可用控制项的列表中轻点“手电筒”。或者，当“控制中心”打开时，轻点并按住屏幕以<span className="text-[#06c]">自定义可用控制项</span>。
                </p>

                <p className="text-[17px] leading-[1.47] mb-10">
                  <span className="text-[#06c]">灵动岛</span>在 iPhone 14 Pro 及更新 Pro 机型上提供。
                </p>

                <p className="text-[17px] leading-[1.47] mb-10 text-[#06c]">
                  如果设备上的闪光灯无法正常工作，请了解该怎么做 &gt;
                </p>

                <h2 className="text-[28px] font-semibold leading-[1.14] tracking-tight mb-4">
                  需要更多协助？
                </h2>

                <p className="text-[17px] leading-[1.47] mb-6">
                  请详细描述一下你遇到的问题，我们会建议你接下来可以怎么做。
                </p>

                <p className="text-[17px] leading-[1.47] mb-12 text-[#06c]">
                  获取建议 &gt;
                </p>

                <div className="text-[12px] text-gray-500 mb-8">
                  发布日期：2025 年 12 月 16 日
                </div>

                <div className="border-t border-gray-200 py-4 flex items-center gap-4 text-sm">
                  <span className="font-semibold">有帮助？</span>
                  <button className="px-6 py-1 border border-[#06c] text-[#06c] rounded-full">是</button>
                  <button className="px-6 py-1 border border-[#06c] text-[#06c] rounded-full">否</button>
                </div>
              </div>

              {/* Footer */}
              <div className="bg-[#f5f5f7] px-5 py-6 text-xs text-gray-500">
                <div className="flex items-center gap-2 mb-4">
                  <svg viewBox="0 0 14 44" width="12" height="44" className="fill-current"><path d="M13.0729 17.6822C13.0485 14.7619 15.4727 13.3344 15.5866 13.2612C14.1634 11.1813 11.9692 10.864 11.2206 10.8396C9.3496 10.6444 7.5193 11.9378 6.5513 11.9378C5.5589 11.9378 4.0703 10.864 2.5166 10.8884C0.5155 10.9128 -1.2578 12.0598 -2.2827 13.8412C-4.3814 17.4773 -2.722 22.846 -0.6721 25.8232C0.3284 27.2874 1.5079 28.9468 3.0616 28.898C4.5421 28.8492 5.1115 27.9463 6.8604 27.9463C8.5848 27.9463 9.1054 28.898 10.6591 28.8736C12.2616 28.8492 13.2621 27.3606 14.2383 25.8964C15.3852 24.2126 15.857 22.5776 15.8814 22.48C15.8326 22.48 13.0973 21.4307 13.0729 17.6822ZM9.431 8.2528C10.2526 7.2523 10.8057 5.8613 10.6593 4.4697C9.4635 4.5185 7.9993 5.275 7.1452 6.2755C6.3887 7.154 5.7379 8.5694 5.9087 9.936C7.2346 10.0336 8.6094 9.2527 9.431 8.2528Z" transform="translate(3 -4)"/></svg>
                  <span>&gt;</span>
                  <span>支持</span>
                  <span>&gt;</span>
                  <span>在 iPhone 或 iPad Pro 上打开或关闭手电筒</span>
                </div>
                <div className="mb-2">Copyright © 2026 Apple Inc. 保留所有权利。</div>
                <div className="flex gap-3 flex-wrap">
                  <span>隐私政策</span>
                  <span className="border-l border-gray-300 pl-3">使用条款</span>
                  <span className="border-l border-gray-300 pl-3">销售和退款</span>
                  <span className="border-l border-gray-300 pl-3">站点地图</span>
                </div>
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
                    checked={audienceScreenMode === 'apple'} 
                    onChange={() => setAudienceScreenMode('apple')}
                    className="w-4 h-4"
                  />
                  苹果官网伪装 (Apple Support)
                </label>
                <label className="flex items-center gap-2 text-sm text-zinc-300">
                  <input 
                    type="radio" 
                    checked={audienceScreenMode === 'article'} 
                    onChange={() => setAudienceScreenMode('article')}
                    className="w-4 h-4"
                  />
                  自定义文章
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

            {/* iOS Shortcuts Webhook Section */}
            {!isAudience && roomId && (
              <div className="bg-zinc-800 p-4 rounded-lg border border-purple-500/30 mt-6">
                <h3 className="text-lg font-medium mb-2 text-purple-400">快捷指令触发 (iOS Shortcuts)</h3>
                <p className="text-sm text-zinc-400 mb-4">
                  您可以通过 iOS 快捷指令（结合“轻点背面”或“操作按钮”）来隐蔽触发闪光灯。
                </p>
                <div className="bg-black p-3 rounded text-xs text-zinc-300 break-all mb-4 font-mono select-all">
                  https://ntfy.sh/blacklight_trigger_{roomId.toLowerCase()}
                </div>
                <p className="text-xs text-zinc-500 mb-4">
                  在快捷指令中使用“获取 URL 内容”操作，将网址粘贴进去，并将方法改为 <strong>POST</strong> 即可。
                </p>
                
                <h4 className="text-sm font-medium mb-2 text-purple-300 border-t border-purple-500/30 pt-4">高级：直接控制观众端 (不依赖主控网页)</h4>
                <p className="text-xs text-zinc-400 mb-2">
                  如果您想直接用快捷指令控制观众端（例如：快捷指令里写死让观众关灯），请向以下地址发送 POST 请求，并在<strong>请求体(文本)</strong>中填入 <code className="bg-zinc-800 px-1 rounded">on</code>、<code className="bg-zinc-800 px-1 rounded">off</code>、<code className="bg-zinc-800 px-1 rounded">blink</code> 或 <code className="bg-zinc-800 px-1 rounded">redirect</code>：
                </p>
                <div className="bg-black p-3 rounded text-xs text-zinc-300 break-all font-mono select-all">
                  https://ntfy.sh/blacklight_direct_{roomId.toLowerCase()}
                </div>
              </div>
            )}

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
