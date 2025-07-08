export class VideoCaptureService {
  private static instance: VideoCaptureService;
  private isCapturing: boolean = false;
  private currentCaptureId: string | null = null;
  private streamId: number | null = null;
  private streamSettings: overwolf.streaming.StreamSettings;
  private lastRecordingPath: string | null = null;
  private currentMatchId: string | null = null;
  private logCallbacks: ((message: string) => void)[] = [];
  
  private constructor() {
    // Initialize logging bridge
    this.setupLoggingBridge();
    
    // Initialize default stream settings
    this.streamSettings = {
      provider: overwolf.streaming.enums.StreamingProvider.VideoRecorder,
      settings: {
        audio: {
          mic: {
            enable: true,
            volume: 100,
            device_id: 'default'
          },
          game: {
            enable: true,
            volume: 75,
            device_id: 'default'
          }
        },
        video: {
          auto_calc_kbps: true,
          fps: 30,
          width: 1920,
          height: 1080,
          max_kbps: 8000,
          buffer_length: 20000,
          frame_interval: 16,
          test_drop_frames_interval: 5000,
          notify_dropped_frames_ratio: 0.2,
          encoder: {
            name: overwolf.streaming.enums.StreamEncoder.X264,
            config: {
              preset: overwolf.streaming.enums.StreamEncoderPreset_x264.VERYFAST,
              rate_control: overwolf.streaming.enums.StreamEncoderRateControl_x264.RC_CBR,
              keyframe_interval: 2
            }
          },
          capture_desktop: {
            enable: false,
            monitor_id: 0,
            force_capture: false
          },
          max_file_size_bytes: 500000000, // 500MB
          include_full_size_video: false,
          sub_folder_name: 'Recordings',
          override_overwolf_setting: false,
          disable_when_sht_not_supported: true,
          indication_position: overwolf.streaming.enums.IndicationPosition.TopRightCorner,
          indication_type: overwolf.streaming.enums.IndicationType.DotAndTimer,
          use_app_display_name: true,
          sources: []
        },
        peripherals: {
          capture_mouse_cursor: overwolf.streaming.enums.StreamMouseCursor.gameOnly
        },
        gif_as_video: false,
        max_quota_gb: 2
      }
    };
    
    this.registerStreamingEvents();
  }
  
  private setupLoggingBridge(): void {
    // Override console methods to broadcast to other windows
    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;
    
    console.log = (...args) => {
      originalLog.apply(console, args);
      this.broadcastLog('log', args.join(' '));
    };
    
    console.error = (...args) => {
      originalError.apply(console, args);
      this.broadcastLog('error', args.join(' '));
    };
    
    console.warn = (...args) => {
      originalWarn.apply(console, args);
      this.broadcastLog('warn', args.join(' '));
    };
  }
  
  private broadcastLog(level: string, message: string): void {
    // Broadcast log to all registered callbacks
    this.logCallbacks.forEach(callback => {
      try {
        callback(`[VideoCaptureService] ${message}`);
      } catch (error) {
        // Ignore callback errors
      }
    });
    
    // Also try to send to in-game window if available
    try {
      overwolf.windows.obtainDeclaredWindow('in_game', (result) => {
        if (result.success && result.window) {
          const inGameWindow = (result.window as any).nativeWindow;
          if (inGameWindow && inGameWindow.console) {
            inGameWindow.console.log(`[VideoCaptureService] ${message}`);
          }
        }
      });
    } catch (error) {
      // Ignore window communication errors
    }
  }
  
  public addLogCallback(callback: (message: string) => void): void {
    this.logCallbacks.push(callback);
  }
  
  public removeLogCallback(callback: (message: string) => void): void {
    const index = this.logCallbacks.indexOf(callback);
    if (index > -1) {
      this.logCallbacks.splice(index, 1);
    }
  }
  
  public static getInstance(): VideoCaptureService {
    if (!VideoCaptureService.instance) {
      VideoCaptureService.instance = new VideoCaptureService();
    }
    return VideoCaptureService.instance;
  }
  
  private async checkGameStatus(): Promise<any> {
    return new Promise((resolve) => {
      overwolf.games.getRunningGameInfo((result) => {
        console.log('Game status check result:', result);
        
        if (result.success && (result as any).gameInfo) {
          const gameInfo = (result as any).gameInfo;
          resolve({
            isRunning: gameInfo.isRunning,
            gameId: gameInfo.classId,
            title: gameInfo.title
          });
        } else {
          // Check if we have game info directly in result
          if (result.success && (result as any).isRunning) {
            resolve({
              isRunning: (result as any).isRunning,
              gameId: (result as any).classId,
              title: (result as any).title
            });
          } else {
            resolve({ isRunning: false });
          }
        }
      });
    });
  }

  private registerStreamingEvents(): void {
    // Register to streaming events
    overwolf.streaming.onStreamingError.addListener((event) => {
      console.error('Streaming error:', event);
      this.handleStreamingError(event);
    });
    
    overwolf.streaming.onStreamingWarning.addListener((event) => {
      console.warn('Streaming warning:', event);
    });
    
    overwolf.streaming.onStartStreaming.addListener((event) => {
      console.log('Streaming started:', event);
    });
    
    overwolf.streaming.onStopStreaming.addListener((event) => {
      console.log('Streaming stopped:', event);
      this.handleStreamingStopped(event);
    });
    
    overwolf.streaming.onVideoFileSplited.addListener((event) => {
      console.log('Video file split:', event);
    });
  }
  
  private handleStreamingError(event: overwolf.streaming.StreamEvent): void {
    // StreamEvent doesn't have error property in the type definition
    // We'll handle this differently
    const errorEvent = event as any;
    console.error('Streaming error details:', errorEvent);
    
    if (errorEvent.error === 'NotInGame') {
      console.error('Cannot start streaming - not in game');
    } else if (errorEvent.error === 'Out_Of_Disk_Space') {
      console.error('Cannot continue streaming - out of disk space');
      this.stopCapture();
    } else if (errorEvent.error === 'NoPermission') {
      console.error('Cannot start streaming - no permission');
    } else if (errorEvent.error === 'StreamingInProgress') {
      console.error('Cannot start streaming - already in progress');
    } else {
      console.error('Unknown streaming error:', errorEvent.error);
    }
  }
  
  private handleStreamingStopped(event: overwolf.streaming.StopStreamingEvent): void {
    console.log('Streaming stopped event:', event);
    if (event.file_path) {
      console.log('Recording saved to:', event.file_path);
      console.log('Duration:', event.duration, 'ms');
      
      // Store the recording path for the current match
      this.lastRecordingPath = event.file_path;
      
      // Notify MatchSessionService if we have a current match
      if (this.currentMatchId) {
        this.updateMatchVideoPath(this.currentMatchId, event.file_path);
      }
    } else {
      console.warn('No file path in streaming stopped event');
    }
  }
  
  public async getAvailableEncoders(): Promise<overwolf.streaming.EncoderData[]> {
    return new Promise((resolve, reject) => {
      overwolf.streaming.getStreamEncoders((result) => {
        if (result.success && result.encoders) {
          // Filter and sort encoders by priority: NVIDIA > AMD > INTEL > x264
          const sortedEncoders = result.encoders
            .filter(encoder => (encoder as any).enabled !== false)
            .sort((a, b) => {
              const priority: { [key: string]: number } = {
                'NVIDIA_NVENC': 1,
                'NVIDIA_NVENC_NEW': 1,
                'AMD_AMF': 2,
                'INTEL': 3,
                'X264': 4
              };
              return (priority[a.name] || 5) - (priority[b.name] || 5);
            });
          resolve(sortedEncoders);
        } else {
          reject(new Error(result.error || 'Failed to get encoders'));
        }
      });
    });
  }
  
  public async setEncoder(encoderName: overwolf.streaming.enums.StreamEncoder): Promise<void> {
    if (!this.streamSettings.settings.video) {
      this.streamSettings.settings.video = {} as overwolf.streaming.StreamVideoOptions;
    }
    
    if (!this.streamSettings.settings.video.encoder) {
      this.streamSettings.settings.video.encoder = {} as any;
    }
    
    this.streamSettings.settings.video.encoder.name = encoderName;
    
    // Set appropriate encoder config based on the encoder type
    switch (encoderName) {
      case overwolf.streaming.enums.StreamEncoder.NVIDIA_NVENC:
        this.streamSettings.settings.video.encoder.config = {
          preset: overwolf.streaming.enums.StreamEncoderPreset_NVIDIA.HIGH_QUALITY,
          rate_control: overwolf.streaming.enums.StreamEncoderRateControl_NVIDIA.RC_CBR,
          keyframe_interval: 2
        };
        break;
      case overwolf.streaming.enums.StreamEncoder.AMD_AMF:
        this.streamSettings.settings.video.encoder.config = {
          preset: overwolf.streaming.enums.StreamEncoderPreset_AMD_AMF.QUALITY,
          rate_control: overwolf.streaming.enums.StreamEncoderRateControl_AMD_AMF.RC_CBR,
          keyframe_interval: 2
        };
        break;
      case overwolf.streaming.enums.StreamEncoder.INTEL:
        // Intel encoder settings would go here
        break;
      case overwolf.streaming.enums.StreamEncoder.X264:
      default:
        this.streamSettings.settings.video.encoder.config = {
          preset: overwolf.streaming.enums.StreamEncoderPreset_x264.VERYFAST,
          rate_control: overwolf.streaming.enums.StreamEncoderRateControl_x264.RC_CBR,
          keyframe_interval: 2
        };
        break;
    }
  }
  
  public async startCapture(subFolderName?: string): Promise<string> {
    if (this.isCapturing || this.streamId !== null) {
      console.warn('Already capturing - current state:', {
        isCapturing: this.isCapturing,
        streamId: this.streamId
      });
      return this.lastRecordingPath || this.streamId?.toString() || '';
    }
    
    console.log('Starting video capture with subfolder:', subFolderName);
    
    try {
      // Check if we're actually in a game
      const gameInfo = await this.checkGameStatus();
      console.log('Game status check result:', gameInfo);
      if (!gameInfo.isRunning) {
        const errorMsg = 'Not in game - video capture requires an active game';
        console.error(errorMsg);
        throw new Error(errorMsg);
      }
      
      console.log('Game detected:', gameInfo.title, 'ID:', gameInfo.gameId);
      
      // Store the match ID for later reference
      if (subFolderName && subFolderName.includes('/')) {
        this.currentMatchId = subFolderName.split('/')[1];
        console.log('Stored match ID:', this.currentMatchId);
      }
      
      // Auto-select best available encoder
      try {
        const encoders = await this.getAvailableEncoders();
        console.log('Available encoders:', encoders.map(e => ({ name: e.name, display_name: e.display_name })));
        
        if (encoders.length > 0) {
          await this.setEncoder(encoders[0].name as overwolf.streaming.enums.StreamEncoder);
          console.log('Using encoder:', encoders[0].display_name);
        } else {
          console.warn('No encoders available, using default x264');
        }
      } catch (encoderError) {
        console.error('Failed to get/set encoder:', encoderError);
        console.log('Proceeding with default encoder settings');
      }
      
      // Set sub folder name if provided
      if (subFolderName && this.streamSettings.settings.video) {
        this.streamSettings.settings.video.sub_folder_name = subFolderName;
        console.log('Set sub folder name to:', subFolderName);
      }
      
      console.log('Final stream settings:', JSON.stringify(this.streamSettings, null, 2));
      
      return new Promise((resolve, reject) => {
        overwolf.streaming.start(this.streamSettings, (result) => {
          console.log('Streaming start API result:', result);
          
          if (result.success && result.stream_id !== undefined) {
            this.isCapturing = true;
            this.streamId = result.stream_id;
            this.currentCaptureId = result.stream_id.toString();
            console.log('✅ Video capture started successfully with stream ID:', result.stream_id);
            // Return a placeholder that will be updated when recording stops
            resolve('pending');
          } else {
            const errorMsg = result.error || 'Unknown error starting capture';
            console.error('❌ Failed to start capture. Full error details:', {
              success: result.success,
              error: result.error,
              stream_id: result.stream_id,
              result: result
            });
            reject(new Error(errorMsg));
          }
        });
      });
    } catch (error) {
      console.error('❌ Exception in startCapture:', error);
      console.error('Error stack:', error.stack);
      throw error;
    }
  }
  
  public async stopCapture(): Promise<any | null> {
    if (!this.isCapturing || this.streamId === null) {
      console.warn('No active capture to stop - current state:', {
        isCapturing: this.isCapturing,
        streamId: this.streamId
      });
      return null;
    }
    
    console.log('Stopping video capture, stream ID:', this.streamId);
    
    try {
      return new Promise((resolve, reject) => {
        overwolf.streaming.stop(this.streamId!, (result) => {
          console.log('Streaming stop API result:', result);
          
          if (result.success) {
            this.isCapturing = false;
            this.streamId = null;
            this.currentCaptureId = null;
            console.log('✅ Video capture stopped successfully');
            resolve(result);
          } else {
            console.error('❌ Failed to stop capture:', result.error);
            console.error('Stop result details:', result);
            reject(new Error(result.error || 'Failed to stop capture'));
          }
        });
      });
    } catch (error) {
      console.error('❌ Exception in stopCapture:', error);
      console.error('Error stack:', error.stack);
      throw error;
    }
  }
  
  public async splitVideo(): Promise<boolean> {
    if (!this.isCapturing || this.streamId === null) {
      console.warn('No active capture to split');
      return false;
    }
    
    return new Promise((resolve) => {
      overwolf.streaming.split(this.streamId!, (result) => {
        if (result.success) {
          console.log('Video split successfully');
          resolve(true);
        } else {
          console.error('Failed to split video:', result.error);
          resolve(false);
        }
      });
    });
  }
  
  public async changeVolume(audioOptions: overwolf.streaming.StreamAudioOptions): Promise<boolean> {
    if (!this.isCapturing || this.streamId === null) {
      console.warn('No active capture to change volume');
      return false;
    }
    
    return new Promise((resolve) => {
      overwolf.streaming.changeVolume(this.streamId!, audioOptions, (result) => {
        if (result.success) {
          console.log('Volume changed successfully');
          resolve(true);
        } else {
          console.error('Failed to change volume:', result.error);
          resolve(false);
        }
      });
    });
  }
  
  public async updateVideoSettings(settings: Partial<overwolf.streaming.StreamVideoOptions>): Promise<void> {
    if (!this.streamSettings.settings.video) {
      this.streamSettings.settings.video = {} as overwolf.streaming.StreamVideoOptions;
    }
    
    Object.assign(this.streamSettings.settings.video, settings);
  }
  
  public async updateAudioSettings(settings: Partial<overwolf.streaming.StreamAudioOptions>): Promise<void> {
    if (!this.streamSettings.settings.audio) {
      this.streamSettings.settings.audio = {} as any;
    }
    
    Object.assign(this.streamSettings.settings.audio, settings);
  }
  
  public isCurrentlyCapturing(): boolean {
    return this.isCapturing;
  }
  
  public getCurrentStreamId(): number | null {
    return this.streamId;
  }
  
  public async captureHighlight(highlightId: string, startTime: number, duration: number = 15000): Promise<string | null> {
    console.log(`Capturing highlight: ${highlightId} at ${startTime}ms for ${duration}ms`);
    
    // For highlights, we use the replays API instead of streaming
    // This is a simplified version - in production you'd want to use overwolf.media.replays
    if (this.isCapturing && this.streamId !== null) {
      // If we're already streaming, we can split the video to mark a highlight
      await this.splitVideo();
      return `highlight_${highlightId}_${Date.now()}.mp4`;
    }
    
    // If not streaming, return null or start a temporary capture
    console.warn('No active stream for highlight capture');
    return null;
  }
  
  public async getAudioDevices(): Promise<overwolf.streaming.AudioDeviceData[]> {
    return new Promise((resolve, reject) => {
      overwolf.streaming.getAudioDevices((result) => {
        if (result.success && result.devices) {
          resolve(result.devices);
        } else {
          reject(new Error(result.error || 'Failed to get audio devices'));
        }
      });
    });
  }
  
  public async setAudioDevice(deviceId: string, type: 'mic' | 'game'): Promise<void> {
    if (!this.streamSettings.settings.audio) {
      this.streamSettings.settings.audio = {} as any;
    }
    
    if (type === 'mic') {
      if (!this.streamSettings.settings.audio.mic) {
        this.streamSettings.settings.audio.mic = {} as any;
      }
      this.streamSettings.settings.audio.mic.device_id = deviceId;
    } else {
      if (!this.streamSettings.settings.audio.game) {
        this.streamSettings.settings.audio.game = {} as any;
      }
      this.streamSettings.settings.audio.game.device_id = deviceId;
    }
  }
  
  public async openRecordingsFolder(): Promise<void> {
    overwolf.utils.openWindowsExplorer(
      'overwolf://media/recordings/Rematch+Coach',
      (result) => {
        if (!result.success) {
          console.error('Failed to open recordings folder:', result.error);
        }
      }
    );
  }

  private async updateMatchVideoPath(matchId: string, filePath: string): Promise<void> {
    console.log(`Match ${matchId} video saved to: ${filePath}`);
    
    // Notify the match session service about the video path
    try {
      const { MatchSessionService } = await import('./MatchSessionService');
      const matchService = MatchSessionService.getInstance();
      await matchService.updateMatchVideoPath(matchId, filePath);
    } catch (error) {
      console.error('Failed to update match video path:', error);
    }
  }
}