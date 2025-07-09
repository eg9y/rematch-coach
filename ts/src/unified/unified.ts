import {
  OWGames,
  OWGamesEvents,
  OWHotkeys
} from "@overwolf/overwolf-api-ts";

import { AppWindow } from "../AppWindow";
import { kHotkeys, kWindowNames, kGamesFeatures } from "../consts";
import { MatchSessionService, MatchSession, GoalEvent } from "../services/MatchSessionService";
import { VideoCaptureService } from "../services/VideoCaptureService";
import Plyr from "plyr";

import WindowState = overwolf.windows.WindowStateEx;

// Recording mode enum
enum RecordingMode {
  AUTO_RECORD = 'auto',
  QUEUE_ALERT = 'alert',
  DISABLED = 'disabled'
}

// Settings interface
interface AppSettings {
  recordingMode: RecordingMode;
  recordingQuality: string;
  recordingDuration: string;
}

// Unified window that combines desktop and in-game functionality
class UnifiedWindow extends AppWindow {
  private static _instance: UnifiedWindow;
  private _gameEventsListener: OWGamesEvents;
  private _eventsLog: HTMLElement;
  private _infoLog: HTMLElement;
  private _matchSessionService: MatchSessionService;
  private _videoCaptureService: VideoCaptureService;
  private _currentPlayerInfo: any = {};
  private _currentScore: any = { left_score: 0, right_score: 0 };
  private _isGameRunning: boolean = false;
  private _settings: AppSettings;
  private _lastGameMode: string | null = null;
  private _hasShownAlertForSession: boolean = false;
  
  // UI Elements
  private matchListElement: HTMLElement;
  private videoModal: HTMLElement;
  private videoPlayer: HTMLVideoElement;
  private plyrInstance: Plyr | null = null;
  private timestampsList: HTMLElement;
  private eventsCountElement: HTMLElement;
  private closeModalBtn: HTMLElement;
  private modalTitle: HTMLElement;
  private openFolderBtn: HTMLButtonElement;
  private queueAlertModal: HTMLElement;
  
  // Video event handlers
  private videoErrorHandler: (e: Event) => void;
  private videoLoadStartHandler: (e: Event) => void;
  
  // Tab elements
  private historyTab: HTMLElement;
  private liveTab: HTMLElement;
  private settingsTab: HTMLElement;
  private historyTabContent: HTMLElement;
  private liveTabContent: HTMLElement;
  private settingsTabContent: HTMLElement;
  
  // View control elements
  private rowViewBtn: HTMLElement;
  private gridViewBtn: HTMLElement;
  private currentView: 'row' | 'grid' = 'row';
  
  // Settings elements
  private recordingModeRadios: NodeListOf<HTMLInputElement>;
  private recordingQuality: HTMLSelectElement;
  private recordingDuration: HTMLSelectElement;

  private constructor() {
    super(kWindowNames.unified);
    
    // Initialize settings
    this._settings = {
      recordingMode: RecordingMode.AUTO_RECORD,
      recordingQuality: '1080p',
      recordingDuration: '60'
    };
    
    this.loadSettings();
    
    console.log('Unified window initialized');
    console.log('Build mode:', process.env.DEBUG_MODE ? 'DEBUG' : 'PRODUCTION');
    
    this._matchSessionService = MatchSessionService.getInstance();
    
    // Get video capture service from background window
    const backgroundWindow = overwolf.windows.getMainWindow();
    this._videoCaptureService = (backgroundWindow as any).videoCaptureService || VideoCaptureService.getInstance();
    
    this.initializeElements();
    this.setupVideoEventHandlers();
    this.initializePlyr();
    this.setupEventListeners();
    this.setupVideoCaptureLogging();
    this.setupBuildMode();
    
    this.loadMatches();
    this.setToggleHotkeyBehavior();
    this.setToggleHotkeyText();
    this.loadViewPreference();
    
    // Check if game is running and set initial tab
    this.checkGameStatus();
    
    // Refresh matches every 30 seconds
    setInterval(() => this.loadMatches(), 30000);
  }

  public static instance(): UnifiedWindow {
    if (!this._instance) {
      this._instance = new UnifiedWindow();
    }
    return this._instance;
  }

