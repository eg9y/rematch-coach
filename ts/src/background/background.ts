import {
  OWGames,
  OWGameListener,
  OWWindow
} from '@overwolf/overwolf-api-ts';

import { kWindowNames, kGameClassIds } from "../consts";
import { VideoCaptureService } from '../services/VideoCaptureService';

import RunningGameInfo = overwolf.games.RunningGameInfo;
import AppLaunchTriggeredEvent = overwolf.extensions.AppLaunchTriggeredEvent;

// The background controller holds all of the app's background logic - hence its name. it has
// many possible use cases, for example sharing data between windows, or, in our case,
// managing which window is currently presented to the user. To that end, it holds a dictionary
// of the windows available in the app.
// Our background controller implements the Singleton design pattern, since only one
// instance of it should exist.
class BackgroundController {
  private static _instance: BackgroundController;
  private _windows: Record<string, OWWindow> = {};
  private _gameListener: OWGameListener;
  private _videoCaptureService: VideoCaptureService;

  private constructor() {
    // Populating the background controller's window dictionary
    this._windows[kWindowNames.unified] = new OWWindow(kWindowNames.unified);

    // Initialize video capture service
    this._videoCaptureService = VideoCaptureService.getInstance();

    // When a a supported game game is started or is ended, toggle the app's windows
    this._gameListener = new OWGameListener({
      onGameStarted: this.toggleWindows.bind(this),
      onGameEnded: this.toggleWindows.bind(this)
    });

    overwolf.extensions.onAppLaunchTriggered.addListener(
      e => this.onAppLaunchTriggered(e)
    );

    // Expose video capture service to window context for other windows to access
    (window as any).videoCaptureService = this._videoCaptureService;
  };

  // Implementing the Singleton design pattern
  public static instance(): BackgroundController {
    if (!BackgroundController._instance) {
      BackgroundController._instance = new BackgroundController();
    }

    return BackgroundController._instance;
  }

  // When running the app, start listening to games' status and decide which window should
  // be launched first, based on whether a supported game is currently running
  public async run() {
    this._gameListener.start();

    // Use unified window instead of separate desktop/in-game windows
    this._windows[kWindowNames.unified].restore();
    
    // Periodically check game status and update unified window
    setInterval(async () => {
      const gameInfo = await OWGames.getRunningGameInfo();
      const isGameRunning = gameInfo && gameInfo.isRunning && this.isSupportedGame(gameInfo);
      
      // Get the unified window instance and update its game status
      overwolf.windows.obtainDeclaredWindow(kWindowNames.unified, (result) => {
        if (result.success && result.window) {
          const unifiedWindow = (result.window as any).nativeWindow;
          if (unifiedWindow && unifiedWindow.UnifiedWindow) {
            unifiedWindow.UnifiedWindow.instance().checkGameStatus();
          }
        }
      });
    }, 5000); // Check every 5 seconds
  }

  private async onAppLaunchTriggered(e: AppLaunchTriggeredEvent) {
    console.log('onAppLaunchTriggered():', e);

    if (!e || e.origin.includes('gamelaunchevent')) {
      return;
    }

    // Always use unified window
    this._windows[kWindowNames.unified].restore();
  }

  private toggleWindows(info: RunningGameInfo) {
    if (!info || !this.isSupportedGame(info)) {
      return;
    }

    // Unified window stays open regardless of game state
    this._windows[kWindowNames.unified].restore();
  }

  private async isSupportedGameRunning(): Promise<boolean> {
    const info = await OWGames.getRunningGameInfo();

    return info && info.isRunning && this.isSupportedGame(info);
  }

  // Identify whether the RunningGameInfo object we have references a supported game
  private isSupportedGame(info: RunningGameInfo) {
    return kGameClassIds.includes(info.classId);
  }
}

BackgroundController.instance().run();