  private initializeElements(): void {
    // Tab elements
    this.historyTab = document.getElementById('historyTab')!;
    this.liveTab = document.getElementById('liveTab')!;
    this.settingsTab = document.getElementById('settingsTab')!;
    this.historyTabContent = document.getElementById('historyTabContent')!;
    this.liveTabContent = document.getElementById('liveTabContent')!;
    this.settingsTabContent = document.getElementById('settingsTabContent')!;
    
    // View control elements
    this.rowViewBtn = document.getElementById('rowViewBtn')!;
    this.gridViewBtn = document.getElementById('gridViewBtn')!;
    
    // Match history elements
    this.matchListElement = document.getElementById('matchList')!;
    this.videoModal = document.getElementById('videoModal')!;
    this.videoPlayer = document.getElementById('videoPlayer') as HTMLVideoElement;
    this.timestampsList = document.getElementById('timestampsList')!;
    this.eventsCountElement = document.getElementById('eventsCount')!;
    this.closeModalBtn = document.getElementById('closeModal')!;
    this.modalTitle = document.getElementById('modalTitle')!;
    this.openFolderBtn = document.getElementById('openFolderBtn')! as HTMLButtonElement;
    
    // Live game elements
    this._eventsLog = document.getElementById('eventsLog')!;
    this._infoLog = document.getElementById('infoLog')!;
    
    // Settings elements
    this.recordingModeRadios = document.querySelectorAll('input[name="recordingMode"]')! as NodeListOf<HTMLInputElement>;
    this.recordingQuality = document.getElementById('recordingQuality')! as HTMLSelectElement;
    this.recordingDuration = document.getElementById('recordingDuration')! as HTMLSelectElement;
    
    // Queue alert modal
    this.queueAlertModal = document.getElementById('queueAlertModal')!;
  }

  private setupVideoEventHandlers(): void {
    // Create reusable event handlers
    this.videoErrorHandler = (e: Event) => {
      console.log('Video load error:', e);
      this.showVideoError();
    };
    
    this.videoLoadStartHandler = (e: Event) => {
      console.log('Video load started');
    };
  }

  private initializePlyr(): void {
    if (this.plyrInstance) {
      this.plyrInstance.destroy();
    }
    
    this.plyrInstance = new Plyr(this.videoPlayer, {
      controls: [
        'play-large',
        'play',
        'progress',
        'current-time',
        'mute',
        'volume',
        'settings',
        'fullscreen'
      ],
      settings: ['quality', 'speed'],
      speed: {
        selected: 1,
        options: [0.5, 0.75, 1, 1.25, 1.5, 2]
      },
      ratio: null,
      fullscreen: {
        enabled: true,
        fallback: true,
        iosNative: false
      },
      keyboard: {
        focused: true,
        global: false
      },
      tooltips: {
        controls: true,
        seek: true
      },
    });
    
    // Set up Plyr event listeners
    this.setupPlyrEventListeners();
  }

  private setupPlyrEventListeners(): void {
    if (!this.plyrInstance) return;

    this.plyrInstance.on('loadedmetadata', () => {
      console.log('Plyr: Video metadata loaded, duration:', this.plyrInstance.duration);
    });
    
    this.plyrInstance.on('error', (event) => {
      console.log('Plyr: Video error', event);
      this.showVideoError();
    });
    
    this.plyrInstance.on('ready', () => {
      console.log('Plyr: Player ready');
    });
    
    this.plyrInstance.on('canplay', () => {
      console.log('Plyr: Video can play');
    });
    
    this.plyrInstance.on('loadstart', () => {
      console.log('Plyr: Load start');
    });
    
  }

  private setupEventListeners(): void {
    // Tab navigation
    this.historyTab.addEventListener('click', () => this.switchTab('history'));
    this.liveTab.addEventListener('click', () => this.switchTab('live'));
    this.settingsTab.addEventListener('click', () => this.switchTab('settings'));
    
    // View controls
    this.rowViewBtn.addEventListener('click', () => this.switchView('row'));
    this.gridViewBtn.addEventListener('click', () => this.switchView('grid'));
    
    // Video modal
    this.closeModalBtn.addEventListener('click', () => this.closeVideoModal());
    this.videoModal.addEventListener('click', (e) => {
      if (e.target === this.videoModal) {
        this.closeVideoModal();
      }
    });
    
    // Folder control
    this.openFolderBtn.addEventListener('click', () => {
      this._videoCaptureService.openRecordingsFolder();
    });
    
    // Settings
    this.recordingModeRadios.forEach(radio => {
      radio.addEventListener('change', () => {
        if (radio.checked) {
          this._settings.recordingMode = radio.value as RecordingMode;
          this.saveSettings();
        }
      });
    });
    
    this.recordingQuality.addEventListener('change', () => {
      this._settings.recordingQuality = this.recordingQuality.value;
      this.saveSettings();
    });
    
    this.recordingDuration.addEventListener('change', () => {
      this._settings.recordingDuration = this.recordingDuration.value;
      this.saveSettings();
    });
    
    // Queue alert modal
    const startRecordingBtn = document.getElementById('startRecordingBtn')!;
    const skipRecordingBtn = document.getElementById('skipRecordingBtn')!;
    const alwaysRecordBtn = document.getElementById('alwaysRecordBtn')!;
    
    startRecordingBtn.addEventListener('click', () => {
      this.hideQueueAlert();
      // Start recording for this session only
      console.log('Starting recording for this session');
      
      // If match already started, start recording immediately
      if (this._matchSessionService.getCurrentMatch()) {
        console.log('Match already in progress, starting recording now');
        // Match already exists, start recording for it
        this._matchSessionService.startRecordingForCurrentMatch();
      } else {
        // Store a temporary flag to start recording when match begins
        (window as any).tempRecordingEnabled = true;
      }
    });
    
    skipRecordingBtn.addEventListener('click', () => {
      this.hideQueueAlert();
      // Skip recording for this session
      console.log('Skipping recording for this session');
    });
    
    alwaysRecordBtn.addEventListener('click', () => {
      this.hideQueueAlert();
      // Enable auto-recording permanently
      this._settings.recordingMode = RecordingMode.AUTO_RECORD;
      this.updateSettingsUI();
      this.saveSettings();
      console.log('Auto-recording enabled');
    });
  }

  private switchTab(tabName: string): void {
    // Remove active class from all tabs and content
    document.querySelectorAll('.tab-btn').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    
    // Add active class to selected tab and content
    switch (tabName) {
      case 'history':
        this.historyTab.classList.add('active');
        this.historyTabContent.classList.add('active');
        break;
      case 'live':
        this.liveTab.classList.add('active');
        this.liveTabContent.classList.add('active');
        break;
      case 'settings':
        this.settingsTab.classList.add('active');
        this.settingsTabContent.classList.add('active');
        this.updateSettingsUI();
        break;
    }
  }

  private switchView(viewType: 'row' | 'grid'): void {
    this.currentView = viewType;
    
    // Update button states
    this.rowViewBtn.classList.toggle('active', viewType === 'row');
    this.gridViewBtn.classList.toggle('active', viewType === 'grid');
    
    // Update match list classes
    this.matchListElement.classList.remove('row-view', 'grid-view');
    this.matchListElement.classList.add(`${viewType}-view`);
    
    // Re-render matches with new view
    this.loadMatches();
    
    // Save preference
    localStorage.setItem('matchHistoryView', viewType);
  }

  private updateSettingsUI(): void {
    // Update recording mode radio buttons
    this.recordingModeRadios.forEach(radio => {
      radio.checked = radio.value === this._settings.recordingMode;
    });
    
    this.recordingQuality.value = this._settings.recordingQuality;
    this.recordingDuration.value = this._settings.recordingDuration;
  }

  private loadSettings(): void {
    const savedSettings = localStorage.getItem('rematchCoachSettings');
    if (savedSettings) {
      const parsed = JSON.parse(savedSettings);
      
      // Handle migration from old settings format
      if ('autoRecord' in parsed && 'queueAlerts' in parsed) {
        if (parsed.autoRecord) {
          parsed.recordingMode = RecordingMode.AUTO_RECORD;
        } else if (parsed.queueAlerts) {
          parsed.recordingMode = RecordingMode.QUEUE_ALERT;
        } else {
          parsed.recordingMode = RecordingMode.DISABLED;
        }
        delete parsed.autoRecord;
        delete parsed.queueAlerts;
      }
      
      this._settings = { ...this._settings, ...parsed };
    }
  }

  private saveSettings(): void {
    localStorage.setItem('rematchCoachSettings', JSON.stringify(this._settings));
  }

  private loadViewPreference(): void {
    const savedView = localStorage.getItem('matchHistoryView') as 'row' | 'grid';
    if (savedView && (savedView === 'row' || savedView === 'grid')) {
      this.switchView(savedView);
    }
  }

  private setupBuildMode(): void {
    const isDebugMode = process.env.DEBUG_MODE;
    const debugLogsElement = document.getElementById('debugLogs')!;
    const prodComingSoonElement = document.getElementById('prodComingSoon')!;
    const liveGameTitle = document.getElementById('liveGameTitle')!;
    const liveGameDescription = document.getElementById('liveGameDescription')!;
    const hotkeyInfo = document.getElementById('hotkeyInfo')!;
    
    console.log('DEBUG: process.env.DEBUG_MODE =', process.env.DEBUG_MODE);
    console.log('DEBUG: process.env.PROD_MODE =', process.env.PROD_MODE);
    console.log('DEBUG: isDebugMode =', isDebugMode);
    
    if (isDebugMode) {
      // Debug mode: Show logs and debug information
      console.log('DEBUG: Setting up debug mode UI');
      debugLogsElement.style.display = 'block';
      prodComingSoonElement.style.display = 'none';
      liveGameTitle.textContent = 'Live Game Data (Debug)';
      liveGameDescription.textContent = 'Real-time game events and debug information';
      hotkeyInfo.style.display = 'block';
    } else {
      // Production mode: Show coming soon message
      console.log('DEBUG: Setting up production mode UI');
      debugLogsElement.style.display = 'none';
      prodComingSoonElement.style.display = 'block';
      liveGameTitle.textContent = 'Live Game';
      liveGameDescription.textContent = 'Advanced live game features';
      hotkeyInfo.style.display = 'none';
    }
  }

  public async checkGameStatus(): Promise<void> {
    const gameInfo = await OWGames.getRunningGameInfo();
    const isGameRunning = gameInfo && gameInfo.isRunning;
    
    if (isGameRunning && !this._isGameRunning) {
      // Game started
      this.switchTab('live');
      this.run(); // Start game event listeners
    } else if (!isGameRunning && this._isGameRunning) {
      // Game ended
      this.stopGameEventListener();
      this.switchTab('history');
    } else if (isGameRunning) {
      // Game still running, switch to live tab
      this.switchTab('live');
    } else {
      // No game running, switch to history tab
      this.switchTab('history');
    }
  }

  public async run() {
    // Don't start if already running
    if (this._gameEventsListener && this._isGameRunning) {
      console.log('Game events listener already running, skipping initialization');
      return;
    }
    
    // Only start game events in debug mode
    const isDebugMode = process.env.DEBUG_MODE;
    if (!isDebugMode) {
      console.log('Game events disabled in production mode');
      return;
    }
    
    const gameClassId = await this.getCurrentGameClassId();
    const gameFeatures = kGamesFeatures.get(gameClassId);

    if (gameFeatures && gameFeatures.length) {
      // Clean up any existing listener first
      if (this._gameEventsListener) {
        this._gameEventsListener.stop();
      }
      
      this._gameEventsListener = new OWGamesEvents(
        {
          onInfoUpdates: this.onInfoUpdates.bind(this),
          onNewEvents: this.onNewEvents.bind(this)
        },
        gameFeatures
      );

      this._gameEventsListener.start();
      this._isGameRunning = true;
    }
  }

  public stopGameEventListener() {
    if (this._gameEventsListener) {
      this._gameEventsListener.stop();
      this._gameEventsListener = null;
    }
    this._isGameRunning = false;
  }

  public destroy(): void {
    this.stopGameEventListener();
    if (this.plyrInstance) {
      this.plyrInstance.destroy();
      this.plyrInstance = null;
    }
  }

  private onInfoUpdates(info) {
    this.logLine(this._infoLog, info, false);
    console.log('Info update received:', JSON.stringify(info, null, 2));
    
    // Process game info updates
    if (info.game_info) {
      if (info.game_info.player_name) {
        this._currentPlayerInfo.player_name = info.game_info.player_name;
      }
      if (info.game_info.player_id) {
        this._currentPlayerInfo.player_id = info.game_info.player_id;
      }
      
      // Handle scene changes
      if (info.game_info.scene) {
        console.log(`Scene changed to: ${info.game_info.scene}`);
        if (info.game_info.scene === 'lobby') {
          // Reset alert flag when returning to lobby
          this._hasShownAlertForSession = false;
          this._lastGameMode = null;
          console.log('Reset alert flag - returned to lobby');
        }
      }
      
      if (info.game_info.game_mode) {
        const newGameMode = info.game_info.game_mode;
        this._currentPlayerInfo.game_mode = newGameMode;
        
        // Check if game mode changed and we should show alert
        if (this._lastGameMode !== newGameMode && 
            newGameMode !== 'Custom' && // Don't show for custom games
            this._settings.recordingMode === RecordingMode.QUEUE_ALERT &&
            !this._hasShownAlertForSession) {
          console.log(`Game mode changed from ${this._lastGameMode} to ${newGameMode}, showing queue alert`);
          this.showQueueAlert();
          this._hasShownAlertForSession = true;
        }
        
        this._lastGameMode = newGameMode;
      }
      
      if (info.game_info.scene === 'ingame' && !this._matchSessionService.getCurrentMatch()) {
        console.log('Scene changed to ingame, starting match session');
        setTimeout(() => {
          if (!this._matchSessionService.getCurrentMatch()) {
            console.log('Starting match based on scene change');
            this._matchSessionService.startMatch(this._currentPlayerInfo);
          }
        }, 2000);
      }
    }
    
    // Process match info updates
    if (info.match_info) {
      if (info.match_info.score) {
        try {
          const scoreData = JSON.parse(info.match_info.score);
          this._currentScore = scoreData;
        } catch (e) {
          console.error('Failed to parse score:', e);
        }
      }
      if (info.match_info.match_outcome && this._matchSessionService.getCurrentMatch()) {
        this._matchSessionService.endMatch(info.match_info.match_outcome, this._currentScore);
      }
    }
  }

  private onNewEvents(e) {
    console.log('New events received:', JSON.stringify(e, null, 2));
    
    const shouldHighlight = e.events.some(event => {
      console.log('Processing event:', event.name, event.data);
      
      switch (event.name) {
        case 'match_start':
          console.log('Match start event detected');
          
          // Fallback: Show alert if in alert mode and haven't shown it yet
          if (this._settings.recordingMode === RecordingMode.QUEUE_ALERT && !this._hasShownAlertForSession) {
            console.log('Showing queue alert as fallback on match_start');
            // Start the match session first (without recording)
            this._matchSessionService.startMatch(this._currentPlayerInfo, false);
            this.showQueueAlert();
            this._hasShownAlertForSession = true;
            // Don't start recording yet - wait for user response
          } else if (this._settings.recordingMode === RecordingMode.AUTO_RECORD || (window as any).tempRecordingEnabled) {
            // Check if we should record (auto-record mode or temporary session recording)
            this._matchSessionService.startMatch(this._currentPlayerInfo);
            // Clear temporary flag after use
            if ((window as any).tempRecordingEnabled) {
              delete (window as any).tempRecordingEnabled;
            }
          }
          return true;
          
        case 'match_end':
          console.log('Match end event detected');
          // Reset session alert flag when match ends
          this._hasShownAlertForSession = false;
          return true;
          
        case 'team_goal':
          console.log('Team goal event detected');
          this._matchSessionService.addGoalEvent('team_goal', this._currentScore);
          return true;
          
        case 'opponent_goal':
          console.log('Opponent goal event detected');
          this._matchSessionService.addGoalEvent('opponent_goal', this._currentScore);
          return true;
          
        case 'kill':
        case 'death':
        case 'assist':
        case 'level':
          return true;
      }
      return false;
    });
    
    this.logLine(this._eventsLog, e, shouldHighlight);
  }

  private showQueueAlert(): void {
    this.queueAlertModal.style.display = 'flex';
    
    // Bring window to front and restore if minimized
    overwolf.windows.bringToFront(kWindowNames.unified, true, (result) => {
      if (!result.success) {
        console.error('Failed to bring window to front:', result.error);
      }
    });
    
    overwolf.windows.restore(kWindowNames.unified, (result) => {
      if (!result.success) {
        console.error('Failed to restore window:', result.error);
      }
    });
  }

  private hideQueueAlert(): void {
    this.queueAlertModal.style.display = 'none';
  }


  private setupVideoCaptureLogging(): void {
    if (this._videoCaptureService && this._videoCaptureService.addLogCallback) {
      this._videoCaptureService.addLogCallback((message: string) => {
        console.log(message);
      });
    }
  }

  private async loadMatches(): Promise<void> {
    const matches = await this._matchSessionService.getMatches();
    this.displayMatches(matches);
  }

  private displayMatches(matches: MatchSession[]): void {
    this.matchListElement.innerHTML = '';
    
    if (matches.length === 0) {
      this.matchListElement.innerHTML = '<p style="color: #999; text-align: center;">No matches recorded yet. Play some Rematch games!</p>';
      return;
    }
    
    matches.forEach(match => {
      const matchElement = this.createMatchElement(match);
      this.matchListElement.appendChild(matchElement);
    });
  }

  private createMatchElement(match: MatchSession): HTMLElement {
    const matchDiv = document.createElement('div');
    matchDiv.className = 'match-item';
    
    const teamGoals = match.goals.filter(g => g.type === 'team_goal').length;
    const opponentGoals = match.goals.filter(g => g.type === 'opponent_goal').length;
    const outcome = match.outcome || 'In Progress';
    const score = match.finalScore ? `${match.finalScore.left} - ${match.finalScore.right}` : '0 - 0';
    
    if (this.currentView === 'row') {
      matchDiv.innerHTML = `
        <div class="match-outcome ${outcome.toLowerCase().replace(' ', '-')}">${outcome}</div>
        <div class="match-score">${score}</div>
        <div class="match-info">
          <span class="match-player">${match.playerName}</span>
          <span class="match-mode">${match.gameMode}</span>
          <span>${this.formatDuration(match.startTime, match.endTime)}</span>
        </div>
        <div class="goal-indicators">
          ${teamGoals > 0 ? `<span class="goal-indicator team">${teamGoals}T</span>` : ''}
          ${opponentGoals > 0 ? `<span class="goal-indicator opponent">${opponentGoals}O</span>` : ''}
        </div>
        <div class="match-date">${this.formatDate(match.startTime)}</div>
      `;
    } else {
      matchDiv.innerHTML = `
        <div class="match-header">
          <span class="match-outcome ${outcome.toLowerCase().replace(' ', '-')}">${outcome}</span>
          <span class="match-date">${this.formatDate(match.startTime)}</span>
        </div>
        <div class="match-score">${score}</div>
        <div class="match-info">
          <div class="match-player">${match.playerName}</div>
          <div class="match-mode">${match.gameMode}</div>
          <div>${this.formatDuration(match.startTime, match.endTime)}</div>
        </div>
        <div class="goal-indicators">
          ${teamGoals > 0 ? `<span class="goal-indicator team">${teamGoals} Team</span>` : ''}
          ${opponentGoals > 0 ? `<span class="goal-indicator opponent">${opponentGoals} Opp</span>` : ''}
        </div>
      `;
    }
    
    matchDiv.addEventListener('click', () => {
      this.openVideoModal(match);
    });
    
    return matchDiv;
  }

  private async openVideoModal(match: MatchSession): Promise<void> {
    console.log("Opening video modal for match:", JSON.stringify(match));
    
    if (!match.videoPath) {
      alert('No video available for this match');
      return;
    }
    
    // Clean up any existing event listeners first
    this.cleanupVideoEventListeners();
    
    this.modalTitle.textContent = `${match.outcome || 'Match'} - ${this.formatDate(match.startTime)}`;
    
    const videoFilePath = await this.findVideoFile(match);
    console.log('Found video file path:', videoFilePath);
    
    // Create markers from goals
    const markers = this.createMarkersFromGoals(match.goals);
    
    if (videoFilePath) {
      const videoUrl = this.getVideoUrl(videoFilePath);
      console.log("Generated video URL:", videoUrl);
      
      // Set the video source using Plyr
      if (this.plyrInstance) {
        this.plyrInstance.source = {
          type: 'video',
          title: `${match.outcome || 'Match'} - ${this.formatDate(match.startTime)}`,
          sources: [{
            src: videoUrl,
            type: 'video/mp4'
          }]
        };
        
        // Wait for the video to load before setting markers
        this.plyrInstance.once('loadedmetadata', () => {
          this.addMarkersToProgressBar(markers);
        });
      }
      
      // Display timestamps in sidebar
      this.displayTimestamps(match.goals, match.startTime);
    } else {
      this.showSimulatedVideoMessage(match);
      // Still display timestamps for simulated videos
      this.displayTimestamps(match.goals, match.startTime);
    }
    
    this.videoModal.style.display = 'flex';
  }

  private cleanupVideoEventListeners(): void {
    // Plyr handles its own cleanup when source is changed
    // Just keep this method for compatibility
  }

  private closeVideoModal(): void {
    this.videoModal.style.display = 'none';
    
    // Pause and reset Plyr
    if (this.plyrInstance) {
      this.plyrInstance.pause();
      this.plyrInstance.currentTime = 0;
    }
    
    // Clean up markers
    const existingMarkers = document.querySelectorAll('.plyr-marker');
    existingMarkers.forEach(marker => marker.remove());
    
    // Clear timestamps list
    this.timestampsList.innerHTML = '';
    this.eventsCountElement.textContent = '0 events';
    
    // Show video player and hide any message divs
    this.videoPlayer.style.display = 'block';
    
    const messageDiv = document.getElementById('video-simulation-message');
    if (messageDiv) {
      messageDiv.style.display = 'none';
    }
    
    const errorDiv = document.getElementById('video-error-message');
    if (errorDiv) {
      errorDiv.style.display = 'none';
    }
  }

  private displayTimestamps(goals: GoalEvent[], matchStartTime: number): void {
    this.timestampsList.innerHTML = '';
    
    // Update events count
    this.eventsCountElement.textContent = `${goals.length} ${goals.length === 1 ? 'event' : 'events'}`;
    
    if (goals.length === 0) {
      this.timestampsList.innerHTML = '<p style="color: #999;">No goals in this match</p>';
      return;
    }
    
    goals.forEach((goal, index) => {
      const timeInSeconds = Math.floor(goal.gameTime / 1000);
      const formattedTime = this.formatTime(timeInSeconds);
      
      // Create sidebar timestamp item
      const timestampDiv = document.createElement('div');
      timestampDiv.className = `timestamp-item ${goal.type.replace('_', '-')}`;
      
      timestampDiv.innerHTML = `
        <div class="timestamp-header">
          <span class="timestamp-time">${formattedTime}</span>
          <span class="timestamp-label">${goal.type === 'team_goal' ? 'Team Goal' : 'Opponent Goal'}</span>
        </div>
        <div class="timestamp-score">Score: ${goal.score.left} - ${goal.score.right}</div>
      `;
      
      timestampDiv.addEventListener('click', () => {
        const seekTime = Math.max(0, timeInSeconds - 5);
        if (this.plyrInstance) {
          this.plyrInstance.currentTime = seekTime;
          this.plyrInstance.play();
        }
      });
      
      this.timestampsList.appendChild(timestampDiv);
    });
  }

  private createMarkersFromGoals(goals: GoalEvent[]): Array<{time: number, label: string}> {
    return goals.map(goal => {
      const timeInSeconds = Math.floor(goal.gameTime / 1000);
      const formattedTime = this.formatTime(timeInSeconds);
      const goalType = goal.type === 'team_goal' ? 'Team Goal' : 'Opponent Goal';
      
      return {
        time: timeInSeconds,
        label: `${formattedTime} - ${goalType} (${goal.score.left} - ${goal.score.right})`
      };
    });
  }

  private addMarkersToProgressBar(markers: Array<{time: number, label: string}>): void {
    if (!this.plyrInstance || !markers.length) return;
    
    try {
      const progressElement = document.querySelector('.plyr__progress');
      const duration = this.plyrInstance.duration;
      
      if (!progressElement || !duration) {
        console.log('Progress element or duration not available, retrying in 500ms');
        setTimeout(() => this.addMarkersToProgressBar(markers), 500);
        return;
      }
      
      // Remove existing markers
      const existingMarkers = progressElement.querySelectorAll('.plyr-marker');
      existingMarkers.forEach(marker => marker.remove());
      
      // Add new markers
      markers.forEach(marker => {
        const markerElement = document.createElement('span');
        markerElement.className = 'plyr-marker';
        markerElement.style.cssText = `
          position: absolute;
          top: 0;
          bottom: 0;
          width: 3px;
          background: #0080FF;
          left: ${(marker.time / duration) * 100}%;
          cursor: pointer;
          z-index: 10;
          border-radius: 1px;
          transition: background 0.2s ease;
        `;
        markerElement.title = marker.label;
        
        // Add hover effect
        markerElement.addEventListener('mouseenter', () => {
          markerElement.style.background = '#00BFFF';
          markerElement.style.width = '4px';
        });
        
        markerElement.addEventListener('mouseleave', () => {
          markerElement.style.background = '#0080FF';
          markerElement.style.width = '3px';
        });
        
        // Add click handler to seek to marker time
        markerElement.addEventListener('click', (e) => {
          e.stopPropagation();
          if (this.plyrInstance) {
            this.plyrInstance.currentTime = Math.max(0, marker.time - 5); // Start 5 seconds before
            this.plyrInstance.play();
          }
        });
        
        progressElement.appendChild(markerElement);
      });
      
      console.log(`Added ${markers.length} markers to progress bar`);
    } catch (error) {
      console.log('Error adding markers to progress bar:', error);
    }
  }

  private showSimulatedVideoMessage(match: MatchSession): void {
    this.videoPlayer.style.display = 'none';
    
    let messageDiv = document.getElementById('video-simulation-message');
    if (!messageDiv) {
      messageDiv = document.createElement('div');
      messageDiv.id = 'video-simulation-message';
      messageDiv.style.cssText = `
        background: #1a1a1a;
        border: 2px dashed #555;
        border-radius: 8px;
        padding: 40px;
        text-align: center;
        color: #ccc;
        margin-bottom: 20px;
      `;
      this.videoPlayer.parentNode!.insertBefore(messageDiv, this.videoPlayer);
    }
    
    messageDiv.innerHTML = `
      <h3 style="color: #4CAF50; margin-top: 0;">🎬 Video Recording Simulation</h3>
      <p>This match was tracked and would have been recorded.</p>
      <p><strong>Match Duration:</strong> ${this.formatDuration(match.startTime, match.endTime)}</p>
      <p><strong>Goals Recorded:</strong> ${match.goals.length}</p>
      <p style="font-size: 14px; color: #999; margin-top: 20px;">
        <em>To enable actual video recording, implement the full Overwolf media capture API in VideoCaptureService.ts</em>
      </p>
    `;
    messageDiv.style.display = 'block';
  }

  private showVideoError(): void {
    this.videoPlayer.style.display = 'none';
    
    let errorDiv = document.getElementById('video-error-message');
    if (!errorDiv) {
      errorDiv = document.createElement('div');
      errorDiv.id = 'video-error-message';
      errorDiv.style.cssText = `
        background: #2a1a1a;
        border: 2px solid #f44336;
        border-radius: 8px;
        padding: 30px;
        text-align: center;
        color: #f44336;
        margin-bottom: 20px;
      `;
      this.videoPlayer.parentNode!.insertBefore(errorDiv, this.videoPlayer);
    }
    
    errorDiv.innerHTML = `
      <h3 style="margin-top: 0;">❌ Video Not Found</h3>
      <p>The video file could not be loaded.</p>
      <p style="font-size: 14px; color: #999;">
        Check that video recording is properly configured and the file exists.
      </p>
    `;
    errorDiv.style.display = 'block';
  }

  private async findVideoFile(match: MatchSession): Promise<string | null> {
    console.log('Looking for video file for match:', match.id);
    
    if (match.videoPath && (match.videoPath.includes('.mp4') || match.videoPath.includes('.webm') || match.videoPath.includes('.avi'))) {
      console.log('Video path already has file extension:', match.videoPath);
      return match.videoPath;
    }
    
    return new Promise((resolve) => {
      overwolf.media.videos.getVideos((result) => {
        console.log('overwolf.media.videos.getVideos result:', result);
        
        if (result.success && result.videos && result.videos.length > 0) {
          console.log('Found videos:', result.videos);
          
          const matchId = match.id;
          const expectedVideoName = `REMATCH ${this.formatVideoDate(match.startTime)}`;
          
          const matchingVideo = result.videos.find(videoUrl => {
            console.log('Checking video URL:', videoUrl);
            return videoUrl.includes(matchId) || videoUrl.includes(expectedVideoName.replace(/[\s:]/g, '-'));
          });
          
          if (matchingVideo) {
            console.log('Found matching video:', matchingVideo);
            resolve(matchingVideo);
          } else {
            console.log('No exact match found, looking for videos around match time');
            const likelyPath = `RematchCoach/${matchId}/REMATCH ${this.formatVideoDate(match.startTime)}.mp4`;
            console.log('Trying constructed path:', likelyPath);
            resolve(likelyPath);
          }
        } else {
          console.log('No videos found or API call failed');
          resolve(null);
        }
      });
    });
  }

  private formatVideoDate(timestamp: number): string {
    const date = new Date(timestamp);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    const milliseconds = String(date.getMilliseconds()).padStart(3, '0');
    
    return `${day}-${month}-${year}_${hours}-${minutes}-${seconds}-${milliseconds}`;
  }

  private getVideoUrl(videoPath: string): string {
    if (videoPath.startsWith('overwolf://')) {
      console.log('Using existing overwolf URL:', videoPath);
      return videoPath;
    }
    
    if (videoPath.startsWith('C:\\') || videoPath.startsWith('C:/')) {
      console.log('Converting Windows path to overwolf URL:', videoPath);
      return videoPath;
    }
    
    const cleanPath = videoPath.replace(/^\/+/g, '');
    const finalUrl = `overwolf://media/videos/${cleanPath}`;
    console.log('Constructed video URL:', finalUrl);
    return finalUrl;
  }

  private formatDate(timestamp: number): string {
    const date = new Date(timestamp);
    const now = new Date();
    const diffTime = now.getTime() - timestamp;
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) {
      return 'Today ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays === 1) {
      return 'Yesterday ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays < 7) {
      return `${diffDays} days ago`;
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  }

  private formatDuration(startTime: number, endTime?: number): string {
    if (!endTime) return 'Ongoing';
    
    const duration = endTime - startTime;
    const minutes = Math.floor(duration / 60000);
    const seconds = Math.floor((duration % 60000) / 1000);
    
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  private formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }


  private async setToggleHotkeyText() {
    const gameClassId = await this.getCurrentGameClassId();
    const hotkeyText = await OWHotkeys.getHotkeyText(kHotkeys.toggle, gameClassId);
    const hotkeyElem = document.getElementById('hotkey');
    if (hotkeyElem) {
      hotkeyElem.textContent = hotkeyText;
    }
  }

  private async setToggleHotkeyBehavior() {
    const toggleWindow = async (
      hotkeyResult: overwolf.settings.hotkeys.OnPressedEvent
    ): Promise<void> => {
      console.log(`pressed hotkey for ${hotkeyResult.name}`);
      const windowState = await this.getWindowState();

      if (windowState.window_state === WindowState.NORMAL ||
        windowState.window_state === WindowState.MAXIMIZED) {
        this.currWindow.minimize();
      } else if (windowState.window_state === WindowState.MINIMIZED ||
        windowState.window_state === WindowState.CLOSED) {
        this.currWindow.restore();
      }
    }

    OWHotkeys.onHotkeyDown(kHotkeys.toggle, toggleWindow);
  }

  private logLine(log: HTMLElement, data, highlight) {
    const line = document.createElement('pre');
    line.textContent = JSON.stringify(data);

    if (highlight) {
      line.className = 'highlight';
    }

    const shouldAutoScroll =
      log.scrollTop + log.offsetHeight >= log.scrollHeight - 10;

    log.appendChild(line);

    if (shouldAutoScroll) {
      log.scrollTop = log.scrollHeight;
    }
  }

  private async getCurrentGameClassId(): Promise<number | null> {
    const info = await OWGames.getRunningGameInfo();
    return (info && info.isRunning && info.classId) ? info.classId : null;
  }
}

// Initialize the unified window
const unifiedWindowInstance = UnifiedWindow.instance();

// Expose to global window object for background controller access
(window as any).UnifiedWindow = UnifiedWindow;